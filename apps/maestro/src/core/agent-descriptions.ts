// Writing an agent's `description` back to the `.md` it was discovered in.
//
// This is the ONE place the app edits a subagent definition in place, and it is deliberately not
// modelled like the other per-agent attributes. `agent-types.ts`, `agent-project-tags.ts` and
// `avatar-store.ts` all keep their value in a global sqlite store keyed by agent name, because
// those three are Maestro's own metadata and mean nothing to a Claude session. A description is
// the opposite: it is the line Claude Code itself reads to decide when to dispatch the agent, so
// an override kept beside the file would make the app show one sentence while every run used
// another. The only truthful place to write it is the frontmatter.
//
// Resolution follows `discoverAgents`' own priority — project, user, bundled, plugins — so the
// file this writes is the file whose description the /agents list is showing. Anything else would
// edit an agent the user cannot see.

import fs from "node:fs";
import path from "node:path";
import {
  CLAUDE_DIR,
  getInstalledPlugins,
  readAgentEntriesFromDir,
  rebaseOnClaudeDir,
  type AgentEntry,
} from "@repo/claude-fs";
import { EDITABLE_AGENT_SOURCES, isEditableAgentSource, type AgentDescriptionResult } from "./contracts.js";

export { EDITABLE_AGENT_SOURCES, isEditableAgentSource };
export type { AgentDescriptionResult };

/** An agent's definition file, plus the tier it was found in — the same `source` `discoverAgents` reports. */
export interface AgentFileRef {
  name: string;
  description: string;
  file: string;
  source: string;
}

async function pluginAgentEntries(): Promise<Array<AgentEntry & { plugin: string }>> {
  const plugins = await getInstalledPlugins();
  const out: Array<AgentEntry & { plugin: string }> = [];
  for (const p of plugins) {
    const agents = await readAgentEntriesFromDir(path.join(rebaseOnClaudeDir(p.installPath), "agents"));
    for (const a of agents) out.push({ ...a, plugin: p.pluginName });
  }
  return out;
}

/**
 * Where one agent's definition lives, searched in `discoverAgents`' priority order. Null when no
 * tier has an agent by that name — which is what a stale list looks like after a file was deleted
 * behind the app's back.
 */
export async function findAgentFile(
  projectRoot: string,
  bundledDir: string | null,
  agentName: string
): Promise<AgentFileRef | null> {
  const tiers: Array<{ source: string; entries: Promise<AgentEntry[]> }> = [
    {
      source: "project",
      entries: projectRoot ? readAgentEntriesFromDir(path.join(projectRoot, ".claude", "agents")) : Promise.resolve([]),
    },
    { source: "user", entries: readAgentEntriesFromDir(path.join(CLAUDE_DIR, "agents")) },
    { source: "maestro", entries: bundledDir ? readAgentEntriesFromDir(bundledDir) : Promise.resolve([]) },
  ];

  for (const tier of tiers) {
    const hit = (await tier.entries).find((a) => a.name === agentName);
    if (hit) return { name: hit.name, description: hit.description, file: hit.file, source: tier.source };
  }

  const fromPlugin = (await pluginAgentEntries()).find((a) => a.name === agentName);
  if (fromPlugin) {
    return {
      name: fromPlugin.name,
      description: fromPlugin.description,
      file: fromPlugin.file,
      source: fromPlugin.plugin,
    };
  }
  return null;
}

/**
 * Frontmatter is one line per key here (`parseFrontmatter` splits on the first `:` and has no
 * notion of depth), so a description is always a single line. Collapse every whitespace run —
 * the editor is a textarea and a pasted newline would otherwise split the key in two and corrupt
 * the block.
 */
export function normalizeAgentDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim();
}

/**
 * Why a tier's file can't be written, in words that point at the actual reason rather than a
 * generic "not editable" — a `user` agent is not "created in some other project" (it belongs to no
 * project at all, so there is nowhere to send the user to edit it) and a `maestro`/plugin agent is
 * not merely unowned (a plugin update overwrites it, so an edit there would be silently temporary).
 */
export function describeUneditableSource(agentName: string, source: string): string {
  if (source === "user") {
    return (
      `"${agentName}" lives in ~/.claude/agents — it belongs to no project, it's shared by every ` +
      `project on this machine, and there's nowhere else to edit it. Fork it into this project to customise it here.`
    );
  }
  return (
    `"${agentName}" is shipped by the ${source} plugin — the next plugin update overwrites its file, ` +
    `so an edit there would be silently temporary. Fork it into this project to customise it here.`
  );
}

function quoteYaml(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Exported so `agent-fork.ts` can locate the same block for renaming and for hashing. */
export const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Rewrite the `description:` line of a frontmatter block, leaving every other line — and the body
 * below it — byte-identical.
 *
 * Refuses a value this reader cannot round-trip rather than flattening it: a YAML block scalar
 * (`|`, `>`) or a value continued on following lines is legal frontmatter that `parseFrontmatter`
 * already misreads, and replacing only its first line would leave the continuation dangling as
 * garbage keys.
 */
export function replaceDescriptionInFrontmatter(contents: string, description: string): string {
  const match = contents.match(FRONTMATTER);
  if (!match) throw new Error("This agent's file has no frontmatter block to write a description into.");

  const lines = match[1].split("\n");
  const index = lines.findIndex((l) => /^description\s*:/.test(l));
  const line = `description: "${quoteYaml(description)}"`;

  if (index === -1) {
    // No description yet: put it directly after `name:`, which is where every file this app writes
    // has it, rather than at the top where it would read as the agent's identity.
    const afterName = lines.findIndex((l) => /^name\s*:/.test(l));
    lines.splice(afterName === -1 ? lines.length : afterName + 1, 0, line);
  } else {
    const value = lines[index].slice(lines[index].indexOf(":") + 1).trim();
    if (/^[|>]/.test(value)) {
      throw new Error("This agent's description is a YAML block scalar, which this editor can't rewrite safely.");
    }
    const next = lines[index + 1];
    const continued = next !== undefined && next.trim() !== "" && /^\s/.test(next);
    if (value === "" || continued) {
      throw new Error("This agent's description spans several lines, which this editor can't rewrite safely.");
    }
    lines[index] = line;
  }

  // The pattern is anchored at the start of the string with no `m` flag, so the block is always
  // the file's first bytes and everything after `match[0]` is the untouched body.
  return `---\n${lines.join("\n")}\n---` + contents.slice(match[0].length);
}

/**
 * Write one agent's description into its own definition file.
 *
 * Throws — rather than silently no-opping — on every reason the write cannot be honoured: an agent
 * that no longer exists, a tier this app does not own, and a file the OS will not let us write
 * (a packaged build's `app.asar` is the case that matters; the bundled Maestro agents are ordinary
 * files in the repo but read-only resources once the app is packaged).
 */
export async function setAgentDescription(
  projectRoot: string,
  bundledDir: string | null,
  agentName: string,
  description: string
): Promise<AgentDescriptionResult> {
  const normalized = normalizeAgentDescription(description);
  if (!normalized) throw new Error("A description can't be empty.");

  const ref = await findAgentFile(projectRoot, bundledDir, agentName);
  if (!ref) throw new Error(`No definition file found for "${agentName}".`);
  if (!isEditableAgentSource(ref.source)) {
    throw new Error(describeUneditableSource(agentName, ref.source));
  }

  try {
    fs.accessSync(ref.file, fs.constants.W_OK);
  } catch {
    throw new Error(`${ref.file} is not writable — this build ships it read-only.`);
  }

  const contents = fs.readFileSync(ref.file, "utf8");
  fs.writeFileSync(ref.file, replaceDescriptionInFrontmatter(contents, normalized), "utf8");
  return { description: normalized, file: ref.file, source: ref.source };
}
