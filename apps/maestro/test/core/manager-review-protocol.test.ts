// `132`: the manager review protocol. `review-request` records a numbered request per ticket, the
// verdict counts manager redirects per ticket (not plan.loopbacks) and turns the third redirect into
// an escalation, the manager's `show`/`reports` surface open requests, and the review gate also
// holds a `manager review` stop: AskUserQuestion, and a SendMessage to the epic's manager, wait for
// that round's review file. Pure module first, then the real installed scripts against a temp
// project (HOME pinned, CLAUDE_CODE_SESSION_ID always set, never inherited).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  createEpic,
  linkTasks,
  writeReviewRequest,
  recordReviewVerdict,
  readEpicState,
  reviewHistory,
  showEpic,
  formatEpic,
  acknowledgeReport,
  MANAGER_REDIRECT_CAP,
} from "../../src/core/epics.js";
import { checkHumanReview, currentReviewStop } from "../../src/core/human-review-gate.js";
import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";
import { sessionPathsFor } from "../../src/core/session-paths.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const TASK = "200-direction.md";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-132-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");

function project(manager: string | undefined = "boss"): string {
  const root = path.join(tmp, "p");
  fs.mkdirSync(tasksDir(root), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(tasksDir(root), TASK), "# Direction\n\n## Blocked by\n\nNone\n");
  createEpic(root, "billing", manager ? { manager } : {});
  expect(linkTasks(root, "billing", [TASK]).missing).toEqual([]);
  return root;
}

function brief(root: string, round: number): string {
  const name = round <= 1 ? "200-direction.review.md" : `200-direction.review-${round}.md`;
  const file = path.join(tasksDir(root), name);
  fs.writeFileSync(file, "## Goal\n\nx\n");
  return file;
}

describe("writeReviewRequest", () => {
  it("records round 1, then numbers each new request for the ticket", () => {
    const root = project();
    const first = writeReviewRequest(root, TASK, brief(root, 1), "worker-1")!;
    expect(first).toMatchObject({
      epic: "billing",
      id: "m001",
      round: 1,
      manager: "boss",
      redirects: 0,
      already: false,
    });
    recordReviewVerdict(root, TASK, "redirect");
    const second = writeReviewRequest(root, TASK, brief(root, 2))!;
    expect(second).toMatchObject({ id: "m002", round: 2, redirects: 1, already: false });
  });

  it("is a re-send, not a new round, for the same open file", () => {
    const root = project();
    const file = brief(root, 1);
    writeReviewRequest(root, TASK, file);
    const again = writeReviewRequest(root, TASK, file)!;
    expect(again).toMatchObject({ id: "m001", round: 1, already: true });
    expect(reviewHistory(readEpicState(root, "billing")!, TASK).requests).toHaveLength(1);
  });

  it("refuses a missing review file or another task's file, and returns null outside an epic", () => {
    const root = project();
    expect(() => writeReviewRequest(root, TASK, path.join(tasksDir(root), "200-direction.review.md"))).toThrow(
      /does not exist/
    );
    fs.writeFileSync(path.join(tasksDir(root), "201-other.review.md"), "x");
    expect(() => writeReviewRequest(root, TASK, path.join(tasksDir(root), "201-other.review.md"))).toThrow(
      /not a review file/
    );
    fs.writeFileSync(path.join(tasksDir(root), "300-loose.md"), "# Loose\n");
    expect(writeReviewRequest(root, "300-loose.md", "whatever")).toBeNull();
  });
});

describe("recordReviewVerdict and the round cap", () => {
  it(`escalates the redirect after ${MANAGER_REDIRECT_CAP} redirects on the same ticket`, () => {
    const root = project();
    for (let round = 1; round <= MANAGER_REDIRECT_CAP; round += 1) {
      writeReviewRequest(root, TASK, brief(root, round));
      expect(recordReviewVerdict(root, TASK, "redirect")).toMatchObject({ effective: "redirect", capped: false });
    }
    writeReviewRequest(root, TASK, brief(root, MANAGER_REDIRECT_CAP + 1));
    const third = recordReviewVerdict(root, TASK, "redirect");
    expect(third).toMatchObject({ verdict: "redirect", effective: "escalate", capped: true, redirects: 2 });
  });

  it("counts redirects only, so on-track and escalate never use up the cap", () => {
    const root = project();
    writeReviewRequest(root, TASK, brief(root, 1));
    recordReviewVerdict(root, TASK, "on-track");
    writeReviewRequest(root, TASK, brief(root, 2));
    recordReviewVerdict(root, TASK, "escalate");
    writeReviewRequest(root, TASK, brief(root, 3));
    expect(recordReviewVerdict(root, TASK, "redirect")).toMatchObject({ effective: "redirect", redirects: 1 });
  });

  it("returns the recorded verdict to a second caller instead of recording another", () => {
    const root = project();
    writeReviewRequest(root, TASK, brief(root, 1));
    recordReviewVerdict(root, TASK, "redirect", "boss");
    const worker = recordReviewVerdict(root, TASK, "on-track", "worker-1");
    expect(worker).toMatchObject({ already: true, effective: "redirect", redirects: 1 });
    expect(reviewHistory(readEpicState(root, "billing")!, TASK).verdicts).toHaveLength(1);
  });

  it("refuses with no request, and refuses an unknown verdict", () => {
    const root = project();
    expect(() => recordReviewVerdict(root, TASK, "on-track")).toThrow(/no manager review request/);
    // @ts-expect-error: an invalid verdict from the CLI
    expect(() => recordReviewVerdict(root, TASK, "maybe")).toThrow(/not a verdict/);
  });
});

describe("show / reports surface open review requests", () => {
  it("lists a request until its verdict, never as ack-able", () => {
    const root = project();
    writeReviewRequest(root, TASK, brief(root, 1), "worker-1");
    const view = showEpic(root, "billing");
    expect(view.unacknowledged).toHaveLength(1);
    expect(view.unacknowledged[0]).toMatchObject({ kind: "review", id: "m001", round: 1, redirects: 0 });
    expect(view.unacknowledged[0].path).toBe(path.join(tasksDir(root), "200-direction.review.md"));
    expect(formatEpic(view)).toContain("m001  manager review round 1 for 200-direction.md (worker-1)  redirects 0/2");
    expect(() => acknowledgeReport(root, "billing", "m001")).toThrow(
      "`review-verdict --task 200-direction.md <on-track|redirect|escalate>`, not ack"
    );
    // The whole message, anchored: a substring match misses a dropped space before the backtick.
    expect(() => acknowledgeReport(root, "billing", "m001")).toThrow(
      /^"m001" is a manager review request: answer it with `review-verdict --task 200-direction\.md <on-track\|redirect\|escalate>`, not ack$/
    );
    recordReviewVerdict(root, TASK, "on-track");
    expect(showEpic(root, "billing").unacknowledged).toEqual([]);
  });

  it("drops a superseded request that never got a verdict", () => {
    const root = project();
    writeReviewRequest(root, TASK, brief(root, 1));
    writeReviewRequest(root, TASK, brief(root, 2));
    expect(showEpic(root, "billing").unacknowledged.map((e) => e.id)).toEqual(["m002"]);
  });
});

describe("the review gate at a manager review stop", () => {
  const dir = "/p/.claude/maestro-tasks";
  const plan = {
    steps: [
      { label: "@backend", status: "done" },
      { label: "manager review", status: "pending" },
    ],
  };
  const state = { active_task: TASK, plan };
  const judge = (toolName: string, to: string | undefined, files: string[] = [], managerName: string | null = "boss") =>
    checkHumanReview({
      tasksDir: dir,
      toolName,
      toolInput: { to },
      managerName,
      state,
      exists: (f) => files.includes(f),
    });

  it("finds the stop and numbers later review stops after it", () => {
    expect(currentReviewStop(plan)).toEqual({ label: "manager review", round: 1 });
    const later = {
      steps: [
        { label: "manager review", status: "done" },
        { label: "human review", status: "pending" },
      ],
    };
    expect(currentReviewStop(later)).toEqual({ label: "human review", round: 2 });
  });

  it("denies the request to the manager, and the question, until the brief exists", () => {
    const v = judge("SendMessage", "boss [3fa9c1]");
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.reason).toContain(`${dir}/200-direction.review.md`);
    expect(judge("AskUserQuestion", undefined).allow).toBe(false);
    expect(judge("SendMessage", "boss", [`${dir}/200-direction.review.md`]).allow).toBe(true);
  });

  it("leaves other messages, and an unknown manager, ungated", () => {
    expect(judge("SendMessage", "a1b2-c3d4").allow).toBe(true);
    expect(judge("SendMessage", "boss", [], null).allow).toBe(true);
  });
});

describe("maestro-epic.cjs review-request / review-verdict (installed scripts)", () => {
  async function installed(): Promise<string> {
    const root = project();
    writeConfig(root, defaultish);
    await installRuntime(
      root,
      PLUGIN_ROOT,
      path.join(tmp, "report-defaults.sqlite"),
      path.join(tmp, "project-tags.sqlite"),
      path.join(tmp, "handoff-defaults.sqlite")
    );
    return root;
  }
  const epic = (root: string, args: string[]) => {
    const res = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-epic.cjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp, CLAUDE_CODE_SESSION_ID: "sess-132" },
    });
    return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };

  it("prints the one line to send, then escalates the capped redirect", async () => {
    const root = await installed();
    const missing = epic(root, [
      "review-request",
      "--task",
      TASK,
      "--file",
      path.join(tasksDir(root), "200-direction.review.md"),
    ]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("does not exist");

    for (let round = 1; round <= 3; round += 1) {
      const req = epic(root, ["review-request", "--task", TASK, "--file", brief(root, round)]);
      expect(req.code).toBe(0);
      expect(req.stdout).toContain(`manager review m00${round} (round ${round}) for ${TASK} is in`);
      expect(req.stdout).toContain('manager session "boss"');
      const verdict = epic(root, ["review-verdict", "--task", TASK, "redirect"]);
      expect(verdict.code).toBe(0);
      expect(verdict.stdout).toContain(round <= 2 ? ": redirect" : ": escalate (asked: redirect");
    }
    expect(epic(root, ["reports", "billing"]).stdout).toContain("no unacknowledged reports, notes or review requests");
  });

  it("prints the human-review fallback for a task in no epic", async () => {
    const root = await installed();
    fs.writeFileSync(path.join(tasksDir(root), "300-loose.md"), "# Loose\n");
    const r = epic(root, ["review-request", "--task", "300-loose.md", "--file", "x.review.md"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Fall back to a human review");
  });
});

// ---------------------------------------------------------------------------------------------
// Test-agent coverage (`132`): the CLI fallbacks, the cap per ticket, the gate end to end through
// the real hook scripts with the plan driven by the real task-status CLI, and the matcher migration
// in both installers.
// ---------------------------------------------------------------------------------------------

const SID = "sess-132-test";
const GATE_CMD = 'node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-human-review-gate.cjs"';
const NEW_MATCHER = "AskUserQuestion|SendMessage";

function bareProject(): string {
  const root = path.join(tmp, "q");
  fs.mkdirSync(tasksDir(root), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(tasksDir(root), TASK), "# Direction\n\n## Blocked by\n\nNone\n");
  fs.writeFileSync(path.join(tasksDir(root), "201-sibling.md"), "# Sibling\n\n## Blocked by\n\nNone\n");
  return root;
}

const appInstall = (root: string) =>
  installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );

function run(script: string, root: string, args: string[]) {
  const res = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    cwd: root,
    env: pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SID }),
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("maestro-epic.cjs review protocol CLI: fallbacks, re-sends and the cap (installed scripts)", () => {
  let root: string;
  const epic = (args: string[]) => run(path.join(root, ".claude", "scripts", "maestro-epic.cjs"), root, args);
  const ok = (args: string[]) => {
    const r = epic(args);
    expect(r.code, r.stderr).toBe(0);
    return r.stdout;
  };
  const review = (task: string, round: number) => {
    const stem = task.replace(/\.md$/, "");
    const file = path.join(tasksDir(root), round <= 1 ? `${stem}.review.md` : `${stem}.review-${round}.md`);
    fs.writeFileSync(file, "## Goal\n\nx\n");
    return file;
  };

  beforeEach(async () => {
    root = bareProject();
    writeConfig(root, defaultish);
    await appInstall(root);
  });

  it("an epic with no manager records the request but tells the worker to fall back to human review", () => {
    ok(["create", "billing"]);
    ok(["link", "billing", TASK]);
    const out = ok(["review-request", "--task", TASK, "--file", review(TASK, 1)]);
    expect(out).toContain("review request recorded: m001, round 1");
    expect(out).toContain('No manager session is recorded for "billing": fall back to a human review');
    expect(out).not.toContain("SendMessage");
  });

  it("a task in no epic: review-request records nothing, review-verdict refuses", () => {
    const out = ok(["review-request", "--task", TASK, "--file", review(TASK, 1)]);
    expect(out).toContain(`"${TASK}" belongs to no epic`);
    expect(out).toContain("Fall back to a human review");
    expect(fs.existsSync(path.join(root, ".claude", "epics"))).toBe(false);
    const v = epic(["review-verdict", "--task", TASK, "on-track"]);
    expect(v.code).toBe(1);
    expect(v.stderr).toContain("belongs to no epic");
  });

  it("re-sending the same open brief is not a new round; show lists it; ack refuses it", () => {
    ok(["create", "billing", "--manager", "boss"]);
    ok(["link", "billing", TASK]);
    const file = review(TASK, 1);
    ok(["review-request", "--task", TASK, "--file", file, "--from", "worker-1"]);
    const again = ok(["review-request", "--task", TASK, "--file", file]);
    expect(again).toContain("review request already recorded, still waiting for a verdict: m001, round 1");
    const show = ok(["show", "billing"]);
    expect(show).toContain("unacknowledged reports, notes and review requests (1):");
    expect(show).toContain(`m001  manager review round 1 for ${TASK} (worker-1)  redirects 0/2  ${file}`);
    expect(ok(["reports", "billing"])).toContain(`m001  manager review round 1 for ${TASK}`);
    const ack = epic(["ack", "billing", "m001"]);
    expect(ack.code).toBe(1);
    expect(ack.stderr).toContain("review-verdict");
    // The rebuilt bundle carries the corrected hint, space before the backtick included.
    expect(ack.stderr).toContain(
      `"m001" is a manager review request: answer it with \`review-verdict --task ${TASK} <on-track|redirect|escalate>\`, not ack`
    );
  });

  it("accepts a brief path relative to the project root", () => {
    ok(["create", "billing", "--manager", "boss"]);
    ok(["link", "billing", TASK]);
    review(TASK, 1);
    const out = ok(["review-request", "--task", TASK, "--file", ".claude/maestro-tasks/200-direction.review.md"]);
    expect(out).toContain(`is in ${path.join(tasksDir(root), "200-direction.review.md")}`);
  });

  it("refuses an unknown verdict, missing arguments, and a verdict before any request", () => {
    ok(["create", "billing", "--manager", "boss"]);
    ok(["link", "billing", TASK]);
    const early = epic(["review-verdict", "--task", TASK, "on-track"]);
    expect(early.code).toBe(1);
    expect(early.stderr).toContain("no manager review request");
    ok(["review-request", "--task", TASK, "--file", review(TASK, 1)]);
    const bad = epic(["review-verdict", "--task", TASK, "approve"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('"approve" is not a verdict');
    expect(epic(["review-verdict", "--task", TASK]).code).toBe(1);
    expect(epic(["review-request", "--task", TASK]).code).toBe(1);
    // None of the refusals recorded a verdict: the request is still open.
    expect(ok(["reports", "billing"])).toContain("m001");
  });

  it("the second caller gets the recorded verdict back, whatever it passes", () => {
    ok(["create", "billing", "--manager", "boss"]);
    ok(["link", "billing", TASK]);
    ok(["review-request", "--task", TASK, "--file", review(TASK, 1)]);
    expect(ok(["review-verdict", "--task", TASK, "redirect", "--by", "boss"])).toContain(": redirect");
    const worker = ok(["review-verdict", "--task", TASK, "on-track"]);
    expect(worker).toContain("was already recorded: redirect. Act on the recorded verdict.");
    expect(worker).toContain("Manager redirects on this ticket: 1 of 2.");
  });

  it("the cap is announced on the capped round's request, and only a redirect is turned into an escalation", () => {
    ok(["create", "billing", "--manager", "boss"]);
    ok(["link", "billing", TASK]);
    for (let round = 1; round <= 2; round += 1) {
      const req = ok(["review-request", "--task", TASK, "--file", review(TASK, round)]);
      expect(req).toContain(`Manager redirects on this ticket so far: ${round - 1} of 2.`);
      ok(["review-verdict", "--task", TASK, "redirect"]);
    }
    const third = ok(["review-request", "--task", TASK, "--file", review(TASK, 3)]);
    expect(third).toContain("The cap is reached (2 redirects of 2)");
    expect(ok(["show", "billing"])).toContain("redirects 2/2, a redirect now escalates to human review");
    // On-track at the cap is still on-track: the cap only rewrites a redirect.
    const onTrack = ok(["review-verdict", "--task", TASK, "on-track"]);
    expect(onTrack).toContain(": on-track");
    expect(onTrack).not.toContain("escalate");
    // A fourth round (another manager review stop later) that redirects escalates, as capped.
    ok(["review-request", "--task", TASK, "--file", review(TASK, 4)]);
    expect(ok(["review-verdict", "--task", TASK, "redirect"])).toContain(
      ": escalate (asked: redirect; 2 redirects were already recorded on this ticket"
    );
    // An escalation asked for directly is not reported as capped.
    ok(["review-request", "--task", TASK, "--file", review(TASK, 5)]);
    const esc = ok(["review-verdict", "--task", TASK, "escalate"]);
    expect(esc).toContain(": escalate");
    expect(esc).not.toContain("asked: redirect");
    const state = readEpicState(root, "billing")!;
    expect(reviewHistory(state, TASK).verdicts.map((v) => [v.verdict, v.effective, v.capped === true])).toEqual([
      ["redirect", "redirect", false],
      ["redirect", "redirect", false],
      ["on-track", "on-track", false],
      ["redirect", "escalate", true],
      ["escalate", "escalate", false],
    ]);
  });

  it("counts redirects per ticket: a sibling's redirects never use up this ticket's cap", () => {
    ok(["create", "billing", "--manager", "boss"]);
    ok(["link", "billing", TASK, "201-sibling.md"]);
    for (let round = 1; round <= 2; round += 1) {
      ok(["review-request", "--task", "201-sibling.md", "--file", review("201-sibling.md", round)]);
      ok(["review-verdict", "--task", "201-sibling.md", "redirect"]);
    }
    const req = ok(["review-request", "--task", TASK, "--file", review(TASK, 1)]);
    expect(req).toContain("manager review m003 (round 1)");
    expect(req).toContain("so far: 0 of 2");
    expect(ok(["review-verdict", "--task", TASK, "redirect"])).toContain(": redirect\n");
  });
});

describe.each(["installed", "plugin"] as const)(
  "review gate at a manager review stop, end to end (%s copy)",
  (mode) => {
    let root: string;
    let scripts: string;

    beforeEach(async () => {
      root = fs.realpathSync(bareProject());
      if (mode === "installed") {
        writeConfig(root, defaultish);
        await appInstall(root);
        scripts = path.join(root, ".claude", "scripts");
      } else {
        scripts = path.join(PLUGIN_ROOT, "scripts");
      }
      const sess = sessionPathsFor(path.join(root, ".claude"), SID)!;
      fs.mkdirSync(sess.dir, { recursive: true });
      fs.writeFileSync(sess.state, JSON.stringify({ active_task: TASK }));
    });

    const ext = () => (mode === "installed" ? ".cjs" : ".js");
    const epic = (...args: string[]) => {
      const r = run(path.join(scripts, "maestro-epic.cjs"), root, args);
      expect(r.code, r.stderr).toBe(0);
      return r.stdout;
    };
    const status = (...args: string[]) => {
      const r = run(path.join(scripts, "maestro-task-status.cjs"), root, args);
      expect(r.code, r.stderr).toBe(0);
    };
    const gate = (tool: string, toolInput: object = {}) => {
      const r = spawnSync("node", [path.join(scripts, `maestro-human-review-gate${ext()}`)], {
        input: JSON.stringify({
          cwd: root,
          session_id: SID,
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: toolInput,
        }),
        encoding: "utf8",
        env: pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SID }),
      });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
    };
    const send = (to: string) => gate("SendMessage", { to, message: "manager review m001" });
    const review = (n: number) =>
      path.join(tasksDir(root), n === 1 ? "200-direction.review.md" : `200-direction.review-${n}.md`);

    it("holds the request to the manager and the question until the brief exists, then lets both through", () => {
      epic("create", "billing", "--manager", "boss");
      epic("link", "billing", TASK);
      status("plan", "@backend", "manager review", "@reviewer");
      expect(send("boss")).toBeNull(); // @backend is the current step
      status("plan-step", "@backend", "done");

      const denied = send("boss");
      expect(denied?.permissionDecision).toBe("deny");
      expect(denied?.permissionDecisionReason).toContain("Manager review round 1");
      expect(denied?.permissionDecisionReason).toContain(review(1));
      expect(denied?.permissionDecisionReason).toContain("review-request");
      expect(send("boss [3fa9c1]")?.permissionDecision).toBe("deny");
      expect(gate("AskUserQuestion")?.permissionDecision).toBe("deny");
      // Another recipient (a sibling worker, the user's own session) is never held.
      expect(send("maestro-worker-2")).toBeNull();
      expect(gate("Bash", { command: "ls" })).toBeNull();

      fs.writeFileSync(review(1), "## Goal\n");
      expect(send("boss")).toBeNull();
      expect(gate("AskUserQuestion")).toBeNull();
    });

    it("a redirect loop-back needs round 2's brief; a human review after the manager review numbers on from it", () => {
      epic("create", "billing", "--manager", "boss");
      epic("link", "billing", TASK);
      status("plan", "@backend", "manager review", "human review");
      status("plan-step", "@backend", "done");
      fs.writeFileSync(review(1), "## Goal\n");
      expect(send("boss")).toBeNull();

      // Redirect: back to the producing agent, then manager review again.
      status("plan-step", "@backend", "pending");
      status("plan-step", "@backend", "done");
      expect(send("boss")?.permissionDecisionReason).toContain(review(2));
      fs.writeFileSync(review(2), "## Goal\n");
      expect(send("boss")).toBeNull();

      // On-track: manager review done; the human review after it is 1 + 1 loop-back + 1 passed stop.
      status("plan-step", "manager review", "done");
      const human = gate("AskUserQuestion");
      expect(human?.permissionDecisionReason).toContain("Human review round 3");
      expect(human?.permissionDecisionReason).toContain(review(3));
      // At a human review, SendMessage to the manager is not the review gate's business.
      expect(send("boss")).toBeNull();
    });

    it("fallback: with no manager recorded, or no epic, SendMessage is ungated but the question still is", () => {
      epic("create", "billing");
      epic("link", "billing", TASK);
      status("plan", "manager review");
      expect(send("boss")).toBeNull();
      expect(gate("AskUserQuestion")?.permissionDecision).toBe("deny");

      epic("unlink", TASK);
      epic("set-manager", "billing", "boss");
      expect(send("boss")).toBeNull(); // the task is in no epic now
      expect(gate("AskUserQuestion")?.permissionDecision).toBe("deny");
      fs.writeFileSync(review(1), "## Goal\n");
      expect(gate("AskUserQuestion")).toBeNull();
    });

    it("fails open on a corrupt epic state: SendMessage is allowed, the question is still gated", () => {
      epic("create", "billing", "--manager", "boss");
      epic("link", "billing", TASK);
      status("plan", "manager review");
      expect(send("boss")?.permissionDecision).toBe("deny");
      fs.writeFileSync(path.join(root, ".claude", "epics", "billing", "state.json"), "{nope");
      expect(send("boss")).toBeNull();
      expect(gate("AskUserQuestion")?.permissionDecision).toBe("deny");
    });
  }
);

describe("the review gate's matcher migration (AskUserQuestion -> AskUserQuestion|SendMessage)", () => {
  const INSTALLER = path.join(PLUGIN_ROOT, "scripts", "maestro-install.js");
  const pluginInstall = (root: string) =>
    execFileSync("node", [INSTALLER, root], { encoding: "utf8", env: pinnedEnv(tmp) });
  const settingsPath = (root: string) => path.join(root, ".claude", "settings.json");
  const readSettings = (root: string) => JSON.parse(fs.readFileSync(settingsPath(root), "utf8"));
  const USER_HOOK = { type: "command", command: "echo user-owned" };

  /** [matcher, command] for every PreToolUse hook that runs the gate or the user's own hook. */
  function gateEntries(root: string): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const entry of readSettings(root).hooks?.PreToolUse ?? [])
      for (const h of entry.hooks ?? [])
        if (String(h.command).includes("maestro-human-review-gate") || h.command === USER_HOOK.command)
          out.push([entry.matcher ?? "", h.command]);
    return out.sort();
  }

  function legacy(entries: object[]): string {
    const root = bareProject();
    writeConfig(root, defaultish);
    fs.writeFileSync(settingsPath(root), JSON.stringify({ hooks: { PreToolUse: entries } }, null, 2));
    return root;
  }

  describe.each([
    ["installRuntime (app)", appInstall],
    ["maestro-install.js (plugin)", pluginInstall],
  ] as const)("%s", (_name, install) => {
    it("rewrites a sole-hook legacy entry's matcher in place", async () => {
      const root = legacy([{ matcher: "AskUserQuestion", hooks: [{ type: "command", command: GATE_CMD }] }]);
      await install(root);
      expect(gateEntries(root)).toEqual([[NEW_MATCHER, GATE_CMD]]);
    });

    it("moves ours out of a shared legacy entry and leaves the user's hook on its matcher", async () => {
      const root = legacy([{ matcher: "AskUserQuestion", hooks: [USER_HOOK, { type: "command", command: GATE_CMD }] }]);
      await install(root);
      expect(gateEntries(root)).toEqual([
        ["AskUserQuestion", USER_HOOK.command],
        [NEW_MATCHER, GATE_CMD],
      ]);
    });

    it("is idempotent: a second install leaves settings.json byte-identical", async () => {
      const root = legacy([{ matcher: "AskUserQuestion", hooks: [{ type: "command", command: GATE_CMD }] }]);
      await install(root);
      const first = fs.readFileSync(settingsPath(root), "utf8");
      await install(root);
      expect(fs.readFileSync(settingsPath(root), "utf8")).toBe(first);
    });

    it("never moves a user's own AskUserQuestion hook", async () => {
      const root = legacy([{ matcher: "AskUserQuestion", hooks: [USER_HOOK] }]);
      await install(root);
      expect(gateEntries(root)).toEqual([
        ["AskUserQuestion", USER_HOOK.command],
        [NEW_MATCHER, GATE_CMD],
      ]);
    });
  });

  it("the plugin's hooks.json registers the gate on the new matcher only", () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")).hooks;
    const matchers = (
      hooks.PreToolUse as Array<{ matcher: string; hooks: Array<{ command: string; args?: string[] }> }>
    )
      .filter((e) =>
        e.hooks.some((h) => [h.command, ...(h.args ?? [])].join(" ").includes("maestro-human-review-gate"))
      )
      .map((e) => e.matcher);
    expect(matchers).toEqual([NEW_MATCHER]);
  });
});
