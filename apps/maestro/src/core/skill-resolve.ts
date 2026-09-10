// Resolves a project skill id to the `SKILL.md` it was recorded from — the runtime half of the
// tree walk `discoverProjectSkillsTree` (app) and `discoverProjectSkillIds` (terminal installer)
// already do at install/seed time (`056`).
//
// `skills_available` holds bare ids, and the Skill tool only indexes the repository ROOT's
// `.claude/skills` plus installed plugins — not a nested `.claude/skills` living beside the code
// it documents elsewhere in a monorepo. A hook or a template telling an agent to "load X with the
// Skill tool" is wrong for exactly those nested ids, and this module is the fallback: given the
// id, walk the same tree the discovery functions walk and hand back the file to `Read` directly.
//
// One walk, three callers: `maestro-resolve-skill-path.cjs` (a project-copied CLI a hook or the
// orchestrator template can shell out to), `maestro-inject-agent-context.js` (checks each
// `loaded_skills`/`referenced_skills` id inline), and `discoverProjectSkillIds` in
// `maestro-install.js` (the terminal installer's own id-only walk, refactored onto this rather
// than keeping a second copy). `discoverProjectSkillsTree` (the app's own, async, richer-shaped
// sibling in `discovery.ts`) is left as it is — this module doesn't replace it, it gives the
// synchronous, `fs`-only walk a `lib/maestro-session.cjs` consumer can run with no workspace
// dependencies.

import fs from "node:fs";
import path from "node:path";
import { skillSearchDirs } from "./fs-scan.js";

const FRONTMATTER_NAME_RE = /^---\s*[\s\S]*?\bname:\s*(\S+)[\s\S]*?---/;

/** One skill id, and every `.claude/skills/<dir>` (project-relative) it was found under. */
export interface ProjectSkillEntry {
  id: string;
  /** In walk order — `skillSearchDirs`' order, root first then depth-first. `dirs[0]` is the winner. */
  dirs: string[];
}

/**
 * Every project skill id in the tree, root-wins on a collision — the SAME order
 * `discoverProjectSkillsTree` walks, so this can never disagree with it about which directory an
 * id resolves to. A collision is reported by returning every directory that claimed the id, in
 * walk order, rather than silently keeping only the winner: a caller decides whether and how to
 * surface it (see `discoverProjectSkillIds` in `maestro-install.js`).
 */
export function walkProjectSkillIds(root: string): ProjectSkillEntry[] {
  const byId = new Map<string, string[]>();
  for (const skillsDir of skillSearchDirs(root)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let id = entry.name;
      try {
        const text = fs.readFileSync(path.join(skillsDir, entry.name, "SKILL.md"), "utf8");
        const match = text.match(FRONTMATTER_NAME_RE);
        if (match) id = match[1];
      } catch {
        // No SKILL.md, or unreadable — fall back to the directory name.
      }
      const relDir = path.relative(root, path.join(skillsDir, entry.name));
      const dirs = byId.get(id);
      if (dirs) dirs.push(relDir);
      else byId.set(id, [relDir]);
    }
  }
  return Array.from(byId, ([id, dirs]) => ({ id, dirs }));
}

/**
 * The `SKILL.md` path a project skill id was recorded from — the same directory `walkProjectSkillIds`
 * would report as the winner for a collision (root-wins, never a fresh search's first match) — or
 * `null` when the id isn't a project skill at all (a plugin skill, a typo, one that moved). `null`
 * is an ordinary answer, never a failure: a caller injecting this into an agent's context must not
 * treat it as one.
 */
export function resolveProjectSkillPath(root: string, id: string): string | null {
  if (!root || !id) return null;
  const entry = walkProjectSkillIds(root).find((e) => e.id === id);
  if (!entry) return null;
  return path.join(root, entry.dirs[0], "SKILL.md");
}

/**
 * Is `skillPath` (as returned by `resolveProjectSkillPath`) under the repository ROOT's own
 * `.claude/skills` — the one directory the Skill tool actually indexes, alongside installed
 * plugins? `false` means the id is only reachable by reading the file directly.
 */
export function isRootSkillPath(root: string, skillPath: string): boolean {
  const skillDir = path.dirname(skillPath);
  const rootSkillsDir = path.join(root, ".claude", "skills");
  return path.dirname(skillDir) === rootSkillsDir;
}
