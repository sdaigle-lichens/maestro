// Keeping a forked agent in step with its template (`031`).
//
// What's worth pinning, in the order the acceptance criteria state it: an untouched fork whose
// template advanced is refreshable and taking the refresh keeps the user's description; an edited
// one is stale-but-customized and is never overwritten; an agent with no provenance record is
// invisible to all of this; plugin forks are checked by VERSION and user forks by content hash;
// a plugin change shipped without a version bump reports no update; and computing the summary
// writes nothing at all — asserted on file mtimes, because that is the criterion.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyAgentSync, computeAgentSync, type AgentSyncOptions } from "../../src/core/agent-sync.js";
import { hashAgentBody, readAgentForks, writeAgentForkRecord } from "../../src/core/agent-fork-record.js";
import type { AgentForkRecord } from "../../src/core/contracts.js";

const BODY_V1 = "\n# Reviewer\n\nYou review code.\n\n- one\n- two\n";
const BODY_V2 = "\n# Reviewer\n\nYou review code, strictly.\n\n- one\n- two\n- three\n";

function agentFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
}

describe("computeAgentSync / applyAgentSync", () => {
  let root: string;
  let pluginAgents: string;
  let userAgents: string;
  let options: AgentSyncOptions;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-sync-"));
    fs.mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
    pluginAgents = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-sync-plugin-"));
    userAgents = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-sync-user-"));
    // Never the real machine's ~/.claude/agents or installed_plugins.json.
    options = { userAgentsDir: userAgents, pluginSources: { maestro: { agentsDir: pluginAgents, version: "0.4.0" } } };
  });

  afterEach(() => {
    for (const dir of [root, pluginAgents, userAgents]) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A plugin-tier fork of `reviewer`, forked at `forkedVersion`, with the plugin now at 0.4.0. */
  function seedPluginFork(opts: { forkedVersion: string | null; localBody?: string; localDescription?: string }): void {
    const template = agentFile("reviewer", "Reviews PRs.", BODY_V1);
    fs.writeFileSync(path.join(pluginAgents, "reviewer.md"), agentFile("reviewer", "Reviews PRs.", BODY_V2), "utf8");
    fs.writeFileSync(
      path.join(root, ".claude", "agents", "reviewer.md"),
      agentFile("reviewer", opts.localDescription ?? "My own words for it.", opts.localBody ?? BODY_V1),
      "utf8"
    );
    const record: AgentForkRecord = {
      agentName: "reviewer",
      sourceTier: "plugin",
      sourcePlugin: "maestro",
      pluginVersion: opts.forkedVersion,
      templateBodyHash: hashAgentBody(template),
      templateBody: template,
      forkedAt: new Date().toISOString(),
    };
    writeAgentForkRecord(root, record);
  }

  it("reports an untouched fork whose plugin version advanced as refreshable", async () => {
    seedPluginFork({ forkedVersion: "0.3.4" });
    const summary = await computeAgentSync(root, options);
    expect(summary.refreshed).toEqual(["reviewer"]);
    expect(summary.diverged).toEqual(["reviewer"]);
    const entry = summary.entries[0];
    expect(entry.trackedVersion).toBe("0.3.4");
    expect(entry.templateVersion).toBe("0.4.0");
    expect(entry.templateAdvanced).toBe(true);
    expect(entry.diff.some((l) => l.kind === "add" && l.text.includes("strictly"))).toBe(true);
  });

  it("takes the new body on update and leaves the description exactly as the user wrote it", async () => {
    seedPluginFork({ forkedVersion: "0.3.4", localDescription: "My own words for it." });
    const result = await applyAgentSync(root, "reviewer", "update", options);

    const written = fs.readFileSync(result.fileWritten!, "utf8");
    expect(written).toBe(agentFile("reviewer", "My own words for it.", BODY_V2));
    expect(readAgentForks(root).reviewer.pluginVersion).toBe("0.4.0");

    // And the fork is now in step: a second pass finds nothing to do.
    expect((await computeAgentSync(root, options)).diverged).toEqual([]);
  });

  it("reports an edited fork as stale-but-customized and never overwrites it", async () => {
    seedPluginFork({ forkedVersion: "0.3.4", localBody: "\n# Reviewer\n\nMy own body entirely.\n" });
    const file = path.join(root, ".claude", "agents", "reviewer.md");
    const before = fs.readFileSync(file, "utf8");

    const summary = await computeAgentSync(root, options);
    expect(summary.staleCustomized).toEqual(["reviewer"]);
    expect(summary.refreshed).toEqual([]);
    expect(summary.diverged).toEqual(["reviewer"]); // the template DID move, so it is worth saying
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("does not count a customized fork whose template has NOT moved", async () => {
    seedPluginFork({ forkedVersion: "0.4.0", localBody: "\n# Reviewer\n\nMy own body entirely.\n" });
    const summary = await computeAgentSync(root, options);
    expect(summary.staleCustomized).toEqual(["reviewer"]);
    expect(summary.diverged).toEqual([]);
  });

  it("never reports or touches an agent with no provenance record", async () => {
    fs.writeFileSync(
      path.join(root, ".claude", "agents", "handwritten.md"),
      agentFile("handwritten", "Mine.", BODY_V1),
      "utf8"
    );
    expect(await computeAgentSync(root, options)).toMatchObject({ entries: [], diverged: [] });
  });

  it("reports NO update available when a plugin ships a changed body without bumping its version", async () => {
    // The template's body has moved (BODY_V2) but the version string has not — which is exactly
    // what a plugin edit shipped without a plugin.json bump looks like, and autoUpdate never
    // re-pulls it. Promising an update here would promise one no delivery path can deliver.
    seedPluginFork({ forkedVersion: "0.4.0" });
    const summary = await computeAgentSync(root, options);
    expect(summary.refreshed).toEqual([]);
    expect(summary.unchanged).toEqual(["reviewer"]);
    expect(summary.entries[0].templateAdvanced).toBe(false);
  });

  it("checks a user-tier fork by template content hash, since ~/.claude/agents has no version", async () => {
    const template = agentFile("scribe", "Documents things.", BODY_V1);
    fs.writeFileSync(path.join(userAgents, "scribe.md"), template, "utf8");
    fs.writeFileSync(path.join(root, ".claude", "agents", "scribe.md"), template, "utf8");
    writeAgentForkRecord(root, {
      agentName: "scribe",
      sourceTier: "user",
      sourcePlugin: null,
      pluginVersion: null,
      templateBodyHash: hashAgentBody(template),
      templateBody: template,
      forkedAt: new Date().toISOString(),
    });

    expect((await computeAgentSync(root, options)).diverged).toEqual([]);

    // Hand-edit the machine-wide template — no version anywhere, so only the hash can notice.
    fs.writeFileSync(path.join(userAgents, "scribe.md"), agentFile("scribe", "Documents things.", BODY_V2), "utf8");
    expect((await computeAgentSync(root, options)).refreshed).toEqual(["scribe"]);
  });

  it("ignores a description-only change to the template — the description does not track", async () => {
    const template = agentFile("scribe", "Documents things.", BODY_V1);
    fs.writeFileSync(path.join(userAgents, "scribe.md"), template, "utf8");
    fs.writeFileSync(path.join(root, ".claude", "agents", "scribe.md"), template, "utf8");
    writeAgentForkRecord(root, {
      agentName: "scribe",
      sourceTier: "user",
      sourcePlugin: null,
      pluginVersion: null,
      templateBodyHash: hashAgentBody(template),
      templateBody: template,
      forkedAt: new Date().toISOString(),
    });
    fs.writeFileSync(path.join(userAgents, "scribe.md"), agentFile("scribe", "A whole new sentence.", BODY_V1), "utf8");
    expect((await computeAgentSync(root, options)).diverged).toEqual([]);
  });

  it("tracks a RENAMED fork without calling it modified — the name line is normalised out", async () => {
    const template = agentFile("reviewer", "Reviews PRs.", BODY_V1);
    fs.writeFileSync(path.join(pluginAgents, "reviewer.md"), template, "utf8");
    // What forkAgent writes for a rename: the same bytes with only `name:` rewritten.
    fs.writeFileSync(
      path.join(root, ".claude", "agents", "strict-reviewer.md"),
      agentFile("strict-reviewer", "Reviews PRs.", BODY_V1),
      "utf8"
    );
    writeAgentForkRecord(root, {
      agentName: "strict-reviewer",
      sourceTier: "plugin",
      sourcePlugin: "maestro",
      pluginVersion: "0.4.0",
      templateBodyHash: hashAgentBody(template),
      templateBody: template,
      forkedAt: new Date().toISOString(),
    });
    const summary = await computeAgentSync(root, options);
    expect(summary.staleCustomized).toEqual([]);
    expect(summary.unchanged).toEqual(["strict-reviewer"]);
    // And an update keeps the fork's own name, not the template's.
    fs.writeFileSync(path.join(pluginAgents, "reviewer.md"), agentFile("reviewer", "Reviews PRs.", BODY_V2), "utf8");
    const bumped: AgentSyncOptions = {
      ...options,
      pluginSources: { maestro: { agentsDir: pluginAgents, version: "0.5.0" } },
    };
    expect((await computeAgentSync(root, bumped)).refreshed).toEqual(["strict-reviewer"]);
    await applyAgentSync(root, "strict-reviewer", "update", bumped);
    expect(fs.readFileSync(path.join(root, ".claude", "agents", "strict-reviewer.md"), "utf8")).toBe(
      agentFile("strict-reviewer", "Reviews PRs.", BODY_V2)
    );
  });

  it("keeps as a fork by acknowledging the template it declined, and asks again when that moves", async () => {
    seedPluginFork({ forkedVersion: "0.3.4" });
    await applyAgentSync(root, "reviewer", "keep", options);
    expect(readAgentForks(root).reviewer.acknowledgedFrom?.pluginVersion).toBe("0.4.0");
    expect((await computeAgentSync(root, options)).diverged).toEqual([]);

    const bumped: AgentSyncOptions = {
      ...options,
      pluginSources: { maestro: { agentsDir: pluginAgents, version: "0.5.0" } },
    };
    expect((await computeAgentSync(root, bumped)).refreshed).toEqual(["reviewer"]);
  });

  it("detaches by removing only the provenance record — the file stays exactly where it was", async () => {
    seedPluginFork({ forkedVersion: "0.3.4" });
    const file = path.join(root, ".claude", "agents", "reviewer.md");
    const before = fs.readFileSync(file, "utf8");

    const result = await applyAgentSync(root, "reviewer", "detach", options);
    expect(result).toEqual({ agentName: "reviewer", action: "detach", fileWritten: null, record: null });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(readAgentForks(root)).toEqual({});
    expect((await computeAgentSync(root, options)).entries).toEqual([]);
  });

  it("writes NOTHING when computing the summary — no agent file's mtime moves", async () => {
    seedPluginFork({ forkedVersion: "0.3.4" });
    fs.writeFileSync(path.join(root, ".claude", "agents", "other.md"), agentFile("other", "Other.", BODY_V1), "utf8");

    const watched = [
      path.join(root, ".claude", "agents", "reviewer.md"),
      path.join(root, ".claude", "agents", "other.md"),
      path.join(root, ".claude", "agent-forks.json"),
    ];
    const before = watched.map((f) => fs.statSync(f).mtimeMs);
    // A same-millisecond write would be invisible to mtime alone, so compare the bytes too.
    const bytesBefore = watched.map((f) => fs.readFileSync(f, "utf8"));

    await computeAgentSync(root, options);
    await computeAgentSync(root, options);

    expect(watched.map((f) => fs.statSync(f).mtimeMs)).toEqual(before);
    expect(watched.map((f) => fs.readFileSync(f, "utf8"))).toEqual(bytesBefore);
    // And no directory was created either.
    expect(fs.readdirSync(path.join(root, ".claude", "agents")).sort()).toEqual(["other.md", "reviewer.md"]);
  });

  it("refuses to update a fork whose template is no longer installed, and says to detach instead", async () => {
    seedPluginFork({ forkedVersion: "0.3.4" });
    fs.rmSync(path.join(pluginAgents, "reviewer.md"));
    const summary = await computeAgentSync(root, options);
    expect(summary.unchanged).toEqual(["reviewer"]);
    expect(summary.entries[0].templateFile).toBeNull();
    await expect(applyAgentSync(root, "reviewer", "update", options)).rejects.toThrow(/no longer installed/);
  });

  it("rejects an agent it has no fork record for", async () => {
    await expect(applyAgentSync(root, "ghost", "update", options)).rejects.toThrow(/no fork record/);
  });
});
