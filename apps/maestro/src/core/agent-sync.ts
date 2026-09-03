// Keeping a FORKED AGENT in step with the template it was forked from (`031`).
//
// `029` made a fork a project-local copy of a global-tier agent and recorded where it came from
// (`agent-fork.ts`'s `agent-forks.json` sidecar). A copy goes stale: the plugin ships a better
// reviewer, and every project that forked it keeps running last year's version with no sign
// anything moved. This is the half that notices.
//
// IT DECIDES NOTHING OF ITS OWN. The materialize / refresh / skip-as-customized / never-touched
// rule is `sync-decision.ts`'s `decideSync`, lifted out of `report-sync.ts` so the two callers
// cannot drift — the same argument `resolveReport` makes about the hook and the app. What lives
// here is only what is actually different about agents:
//
//   1. THE DESCRIPTION (and the name) DO NOT TRACK. A fork syncs its BODY; its description stays
//      the user's, and a renamed fork keeps its own name. That is what makes forking worth doing.
//      `hashAgentBody` normalises both out, so the staleness hash covers the body alone — a
//      whole-file hash would mark every fork as user-modified the instant its description was
//      edited, and the refresh branch would then never fire for anybody.
//   2. THE TWO GLOBAL TIERS NEED DIFFERENT TRIGGERS. A plugin's files come from a per-VERSION
//      marketplace cache that `autoUpdate` re-pulls only when `plugin.json`'s `version` changes
//      (see the `updating-maestro` skill), so a plugin agent's content CANNOT change without a
//      version bump: a plugin-tier fork asks for a version bump AND a changed body. The version
//      half is necessary — an edit shipped without a bump reaches nobody, so reporting it as an
//      available update would promise a refresh no delivery path can deliver. The body half is
//      what makes it sufficient — a bump on its own says only that the PLUGIN moved, not that this
//      agent did. The `user` tier has no version at all (`~/.claude/agents/*.md` are hand-edited
//      files), so those forks compare template content hashes alone. Two triggers, one merge rule.
//   3. NOTHING WRITES WITHOUT BEING ASKED. `computeAgentSync` is a pure read: it stats and reads
//      files and writes none. Those `.claude/agents/*.md` may be committed, and a diff nobody
//      asked for is hard to explain. Writes happen only through `applyAgentSync`, one agent at a
//      time, from an explicit review action in the app or an answered prompt in the skills.
//
// Both surfaces — the `/agents` review card and the `maestro`/`maestro-update` skills, which reach
// this through the generated `lib/maestro-agent-sync.cjs` — call these two functions, so the
// terminal and the app cannot disagree about whether a fork is stale.

import fs from "node:fs";
import path from "node:path";
import { CLAUDE_DIR, getInstalledPlugins, readAgentEntriesFromDir, rebaseOnClaudeDir } from "@repo/claude-fs";
import { diffLines } from "./diff.js";
import { decideSync, type SyncVerdict } from "./sync-decision.js";
import {
  hashAgentBody,
  mergeForkBody,
  readAgentForks,
  removeAgentFork,
  renameAgentInFrontmatter,
  writeAgentForkRecord,
} from "./agent-fork-record.js";
import type {
  AgentForkRecord,
  AgentSyncAction,
  AgentSyncApplyResult,
  AgentSyncEntry,
  AgentSyncSummary,
} from "./contracts.js";

export type { AgentSyncAction, AgentSyncApplyResult, AgentSyncEntry, AgentSyncSummary };

/** Where a plugin's agents live right now, and the version currently shipping them. */
export interface PluginTemplateSource {
  agentsDir: string;
  version: string | null;
}

export interface AgentSyncOptions {
  /** `~/.claude/agents` unless overridden — a test must never read the real machine's agents. */
  userAgentsDir?: string;
  /**
   * The `maestro` plugin as THIS BUILD ships it. The app has a bundled copy that a marketplace may
   * never have installed (a dev checkout), so it wins over the installed-plugin lookup for the
   * name `maestro`; a bare terminal session passes nothing and falls through to that lookup.
   */
  bundled?: { agentsDir: string | null; version: string | null };
  /** Replaces the `installed_plugins.json` lookup wholesale. Tests only. */
  pluginSources?: Record<string, PluginTemplateSource>;
}

interface ResolvedTemplate {
  file: string;
  contents: string;
  description: string;
  /** The plugin version shipping it. Null for a `user`-tier template, which has no version. */
  version: string | null;
}

function projectAgentsDir(projectRoot: string): string {
  return path.join(projectRoot, ".claude", "agents");
}

/**
 * The name the TEMPLATE goes by, which is not always the fork's own: a renamed fork rewrote its
 * `name:` line, and the sidecar keys on the fork's name. Recovered from the template body the fork
 * recorded — the reason `AgentForkRecord` carries those bytes at all.
 */
function templateNameOf(record: AgentForkRecord): string {
  const match = record.templateBody.match(/^---\s*\n([\s\S]*?)\n---/);
  const line = match?.[1].split("\n").find((l) => /^name\s*:/.test(l));
  const value = line
    ?.slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  return value || record.agentName;
}

/** Every installed plugin's agents directory and version, keyed by plugin name. */
async function installedPluginSources(): Promise<Record<string, PluginTemplateSource>> {
  const out: Record<string, PluginTemplateSource> = {};
  for (const plugin of await getInstalledPlugins()) {
    out[plugin.pluginName] = {
      agentsDir: path.join(rebaseOnClaudeDir(plugin.installPath), "agents"),
      version: plugin.version,
    };
  }
  return out;
}

/** Read one named agent out of a directory, in the two layouts `readAgentEntriesFromDir` supports. */
async function readAgentFrom(dir: string | null, name: string): Promise<{ file: string; description: string } | null> {
  if (!dir) return null;
  const hit = (await readAgentEntriesFromDir(dir)).find((a) => a.name === name);
  return hit ? { file: hit.file, description: hit.description } : null;
}

/**
 * Where this fork's template stands TODAY — deliberately NOT through `findAgentFile`, which
 * resolves in `discoverAgents`' tier order and would hand back the fork itself: a same-name fork
 * shadows its own template by design. The record says which tier to look in, and only that tier is
 * consulted.
 */
async function resolveTemplate(record: AgentForkRecord, options: AgentSyncOptions): Promise<ResolvedTemplate | null> {
  const name = templateNameOf(record);

  if (record.sourceTier === "user") {
    const dir = options.userAgentsDir ?? path.join(CLAUDE_DIR, "agents");
    const hit = await readAgentFrom(dir, name);
    return hit ? { ...hit, contents: fs.readFileSync(hit.file, "utf8"), version: null } : null;
  }

  const plugin = record.sourcePlugin;
  if (!plugin) return null;
  if (plugin === "maestro" && options.bundled?.agentsDir) {
    const hit = await readAgentFrom(options.bundled.agentsDir, name);
    if (hit) {
      return { ...hit, contents: fs.readFileSync(hit.file, "utf8"), version: options.bundled.version ?? null };
    }
  }
  const sources = options.pluginSources ?? (await installedPluginSources());
  const source = sources[plugin];
  if (!source) return null;
  const hit = await readAgentFrom(source.agentsDir, name);
  return hit ? { ...hit, contents: fs.readFileSync(hit.file, "utf8"), version: source.version } : null;
}

/** The template state this fork is measured against: its acknowledgement if it has one, else its baseline. */
function trackedState(record: AgentForkRecord): { pluginVersion: string | null; templateBodyHash: string } {
  return record.acknowledgedFrom ?? { pluginVersion: record.pluginVersion, templateBodyHash: record.templateBodyHash };
}

function hasTemplateAdvanced(record: AgentForkRecord, template: ResolvedTemplate | null): boolean {
  if (!template) return false;
  const tracked = trackedState(record);
  const bodyMoved = hashAgentBody(template.contents) !== tracked.templateBodyHash;
  // `user` tier: `~/.claude/agents/*.md` are hand-edited files with no version anywhere, so the
  // bytes are the only thing that can notice.
  if (record.sourceTier !== "plugin") return bodyMoved;
  // Plugin tier needs BOTH, and the two halves rule out opposite mistakes:
  //
  //   - the VERSION check is what makes this NECESSARY. A plugin's files come from a per-VERSION
  //     marketplace cache that `autoUpdate` re-pulls only when `plugin.json`'s `version` changes
  //     (see the `updating-maestro` skill), so a plugin edit shipped without a bump has reached
  //     nobody: "no update available" is the true answer, and reporting one would promise a
  //     refresh that no delivery path can deliver.
  //   - the BODY check is what makes it SUFFICIENT. A version bump is not evidence that THIS agent
  //     moved — this repo bumps `plugin.json` for every change under `plugins/`, and most of those
  //     never touch `agents/` at all. On the version alone, every such release lit the `/maestro`
  //     banner for every fork on the machine and sent the user to a review card that then told
  //     them "the body is identical to the template's".
  //
  // Two nulls (a plugin whose version could not be read at either end) are already "no update" by
  // the first half, which is the honest answer when there is nothing to compare.
  return template.version !== tracked.pluginVersion && bodyMoved;
}

async function buildEntry(
  projectRoot: string,
  record: AgentForkRecord,
  options: AgentSyncOptions
): Promise<{ entry: AgentSyncEntry; verdict: SyncVerdict }> {
  const local = await readAgentFrom(projectAgentsDir(projectRoot), record.agentName);
  const localContents = local ? fs.readFileSync(local.file, "utf8") : null;
  const template = await resolveTemplate(record, options);
  const templateAdvanced = hasTemplateAdvanced(record, template);

  const verdict = decideSync({
    // A fork with a record is always tracking; "detached" is the record's ABSENCE, which is why a
    // detached agent is never in this loop and never reported. The hash is the fork's baseline —
    // what its body was when it last synced — not its acknowledgement, which is about the template.
    tracking: { kind: "tracked", hash: record.templateBodyHash },
    localHash: localContents === null ? null : hashAgentBody(localContents),
    hasTemplate: template !== null,
    templateAdvanced,
  });

  // What "update" would write, diffed against what is there — the most useful thing to look at,
  // and identical on both surfaces because both render this array.
  const merged = template && localContents !== null ? mergeForkBody(template.contents, localContents) : null;

  return {
    verdict,
    entry: {
      agentName: record.agentName,
      verdict,
      sourceTier: record.sourceTier,
      sourcePlugin: record.sourcePlugin,
      trackedVersion: trackedState(record).pluginVersion,
      templateVersion: template?.version ?? null,
      templateAdvanced,
      file: local?.file ?? path.join(projectAgentsDir(projectRoot), `${record.agentName}.md`),
      description: local?.description ?? null,
      templateFile: template?.file ?? null,
      templateDescription: template?.description ?? null,
      diff: merged !== null && localContents !== null ? diffLines(localContents, merged) : [],
    },
  };
}

const EMPTY: AgentSyncSummary = {
  materialized: [],
  refreshed: [],
  staleCustomized: [],
  unchanged: [],
  diverged: [],
  entries: [],
};

/**
 * Every forked agent in this project, and whether it is still in step with its template.
 *
 * READS ONLY. Run on project selection and from the skills' Step 0; it never touches
 * `.claude/agents/`, never rewrites the sidecar, and never creates a directory.
 *
 * An agent with no provenance record is not in the result at all — that is either a hand-authored
 * project agent or a fork somebody detached, and both mean "this is the project's own answer now".
 */
export async function computeAgentSync(projectRoot: string, options: AgentSyncOptions = {}): Promise<AgentSyncSummary> {
  if (!projectRoot) return EMPTY;
  const records = Object.values(readAgentForks(projectRoot)).sort((a, b) => a.agentName.localeCompare(b.agentName));
  if (records.length === 0) return EMPTY;

  const summary: AgentSyncSummary = {
    materialized: [],
    refreshed: [],
    staleCustomized: [],
    unchanged: [],
    diverged: [],
    entries: [],
  };
  for (const record of records) {
    const { entry, verdict } = await buildEntry(projectRoot, record, options);
    // `no-template` is a template that has gone away — the plugin was uninstalled, or the user
    // deleted `~/.claude/agents/<name>.md`. Nothing to compare and nothing to offer, so it is
    // reported as unchanged rather than as a problem the user is expected to fix.
    if (verdict === "materialize") summary.materialized.push(entry.agentName);
    else if (verdict === "refresh") summary.refreshed.push(entry.agentName);
    else if (verdict === "stale-customized") summary.staleCustomized.push(entry.agentName);
    else summary.unchanged.push(entry.agentName);

    if (verdict === "refresh" || (verdict === "stale-customized" && entry.templateAdvanced)) {
      summary.diverged.push(entry.agentName);
    }
    summary.entries.push(entry);
  }
  return summary;
}

/**
 * Apply ONE review action to ONE forked agent — the only thing in this module that writes.
 *
 *   update — take the template's new body, keep my name and description (`mergeForkBody`), and
 *            re-stamp the record so the fork is now tracking the template it just took.
 *   keep   — leave the file alone but record the template state that was declined, so the same
 *            diff is not raised again until the template moves on. "Ask me again next version."
 *   detach — drop the provenance record and nothing else. The `.md` stays; it is just a project
 *            agent now, and no sync will look at it again.
 */
export async function applyAgentSync(
  projectRoot: string,
  agentName: string,
  action: AgentSyncAction,
  options: AgentSyncOptions = {}
): Promise<AgentSyncApplyResult> {
  if (!projectRoot) throw new Error("No project is open.");
  const record = readAgentForks(projectRoot)[agentName];
  if (!record) throw new Error(`"${agentName}" has no fork record — there is nothing to sync.`);

  if (action === "detach") {
    removeAgentFork(projectRoot, agentName);
    return { agentName, action, fileWritten: null, record: null };
  }

  const template = await resolveTemplate(record, options);
  if (!template) {
    throw new Error(
      `The template "${agentName}" was forked from is no longer installed, so there is nothing to compare against. ` +
        `Detach it to stop tracking.`
    );
  }

  if (action === "keep") {
    const next: AgentForkRecord = {
      ...record,
      acknowledgedFrom: { pluginVersion: template.version, templateBodyHash: hashAgentBody(template.contents) },
    };
    writeAgentForkRecord(projectRoot, next);
    return { agentName, action, fileWritten: null, record: next };
  }

  const local = await readAgentFrom(projectAgentsDir(projectRoot), agentName);
  // With the fork's own file gone there is nothing to carry the description over FROM, so the
  // recorded template body stands in for it — which is what the fork was at the moment it was
  // taken. The rename below is what keeps a renamed fork's identity across that.
  const forkSide = local ? fs.readFileSync(local.file, "utf8") : record.templateBody;
  let merged = mergeForkBody(template.contents, forkSide);
  try {
    merged = renameAgentInFrontmatter(merged, agentName);
  } catch {
    // No frontmatter, or no `name:` line to rewrite — the merge stands as-is rather than the
    // update failing over a file shape this app did not author.
  }

  const file = local?.file ?? path.join(projectAgentsDir(projectRoot), `${agentName}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, merged, "utf8");

  const next: AgentForkRecord = {
    ...record,
    pluginVersion: record.sourceTier === "plugin" ? template.version : null,
    templateBodyHash: hashAgentBody(template.contents),
    templateBody: template.contents,
    acknowledgedFrom: null,
  };
  writeAgentForkRecord(projectRoot, next);
  return { agentName, action, fileWritten: file, record: next };
}
