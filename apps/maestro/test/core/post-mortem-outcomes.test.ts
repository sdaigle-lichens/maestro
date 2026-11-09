// 165: the post-mortem digest lists EVERY recorded outcome kind, and an agent's interim stop is
// never read as a missing HANDOFF.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findUpPluginRoot } from "../../src/core/install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(findUpPluginRoot(here)!, "scripts", "maestro-post-mortem.js");
const SID = "sess-165";

type Entry = Record<string, unknown>;
const dispatch = (id: string, agent: string): Entry => ({
  kind: "dispatch",
  origin: "main_session",
  agent,
  agent_id: id,
  input: "go",
});
const handoff = (id: string, agent: string, label: string | null, extra: Entry = {}): Entry => ({
  kind: "handoff",
  origin: agent,
  agent_id: id,
  status: label === null ? "unknown" : label === "success" ? "success" : "condition",
  label,
  output: "done",
  ...extra,
});

function digest(entries: Entry[], json = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm165-"));
  const dir = path.join(root, ".claude", "maestro_sessions", SID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "session.json"), "{}");
  const args = [SCRIPT, root, "--session", SID, ...(json ? ["--json"] : [])];
  const res = spawnSync("node", args, { encoding: "utf8" });
  fs.rmSync(root, { recursive: true, force: true });
  return res.stdout;
}

const session: Entry[] = [
  dispatch("a1", "backend"),
  handoff("a1", "backend", "success"),
  dispatch("a2", "test"),
  handoff("a2", "test", "fail"),
  dispatch("a3", "reviewer"),
  handoff("a3", "reviewer", "blocked"),
  dispatch("a4", "scribe"),
  handoff("a4", "scribe", null),
  dispatch("a5", "frontend"),
  // a5 stopped interim (no HANDOFF line), was resumed, and finished: only the final stop counts.
  handoff("a5", "frontend", null, { interim: true }),
  handoff("a5", "frontend", "success"),
  dispatch("a6", "infra"),
  // a6's interim stop is its latest entry: paused, not a missing HANDOFF.
  handoff("a6", "infra", null, { interim: true }),
  dispatch("a7", "mobile"),
  dispatch("a8", "refactor"),
  handoff("a8", "refactor", "needs-review"),
];

describe("post-mortem digest outcomes", () => {
  it("tallies every outcome kind and never counts an interim stop as missing", () => {
    const a = JSON.parse(digest(session));
    expect(a.outcomes).toEqual({
      success: 2,
      fail: 1,
      blocked: 1,
      "missing HANDOFF": 1,
      interim: 1,
      "no-return": 1,
      "needs-review": 1,
    });
    expect(a.problems.map((p: { agent: string }) => p.agent).sort()).toEqual(
      ["mobile", "refactor", "reviewer", "scribe", "test"].sort()
    );
  });

  it("renders the problems before the timeline and flags only the real missing HANDOFF", () => {
    const md = digest(session, false);
    expect(md.indexOf("## Problems")).toBeGreaterThan(-1);
    expect(md.indexOf("## Problems")).toBeLessThan(md.indexOf("## Subagent timeline"));
    expect(md).toMatch(/Handoff outcomes\*\*: .*blocked: 1/);
    expect(md.match(/no parseable HANDOFF: label/g)).toHaveLength(1);
    expect(md).toContain("interim stop (not finished)");
  });
});
