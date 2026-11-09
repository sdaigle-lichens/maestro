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
// `172`: `offered_skills` is what maestro-subagent-log.js stamps on a WORKFLOW agent's dispatch;
// `helperDispatch` is an agent on no workflow (Explore, plan-reviewer), which carries none.
const dispatch = (id: string, agent: string): Entry => ({
  kind: "dispatch",
  origin: "main_session",
  agent,
  agent_id: id,
  input: "go",
  offered_skills: { loaded: [], referenced: [] },
});
const helperDispatch = (id: string, agent: string): Entry => ({
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

function digest(entries: Entry[], json = true, sessionState: Entry = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm165-"));
  const dir = path.join(root, ".claude", "maestro_sessions", SID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify(sessionState));
  const args = [SCRIPT, root, "--session", SID, ...(json ? ["--json"] : [])];
  const res = spawnSync("node", args, { encoding: "utf8" });
  fs.rmSync(root, { recursive: true, force: true });
  return res.stdout;
}

// What 160's SubagentStop hook writes for an interim stop: status unknown, no label, `interim: true`.
const interimStop = (id: string, agent: string): Entry =>
  handoff(id, agent, null, {
    interim: true,
    output: "Build started in the background; waiting for it.",
    log: "interim stop (no hand-back yet)",
  });

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
  interimStop("a5", "frontend"),
  handoff("a5", "frontend", "success"),
  dispatch("a6", "infra"),
  // a6's interim stop is its last: never followed by a final stop, so the digest infers missing.
  interimStop("a6", "infra"),
  dispatch("a7", "mobile"),
  dispatch("a8", "refactor"),
  handoff("a8", "refactor", "needs-review"),
];

describe("post-mortem digest outcomes", () => {
  it("tallies every outcome kind; a resumed interim stop counts only as its final outcome", () => {
    const a = JSON.parse(digest(session));
    expect(a.outcomes).toEqual({
      success: 2,
      fail: 1,
      blocked: 1,
      "missing HANDOFF": 2, // a4 (final stop, no HANDOFF line) and a6 (interim, never finished)
      "no-return": 1,
      "needs-review": 1,
    });
    expect(a.problems.map((p: { agent: string }) => p.agent).sort()).toEqual(
      ["infra", "mobile", "refactor", "reviewer", "scribe", "test"].sort()
    );
    const byId = Object.fromEntries(a.subagents.map((s: { agent_id: string }) => [s.agent_id, s]));
    expect(byId.a5.interim).toBe(false);
    expect(byId.a6.interim).toBe(true);
    expect(a.subagents[0]).not.toHaveProperty("settledMissing");
  });

  it("renders the problems before the timeline and flags only the real missing HANDOFF", () => {
    const md = digest(session, false);
    expect(md.indexOf("## Problems")).toBeGreaterThan(-1);
    expect(md.indexOf("## Problems")).toBeLessThan(md.indexOf("## Subagent timeline"));
    expect(md).toMatch(/Handoff outcomes\*\*: .*blocked: 1/);
    // Final stop without a HANDOFF line: the plain warning, exactly once (a4 only).
    expect(md.match(/no parseable HANDOFF: label/g)).toHaveLength(1);
    // The never-finished interim stop (a6) is missing, and the digest says it is inferred.
    expect(md.match(/missing HANDOFF \(inferred from the log/g)).toHaveLength(2); // Problems + timeline
    expect(md).toMatch(/\*\*infra\*\* `a6` → missing HANDOFF \(inferred from the log/);
    expect(md).not.toMatch(/\*\*frontend\*\* `a5`.*missing/);
  });

  it("infers missing for a never-resumed interim stop and ignores a resumed one", () => {
    const entries: Entry[] = [
      dispatch("r1", "backend"),
      interimStop("r1", "backend"),
      handoff("r1", "backend", "success"), // resumed and finished: never missing
      dispatch("m1", "test"),
      interimStop("m1", "test"), // never resumed
    ];
    const a = JSON.parse(digest(entries));
    expect(a.outcomes).toEqual({ success: 1, "missing HANDOFF": 1 });
    expect(a.problems.map((p: { agent: string }) => p.agent)).toEqual(["test"]);
  });

  // The real SubagentStart writes a FRESH dispatch entry on a resume, with the same agent_id (160's
  // own tests model it that way). One resumed run is one outcome, not one per dispatch entry.
  it("a resumed run with two dispatch entries for one agent_id is counted once", () => {
    const entries: Entry[] = [
      dispatch("r2", "backend"),
      interimStop("r2", "backend"),
      dispatch("r2", "backend"),
      handoff("r2", "backend", "success"),
    ];
    const a = JSON.parse(digest(entries));
    expect(a.outcomes).toEqual({ success: 1 });
    expect(a.subagents).toHaveLength(1);
  });

  // 172: a helper on no workflow is never asked for a HANDOFF line, so ending without one is not a
  // problem; a workflow agent that ends with no label still is.
  it("does not list helpers on no workflow under Problems, and still flags a workflow agent with no label", () => {
    const entries: Entry[] = [
      helperDispatch("h1", "Explore"),
      handoff("h1", "Explore", null), // final stop, no HANDOFF line
      helperDispatch("h2", "maestro:plan-reviewer"),
      interimStop("h2", "maestro:plan-reviewer"), // interim, never finished
      dispatch("w1", "backend"),
      handoff("w1", "backend", null), // a workflow agent with no label
    ];
    const a = JSON.parse(digest(entries));
    expect(a.problems.map((p: { agent_id: string }) => p.agent_id)).toEqual(["w1"]);
    expect(a.outcomes).toEqual({ "missing HANDOFF": 1, "helper (no HANDOFF expected)": 2 });

    const md = digest(entries, false);
    const problems = md.slice(md.indexOf("## Problems"), md.indexOf("## Subagent timeline"));
    expect(problems).toContain("**backend** `w1` → missing HANDOFF");
    expect(problems).not.toContain("Explore");
    expect(problems).not.toContain("plan-reviewer");
    expect(md).toContain("**Explore** `h1` → helper (no HANDOFF expected)");
    expect(md.match(/no parseable HANDOFF: label/g)).toHaveLength(1); // w1 only
    expect(md).not.toMatch(/missing HANDOFF \(inferred from the log/);
  });

  // 172: a helper resumed after an interim stop has two dispatch entries under one agent_id. Its
  // first dispatch carries no offered_skills, so it stays a helper, is one row, and is not a problem
  // whether the resumed run ends with no label, with a HANDOFF label, or still interim.
  it("a helper on no workflow resumed with two dispatch entries is one helper row, not a problem", () => {
    const entries: Entry[] = [
      helperDispatch("hr1", "Explore"),
      interimStop("hr1", "Explore"),
      helperDispatch("hr1", "Explore"), // the resume's dispatch entry
      handoff("hr1", "Explore", null), // the resumed run ends with no label
      helperDispatch("hr2", "maestro:plan-reviewer"),
      interimStop("hr2", "maestro:plan-reviewer"),
      helperDispatch("hr2", "maestro:plan-reviewer"),
      handoff("hr2", "maestro:plan-reviewer", "success"), // a helper that did end with a label
    ];
    const a = JSON.parse(digest(entries));
    expect(a.subagents).toHaveLength(2);
    expect(a.problems).toEqual([]);
    expect(a.outcomes).toEqual({ "helper (no HANDOFF expected)": 1, success: 1 });
    const md = digest(entries, false);
    const problems = md.slice(md.indexOf("## Problems"), md.indexOf("## Subagent timeline"));
    expect(problems).not.toContain("missing HANDOFF");
    expect(md).toContain("**Explore** `hr1` → helper (no HANDOFF expected)");
  });

  // 172 (edge, pinned as the digest reports it today): a helper that never stopped is not asked for a
  // HANDOFF line, but it is a no-return rather than a missing one, so it still appears under Problems.
  it("a helper on no workflow that never returned is still listed under Problems as no-return", () => {
    const entries: Entry[] = [helperDispatch("hn1", "Explore")];
    const a = JSON.parse(digest(entries));
    expect(a.outcomes).toEqual({ "no-return": 1 });
    expect(a.problems.map((p: { agent_id: string }) => p.agent_id)).toEqual(["hn1"]);
    expect(a.problems[0].helper).toBe(true);
  });
});
