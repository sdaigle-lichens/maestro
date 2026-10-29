// `139`: `maestro-task-status.cjs handoff-issues` drops a `missing_payload` issue whose files are all in
// their lane now AND stamped with THIS run's run_id (a resumed agent's earlier file still exists, so
// reporting "NO PAYLOAD" would send the orchestrator after a file that is there). Anything less than
// that stays reported. Real installed scripts in a temp project, a temp HOME, nothing mocked;
// CLAUDE_CODE_SESSION_ID always pinned.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 30_000 });

const SESS = "sess-139-aaa";
const RUN = "run-139-current";
const BACKEND_FILE = ".claude/channels/backend/test.1.md";
const TEST_FILE = ".claude/channels/test/backend.1.md";

let tmp: string;
let home: string;
let root: string;

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-139-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
  root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function issues(): string {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-task-status.cjs"), "handoff-issues"], {
    encoding: "utf8",
    env: pinnedEnv(home, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SESS }),
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

const statePath = () => path.join(root, ".claude", "maestro_sessions", SESS, "session.json");
const readState = () => JSON.parse(fs.readFileSync(statePath(), "utf8"));

function writeState(extra: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(extra, null, 2));
}

/** A lane file, stamped with `runId` (null writes it unstamped). */
function lane(rel: string, runId: string | null) {
  const f = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${runId ? `<!-- maestro:run_id=${runId} -->\n` : ""}{"x":1}\n`);
}

const issue = (files: string[], over: Record<string, unknown> = {}) => ({
  ts: new Date().toISOString(),
  agent: "test",
  agent_id: "t1",
  kind: "missing_payload",
  verdict: null,
  label: "tests failed",
  files,
  // The real message names the files (missingLoopbackPayload); the report prints it.
  message: `expects ${files.join(", ")}`,
  ...over,
});

describe("handoff-issues drops a missing_payload resolved by a this-run file (139)", () => {
  it("resumed agent with a this-run file in the lane: no NO PAYLOAD, state cleared", () => {
    writeState({ run_id: RUN, handoff_issues: [issue([BACKEND_FILE])] });
    lane(BACKEND_FILE, RUN);

    const out = issues();
    expect(out).toContain("no problems recorded");
    expect(out).not.toContain("NO PAYLOAD");
    expect(readState().handoff_issues).toBeUndefined();
  });

  it("a file stamped with another run_id is not resolved: still reported", () => {
    writeState({ run_id: RUN, handoff_issues: [issue([BACKEND_FILE])] });
    lane(BACKEND_FILE, "run-139-OLD");

    const out = issues();
    expect(out).toContain("1 problem(s)");
    expect(out).toContain("NO PAYLOAD written for HANDOFF: tests failed (agent_id t1)");
    expect(out).toContain(BACKEND_FILE);
  });

  it("an unstamped file is not resolved: still reported", () => {
    writeState({ run_id: RUN, handoff_issues: [issue([BACKEND_FILE])] });
    lane(BACKEND_FILE, null);

    expect(issues()).toContain("NO PAYLOAD written");
  });

  it("the file is absent: still reported", () => {
    writeState({ run_id: RUN, handoff_issues: [issue([BACKEND_FILE])] });
    expect(issues()).toContain("NO PAYLOAD written");
  });

  it("session.json has no run_id: even a stamped file leaves the issue reported", () => {
    writeState({ handoff_issues: [issue([BACKEND_FILE])] });
    lane(BACKEND_FILE, RUN);

    expect(issues()).toContain("NO PAYLOAD written");
  });

  it("partial files: only one of two expected files is this-run, so it is still reported", () => {
    const other = ".claude/channels/backend/frontend.1.md";
    writeState({ run_id: RUN, handoff_issues: [issue([BACKEND_FILE, other])] });
    lane(BACKEND_FILE, RUN);

    const out = issues();
    expect(out).toContain("NO PAYLOAD written");
    expect(out).toContain(other);
  });

  it("both expected files this-run: dropped", () => {
    const other = ".claude/channels/backend/frontend.1.md";
    writeState({ run_id: RUN, handoff_issues: [issue([BACKEND_FILE, other])] });
    lane(BACKEND_FILE, RUN);
    lane(other, RUN);

    expect(issues()).toContain("no problems recorded");
  });

  it("a resolved issue is dropped while an unresolved one and a non-payload kind stay", () => {
    writeState({
      run_id: RUN,
      handoff_issues: [
        issue([BACKEND_FILE], { agent: "test", agent_id: "t1" }),
        issue([TEST_FILE], { agent: "backend", agent_id: "b1", label: "success" }),
        { ts: new Date().toISOString(), agent: "scribe", agent_id: "s1", kind: "missing", message: "no handoff line" },
      ],
    });
    lane(BACKEND_FILE, RUN); // resolves the first only

    const out = issues();
    expect(out).toContain("2 problem(s)");
    expect(out).not.toContain("test: NO PAYLOAD");
    expect(out).toContain("backend: NO PAYLOAD written for HANDOFF: success (agent_id b1)");
    expect(out).toContain("scribe: NO HANDOFF line");
  });

  it("a non-payload issue alone is untouched by the resolution step", () => {
    writeState({
      run_id: RUN,
      handoff_issues: [
        { ts: new Date().toISOString(), agent: "scribe", agent_id: "s1", kind: "missing", message: "m" },
      ],
    });
    lane(BACKEND_FILE, RUN);
    expect(issues()).toContain("scribe: NO HANDOFF line");
  });

  it("a missing_payload with no files is kept (nothing to prove it resolved)", () => {
    writeState({ run_id: RUN, handoff_issues: [issue([])] });
    expect(issues()).toContain("NO PAYLOAD written");
  });
});
