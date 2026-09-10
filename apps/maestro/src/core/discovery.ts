// Discovery of the agents, skills, rules, and directory tree a project can choose from.
//
// PORTED FROM apps/ai-tools-manager/src/utils/{maestro.ts,maestro-rules.ts,maestro-tree.ts,
// maestro-vibe.ts}. The Docker branches are gone: there is no /project mount to rebase onto and
// no pre-computed /tmp/marketplace-data.json to fall back to, because the desktop app runs on the
// host and can just read the filesystem.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseFrontmatter,
  readAgentsFromDir,
  readSkillEntriesFromDir,
  getUserAgents,
  getUserSkills,
  getInstalledPluginAgents,
  getInstalledPluginSkills,
} from "@repo/claude-fs";
import { IGNORE_DIRS, walkDirs, rulesFilesIn, ruleSearchDirs, skillSearchDirs } from "./fs-scan.js";
import { readAllSkillTags } from "./skill-tags.js";

import type { DiscoveredDefinition, ProjectRule, RuleLibraryEntry, TreeNode } from "./contracts.js";
export type { DiscoveredDefinition, ProjectRule, RuleLibraryEntry, TreeNode };

const execFileAsync = promisify(execFile);

/** Dedupe by id, keeping the first occurrence — callers push sources in priority order. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/** Where the plugin's agents live, relative to whichever root holds the plugin. */
export const BUNDLED_AGENTS_REL = path.join("plugins", "maestro", "agents");

/**
 * Walk up from `start` looking for `plugins/maestro/agents`.
 *
 * `start` is supplied by the caller and is deliberately NOT `import.meta.dirname`. This module is
 * bundled into the main process by electron-vite — for `dev` as well as `build` — so
 * `import.meta.dirname` is `apps/maestro/out/main`, the build OUTPUT directory, and in a packaged
 * app it is a path inside `app.asar`. Walking up from the module's own location therefore searched
 * a different tree in every mode, and the bundled subagents silently vanished from the picker in
 * launched builds. Main passes `app.getAppPath()` instead — see `src/main/bundled-assets.ts`.
 *
 * Still a search rather than a fixed number of `../` hops, because the app root sits at a
 * different depth from the repo root in the monorepo than it does in a packaged tree.
 */
export function findUpBundledAgents(start: string): string | null {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, BUNDLED_AGENTS_REL);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * All agents the user can choose from: project-scoped, global (~/.claude), the bundled Maestro
 * subagents, and every installed plugin's agents — each tagged with its `source`.
 *
 * `bundledDir` has no default on purpose. A default would have to resolve from this module's own
 * location, which is exactly the resolution that was wrong; making the caller name the directory
 * puts the decision in the one process that knows where the app was installed.
 */
export async function discoverAgents(projectRoot: string, bundledDir: string | null): Promise<DiscoveredDefinition[]> {
  const [project, user, bundled, plugins] = await Promise.all([
    projectRoot ? readAgentsFromDir(path.join(projectRoot, ".claude", "agents")) : Promise.resolve([]),
    getUserAgents(),
    bundledDir ? readAgentsFromDir(bundledDir) : Promise.resolve([]),
    getInstalledPluginAgents(),
  ]);
  return dedupeById([
    ...project.map((a) => ({
      id: a.name,
      description: a.description,
      source: "project",
      projectTags: [],
      agentTypes: [],
    })),
    ...user.map((a) => ({ id: a.name, description: a.description, source: "user", projectTags: [], agentTypes: [] })),
    ...bundled.map((a) => ({
      id: a.name,
      description: a.description,
      source: "maestro",
      projectTags: [],
      agentTypes: [],
    })),
    ...plugins.map((a) => ({
      id: a.name,
      description: a.description,
      source: a.plugin,
      projectTags: [],
      agentTypes: [],
    })),
  ]).sort((a, b) => a.id.localeCompare(b.id));
}

/** Two (or more) skill directories in the tree that would resolve to the same id. */
export interface SkillIdCollision {
  id: string;
  /** Project-relative `.claude/skills/<dir>` paths, in the walk order that decided the winner. */
  dirs: string[];
}

/**
 * Every project-scoped skill, from EVERY `.claude/skills` in the tree — not just the root's. In a
 * monorepo a skill lives beside the code it describes, same as `discoverConceptSkills`, and this
 * is the sibling that reads the plain `{ name, description }` shape `discoverSkills` wants.
 *
 * Walk order is `skillSearchDirs`' — the project root first, then its subdirectories depth-first —
 * so a name collision resolves to the root's copy, or to whichever subdirectory's walked first,
 * deterministically. A collision is reported rather than silently dropped: the loser is still
 * excluded from `skills`, but its directory is named in `collisions` so a caller can surface it
 * instead of the two directories quietly fighting over one id.
 */
export async function discoverProjectSkillsTree(projectRoot: string): Promise<{
  skills: { name: string; description: string }[];
  collisions: SkillIdCollision[];
}> {
  if (!projectRoot) return { skills: [], collisions: [] };
  const byId = new Map<string, { name: string; description: string; dirs: string[] }>();
  for (const skillsDir of skillSearchDirs(projectRoot)) {
    for (const entry of await readSkillEntriesFromDir(skillsDir)) {
      const dir = path.relative(projectRoot, entry.dir);
      const existing = byId.get(entry.id);
      if (existing) {
        existing.dirs.push(dir);
        continue;
      }
      byId.set(entry.id, { name: entry.id, description: entry.frontmatter.description ?? "", dirs: [dir] });
    }
  }
  const skills: { name: string; description: string }[] = [];
  const collisions: SkillIdCollision[] = [];
  for (const [id, entry] of byId) {
    skills.push({ name: entry.name, description: entry.description });
    if (entry.dirs.length > 1) collisions.push({ id, dirs: entry.dirs });
  }
  return { skills, collisions };
}

/**
 * All skills the user can choose from: project-scoped, global (~/.claude), and every installed
 * plugin's skills — each tagged with its `source`, plus whatever project tags / agent types the
 * user has manually set on it (`skill-tags.ts`, global across every project by skill id).
 *
 * The project component walks EVERY `.claude/skills` in the tree (`discoverProjectSkillsTree`),
 * not only the root's — a single-directory read is blind to most of a monorepo, the same gap
 * `discoverConceptSkills` exists to close for concept skills specifically.
 */
export async function discoverSkills(projectRoot: string): Promise<DiscoveredDefinition[]> {
  const { skills: projectTree, collisions } = await discoverProjectSkillsTree(projectRoot);
  for (const c of collisions) {
    console.warn(
      `[maestro] skill id "${c.id}" is defined in more than one .claude/skills directory ` +
        `(${c.dirs.join(", ")}) — using "${c.dirs[0]}"`
    );
  }
  const [project, user, plugins] = await Promise.all([
    Promise.resolve(projectTree),
    getUserSkills(),
    getInstalledPluginSkills(),
  ]);
  const tagsById = readAllSkillTags();
  return dedupeById([
    ...project.map((s) => ({ id: s.name, description: s.description, source: "project" })),
    ...user.map((s) => ({ id: s.name, description: s.description, source: "user" })),
    ...plugins.map((s) => ({ id: s.name, description: s.description, source: s.plugin })),
  ])
    .map((s) => ({
      ...s,
      projectTags: tagsById[s.id]?.projectTags ?? [],
      agentTypes: tagsById[s.id]?.agentTypes ?? [],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every rule file under any `.claude/rules/` in the project, with the directory it currently
 * lives in. Scanning the whole tree (not just the root) is what keeps rules that a previous save
 * MOVED into a subdirectory visible in the picker.
 */
export function discoverProjectRules(projectRoot: string): ProjectRule[] {
  if (!projectRoot) return [];
  const out: ProjectRule[] = [];
  for (const dir of ruleSearchDirs(projectRoot)) {
    for (const file of rulesFilesIn(dir)) {
      let text: string;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const fm = parseFrontmatter(text);
      out.push({
        id: fm.name || path.basename(file).replace(/\.md$/, ""),
        description: fm.description ?? "",
        body: text.replace(/^---[\s\S]*?---\s*\n?/, ""),
        dir: path.relative(projectRoot, dir),
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The project's rule LIBRARY — `<project>/rules/*.md`, as authored.
 *
 * THE NAME IS THE POINT. This and `discoverProjectRules` above both answer to "get the rules",
 * and they are not the same set, which is exactly why the merge plan flagged them: this one reads
 * the flat `rules/` directory a repo publishes from — the files `vibe-rules` installs and the
 * /tools dashboard lists — while `discoverProjectRules` reads every `.claude/rules/` in the tree,
 * which is where a rule lands once it is ASSIGNED and what a save moves around. A project can have
 * either without the other. Unifying them would have made the dashboard claim the /rules view
 * manages files it does not, so they stay two functions with two names and two return types.
 *
 * Ported from apps/help-server/src/utils/rules.ts, whose `RULES_DIR` was the Docker mount.
 */
export function discoverRuleLibrary(projectRoot: string): RuleLibraryEntry[] {
  if (!projectRoot) return [];
  const dir = path.join(projectRoot, "rules");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const out: RuleLibraryEntry[] = [];
  for (const file of files.sort()) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, file), "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    out.push({
      filename: file,
      title: text.match(/^#\s+(.+)/m)?.[1].trim() ?? file.replace(/\.md$/, ""),
      // `paths:` is a YAML list on one line (`paths: ["src/**", "test/**"]`), and the shared
      // frontmatter reader hands back scalars — so the brackets and quotes are stripped here.
      paths: parsePathsList(fm.paths),
      description: fm.description ?? "",
    });
  }
  return out;
}

function parsePathsList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((p) => p.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** Directory tree used by the /rules view to assign rules to paths. */
export function discoverProjectTree(projectRoot: string): TreeNode[] {
  if (!projectRoot) return [];
  return Array.from(walkDirs(projectRoot, { ignore: IGNORE_DIRS }), (d) => ({
    path: d.relative,
    name: d.name,
    depth: d.depth,
  }));
}

/**
 * `vibe-rules list` prints a header line then one `- <name>` per rule; ignore everything else.
 * Exported for tests — the CLI is not available in CI.
 */
export function parseVibeList(out: string): string[] {
  const ids: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s+(.+?)\s*$/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/**
 * Installable rules from the local vibe-rules store. Selecting one and assigning it to a path
 * makes the save step run `vibe-rules load <id> claude-code -t <dir>/.claude/rules/<id>.md`.
 *
 * Returns [] when the CLI isn't installed — the /rules view degrades to project rules only.
 */
export async function discoverVibeRules(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("vibe-rules", ["list"], { encoding: "utf8" });
    return parseVibeList(stdout);
  } catch {
    return [];
  }
}

/** Whether the `vibe-rules` CLI is on PATH, so the UI can say so instead of silently listing nothing. */
export async function hasVibeRules(): Promise<boolean> {
  try {
    await execFileAsync("vibe-rules", ["--version"], { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}
