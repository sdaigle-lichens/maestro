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
import { getInstalledPlugins } from "@repo/claude-fs";
import { getAvatar, setAvatar } from "./avatar-store.js";
import { readAllAgentTypes, setAgentType } from "./agent-types.js";
import { readAllAgentProjectTags, setAgentProjectTag } from "./agent-project-tags.js";
import { findAgentFile } from "./agent-descriptions.js";
import { hashAgentBody, renameAgentInFrontmatter, writeAgentForkRecord } from "./agent-fork-record.js";
import type { AgentForkRecord, AgentForkResult } from "./contracts.js";

export type { AgentForkRecord, AgentForkResult };

// The sidecar and the frontmatter arithmetic live in their own module so the sync path can reach
// them without dragging `node:sqlite` in behind `copyAgentAttributeRows` — see its header. Every
// existing importer of this file still finds them here.
export {
  agentForksPath,
  bodyForHashing,
  hashAgentBody,
  mergeForkBody,
  readAgentForks,
  removeAgentFork,
  renameAgentInFrontmatter,
  writeAgentForkRecord,
} from "./agent-fork-record.js";

const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;

async function pluginVersionFor(source: string, bundledPluginVersion: string | null): Promise<string | null> {
  if (source === "user") return null;
  if (source === "maestro") return bundledPluginVersion;
  const plugins = await getInstalledPlugins();
  return plugins.find((p) => p.pluginName === source)?.version ?? null;
}

/**
 * A SAME-NAME fork inherits its template's avatar, type and project tag for free — nothing to do,
 * since the shadowing row IS the same GLOBAL row the template already reads from. A RENAMED fork
 * starts blank unless these rows are copied explicitly, which is what this does: read what the
 * template's name has stored (always the GLOBAL row — a fork's source is always a global-tier
 * template, never a project one), and write it under the new name.
 *
 * The read side stays name-only (global); the write side does not. Since `030` rekeyed these three
 * stores' project-tier rows by `(projectRoot, agentName)`, the copy has to land on the FORK's own
 * project — `projectRoot` is the fork's own project root, threaded through here from `forkAgent` —
 * or the copy would land in the global tier and immediately leak into every other project.
 *
 * Anything unset on the template is left alone (a template with no saved avatar leaves the fork
 * with `defaultAvatarLayers()`'s fallback, same as any other agent).
 *
 * Exported (and each store's db path overridable, same as the store modules themselves) so a test
 * can exercise the copy without touching the real machine's global sqlite files.
 */
export function copyAgentAttributeRows(
  fromName: string,
  toName: string,
  projectRoot: string,
  dbPaths: { avatar?: string; agentTypes?: string; agentProjectTags?: string } = {}
): void {
  const avatar = getAvatar(fromName, dbPaths.avatar);
  if (avatar) setAvatar(toName, avatar, dbPaths.avatar, projectRoot);

  const type = readAllAgentTypes(dbPaths.agentTypes)[fromName];
  if (type) setAgentType(toName, type, dbPaths.agentTypes, projectRoot);

  const tag = readAllAgentProjectTags(dbPaths.agentProjectTags)[fromName];
  if (tag) setAgentProjectTag(toName, tag, dbPaths.agentProjectTags, projectRoot);
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
  const contents = renamed ? renameAgentInFrontmatter(templateBody, targetName) : templateBody;
  fs.writeFileSync(targetFile, contents, "utf8");

  if (renamed) copyAgentAttributeRows(agentName, targetName, projectRoot, storeDbPaths);

  const record: AgentForkRecord = {
    agentName: targetName,
    sourceTier: ref.source === "user" ? "user" : "plugin",
    sourcePlugin: ref.source === "user" ? null : ref.source,
    pluginVersion: await pluginVersionFor(ref.source, bundledPluginVersion),
    templateBodyHash: hashAgentBody(templateBody),
    templateBody,
    forkedAt: new Date().toISOString(),
  };
  writeAgentForkRecord(projectRoot, record);

  return { name: targetName, file: targetFile };
}
