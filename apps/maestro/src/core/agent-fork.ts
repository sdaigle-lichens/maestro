// Forking a global-tier agent (`user`, `maestro`, or an installed plugin's) into the open
// project's `.claude/agents/` — the escape hatch `EDITABLE_AGENT_SOURCES` narrowing to `["project"]`
// exists to point people at. See `agent-descriptions.ts`'s header for why those tiers can't be
// edited in place; this is the other half, where they can be copied instead.
//
// Two things happen on a fork, and both matter for `031` (which keeps a fork in step with its
// template) even though this ticket only writes them down:
//
//   1. The file lands at `.claude/agents/<name>.md`. Same name as the template (the default) makes
//      `dedupeById` in `discovery.ts` shadow the global one — one row, sourced from the project,
//      which IS the confirmation the fork worked. A different name coexists instead, so its
//      frontmatter `name:` is rewritten to match — otherwise two agents on disk would both claim
//      the template's identity and `discoverAgents` would report only one of them by that name.
//   2. A provenance record lands in a project-local sidecar (`agent-forks.json`), NOT the agent's
//      own frontmatter — see `AgentForkRecord`'s doc comment in `contracts.ts`. `031` is what reads
//      it; this ticket only has to write it, because a fork created without one is permanently
//      unsyncable — there is no way to recover afterwards what it was forked from.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getInstalledPlugins } from "@repo/claude-fs";
import { getAvatar, setAvatar } from "./avatar-store.js";
import { readAllAgentTypes, setAgentType } from "./agent-types.js";
import { readAllAgentProjectTags, setAgentProjectTag } from "./agent-project-tags.js";
import { findAgentFile, FRONTMATTER } from "./agent-descriptions.js";
import type { AgentForkRecord, AgentForkResult } from "./contracts.js";

export type { AgentForkRecord, AgentForkResult };

const AGENT_FORKS_FILENAME = "agent-forks.json";

export function agentForksPath(projectRoot: string): string {
  return path.join(projectRoot, ".claude", AGENT_FORKS_FILENAME);
}

/** Every recorded fork in this project, keyed by the forked agent's own name. Missing file ⇒ {}. */
export function readAgentForks(projectRoot: string): Record<string, AgentForkRecord> {
  try {
    const raw = fs.readFileSync(agentForksPath(projectRoot), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, AgentForkRecord>) : {};
  } catch {
    return {};
  }
}

function writeAgentFork(projectRoot: string, record: AgentForkRecord): void {
  const file = agentForksPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const all = readAgentForks(projectRoot);
  all[record.agentName] = record;
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n", "utf8");
}

/**
 * The bytes a fork's baseline hash is taken over: the file's frontmatter block with its
 * `description:` line (and any continuation lines directly under it) removed, then the untouched
 * body. A description is EXPECTED to diverge — editing it is the one thing this app itself lets a
 * global-tier agent's card do after a fork — so hashing the whole file would mark every fork as
 * modified the moment its description was edited, and `031`'s sync would then never fire for
 * anybody. Pin this normalisation with a test; it is the one part of the hash that is not obvious
 * from reading `031` later.
 */
export function bodyForHashing(contents: string): string {
  const match = contents.match(FRONTMATTER);
  if (!match) return contents;
  const lines = match[1].split("\n");
  const index = lines.findIndex((l) => /^description\s*:/.test(l));
  if (index === -1) return contents;
  let end = index + 1;
  while (end < lines.length && lines[end].trim() !== "" && /^\s/.test(lines[end])) end++;
  const kept = [...lines.slice(0, index), ...lines.slice(end)];
  return `---\n${kept.join("\n")}\n---` + contents.slice(match[0].length);
}

export function hashAgentBody(contents: string): string {
  return createHash("sha256").update(bodyForHashing(contents)).digest("hex");
}

/**
 * Rewrite the frontmatter `name:` line to `name`, leaving everything else — including the
 * `description:` line — byte-identical. Only used for a RENAMED fork; a same-name fork copies the
 * template's bytes untouched, which is what the acceptance criterion means by "byte-for-byte".
 */
function renameInFrontmatter(contents: string, name: string): string {
  const match = contents.match(FRONTMATTER);
  if (!match) throw new Error("This agent's file has no frontmatter block to rename.");
  const lines = match[1].split("\n");
  const index = lines.findIndex((l) => /^name\s*:/.test(l));
  if (index === -1) throw new Error("This agent's frontmatter has no name: line to rename.");
  lines[index] = `name: ${name}`;
  return `---\n${lines.join("\n")}\n---` + contents.slice(match[0].length);
}

const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;

async function pluginVersionFor(source: string, bundledPluginVersion: string | null): Promise<string | null> {
  if (source === "user") return null;
  if (source === "maestro") return bundledPluginVersion;
  const plugins = await getInstalledPlugins();
  return plugins.find((p) => p.pluginName === source)?.version ?? null;
}

/**
 * The three global stores are all `agent_name TEXT PRIMARY KEY`, so a SAME-NAME fork inherits its
 * template's avatar, type and project tag for free — nothing to do. A RENAMED fork starts blank
 * unless these rows are copied explicitly, which is what this does: read what the template's name
 * has stored, write it under the new name, and leave anything unset alone (a template with no
 * saved avatar leaves the fork with `defaultAvatarLayers()`'s fallback, same as any other agent).
 *
 * Exported (and each store's db path overridable, same as the store modules themselves) so a test
 * can exercise the copy without touching the real machine's global sqlite files.
 */
export function copyAgentAttributeRows(
  fromName: string,
  toName: string,
  dbPaths: { avatar?: string; agentTypes?: string; agentProjectTags?: string } = {}
): void {
  const avatar = getAvatar(fromName, dbPaths.avatar);
  if (avatar) setAvatar(toName, avatar, dbPaths.avatar);

  const type = readAllAgentTypes(dbPaths.agentTypes)[fromName];
  if (type) setAgentType(toName, type, dbPaths.agentTypes);

  const tag = readAllAgentProjectTags(dbPaths.agentProjectTags)[fromName];
  if (tag) setAgentProjectTag(toName, tag, dbPaths.agentProjectTags);
}

/**
 * Fork `agentName` — which must resolve to a global tier (`user`, `maestro`, or an installed
 * plugin's) — into `<projectRoot>/.claude/agents/<newName ?? agentName>.md`.
 *
 * Rejects rather than silently no-opping: no project open, the agent not found anywhere, the agent
 * already project-tier (nothing to fork FROM), a bad new name, or a rename that collides with a
 * file already in `.claude/agents/`.
 *
 * `storeDbPaths` overrides the three global stores' default (`~/.claude/...`) paths — unused in
 * production (every real caller wants the real machine stores) and here only so a test can fork
 * end-to-end without writing into them.
 */
export async function forkAgent(
  projectRoot: string,
  bundledDir: string | null,
  bundledPluginVersion: string | null,
  agentName: string,
  newName?: string,
  storeDbPaths?: { avatar?: string; agentTypes?: string; agentProjectTags?: string }
): Promise<AgentForkResult> {
  if (!projectRoot) throw new Error("No project is open.");

  const ref = await findAgentFile(projectRoot, bundledDir, agentName);
  if (!ref) throw new Error(`No definition file found for "${agentName}".`);
  if (ref.source === "project") throw new Error(`"${agentName}" is already a project agent — there's nothing to fork.`);

  const targetName = (newName ?? agentName).trim();
  if (!targetName) throw new Error("A forked agent needs a name.");
  if (!KEBAB_CASE.test(targetName)) {
    throw new Error("Use kebab-case: lowercase letters, numbers, and dashes.");
  }

  const dir = path.join(projectRoot, ".claude", "agents");
  fs.mkdirSync(dir, { recursive: true });
  const targetFile = path.join(dir, `${targetName}.md`);
  const renamed = targetName !== agentName;
  if (renamed && fs.existsSync(targetFile)) {
    throw new Error(`"${targetName}" already exists in this project's .claude/agents/.`);
  }

  const templateBody = fs.readFileSync(ref.file, "utf8");
  const contents = renamed ? renameInFrontmatter(templateBody, targetName) : templateBody;
  fs.writeFileSync(targetFile, contents, "utf8");

  if (renamed) copyAgentAttributeRows(agentName, targetName, storeDbPaths);

  const record: AgentForkRecord = {
    agentName: targetName,
    sourceTier: ref.source === "user" ? "user" : "plugin",
    sourcePlugin: ref.source === "user" ? null : ref.source,
    pluginVersion: await pluginVersionFor(ref.source, bundledPluginVersion),
    templateBodyHash: hashAgentBody(templateBody),
    templateBody,
    forkedAt: new Date().toISOString(),
  };
  writeAgentFork(projectRoot, record);

  return { name: targetName, file: targetFile };
}
