// `177`: manager approval for containerized workers. The pure module: the gate's record matching,
// the escalation classification, the user's-answer parser, and the manager / user write flows
// against a temp approvals root (no home directory is touched).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  APPROVAL_STOPS,
  approvalFile,
  approveStop,
  approvalGuidance,
  checkApproval,
  classifyEscalation,
  classifyGitOperation,
  escalateStop,
  escalationMarker,
  findApproval,
  isConfigSurface,
  managerApprovalApplies,
  normalizeStop,
  parseEscalationAnswer,
  readPendingEscalation,
  recordUserAnswer,
  resolveManagerApproval,
  sameCommit,
  type ApprovalRecord,
} from "../../src/core/manager-approval.js";
import { blankConfig } from "../../src/core/config.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const TASK = "177-the-epic-manager-approves.md";
const COMMIT = "abcdef1234567890";
const KEY = { project: "proj-0123456789", epic: "containerized-workers", task: TASK };
const CLEAN = { suite: "green" };

function record(over: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    version: 1,
    project: KEY.project,
    epic: KEY.epic,
    task: TASK,
    stop: "commit",
    commit: COMMIT,
    decision: "approved",
    source: "manager",
    ts: "2026-11-12T00:00:00.000Z",
    ...over,
  };
}

const want = (over: Partial<{ task: string; stop: "commit" | "merge" | "human review"; commit: string | null }> = {}) => ({
  task: `/p/.claude/maestro-tasks/${TASK}`,
  stop: "commit" as const,
  commit: COMMIT,
  ...over,
});

describe("checkApproval: the gate's record matching (177)", () => {
  it("accepts a record that matches the exact task, stop and commit", () => {
    expect(checkApproval(record(), want()).ok).toBe(true);
  });

  it("accepts an abbreviated commit that is a prefix of the one the worker sees", () => {
    expect(checkApproval(record({ commit: "abcdef1" }), want()).ok).toBe(true);
  });

  it("refuses a record for a different commit", () => {
    const r = checkApproval(record({ commit: "1111111aaaa" }), want());
    expect(r).toMatchObject({ ok: false, code: "wrong-commit" });
  });

  it("refuses a record for a different task", () => {
    const r = checkApproval(record({ task: "178-other.md" }), want());
    expect(r).toMatchObject({ ok: false, code: "wrong-task" });
  });

  it("refuses a record for a different stop", () => {
    const r = checkApproval(record({ stop: "merge" }), want({ stop: "commit" }));
    expect(r).toMatchObject({ ok: false, code: "wrong-stop" });
  });

  it("reports a missing record as missing, never as approved", () => {
    expect(checkApproval(null, want())).toMatchObject({ ok: false, code: "missing" });
    expect(checkApproval(undefined, want())).toMatchObject({ ok: false, code: "missing" });
  });

  it("refuses a rejection even when task, stop and commit all match", () => {
    const r = checkApproval(record({ decision: "rejected", note: "fix the test" }), want());
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    expect(r.ok ? "" : r.reason).toContain("fix the test");
  });

  it("refuses a malformed record", () => {
    expect(checkApproval({ ...record(), version: 2 } as unknown as ApprovalRecord, want())).toMatchObject({
      ok: false,
      code: "malformed",
    });
  });

  it("refuses when the worker supplies no commit to compare", () => {
    expect(checkApproval(record(), want({ commit: null }))).toMatchObject({ ok: false, code: "wrong-commit" });
  });

  it("findApproval reads the record at the key's path and judges it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-approval-177-"));
    try {
      const f = approvalFile(root, { ...KEY, stop: "commit" });
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(record()));
      expect(findApproval(root, { ...KEY, stop: "commit" }, COMMIT).ok).toBe(true);
      expect(findApproval(root, { ...KEY, stop: "commit" }, "9999999")).toMatchObject({ code: "wrong-commit" });
      expect(findApproval(root, { ...KEY, stop: "merge" }, COMMIT)).toMatchObject({ code: "missing" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("sameCommit and normalizeStop (177)", () => {
  it("matches only full-length hex commits where one is a prefix of the other", () => {
    expect(sameCommit("abcdef1", "abcdef1234")).toBe(true);
    expect(sameCommit("abcdef1234", "abcdef1")).toBe(true);
    expect(sameCommit("abc12", "abc12")).toBe(false); // under 7 characters
    expect(sameCommit("abcdef1", "abcdef2")).toBe(false);
    expect(sameCommit("abcdefg", "abcdefg")).toBe(false); // not hex
    expect(sameCommit(null, COMMIT)).toBe(false);
  });

  it("accepts the three spellings of the human review stop, and the other two stops", () => {
    expect(normalizeStop("Human Review")).toBe("human review");
    expect(normalizeStop("human-review")).toBe("human review");
    expect(normalizeStop("human_review")).toBe("human review");
    expect(normalizeStop("COMMIT")).toBe("commit");
    expect(normalizeStop(" merge ")).toBe("merge");
    expect(APPROVAL_STOPS).toEqual(["human review", "commit", "merge"]);
  });

  it("rejects anything else, including non-strings", () => {
    expect(normalizeStop("push")).toBeNull();
    expect(normalizeStop("")).toBeNull();
    expect(normalizeStop(5)).toBeNull();
  });
});

describe("off by default (177)", () => {
  it("a blank config and an unset setting are off", () => {
    expect(resolveManagerApproval(blankConfig())).toBe(false);
    expect(resolveManagerApproval(null)).toBe(false);
    expect(resolveManagerApproval(undefined)).toBe(false);
  });

  it("only the boolean true turns it on on a v3 config", () => {
    const on = (manager_approval: unknown, version: unknown = 3) =>
      resolveManagerApproval({ version, manager_approval } as unknown as MaestroConfigV3);
    expect(on(true)).toBe(true);
    expect(on(false)).toBe(false);
    expect(on("true")).toBe(false);
    expect(on(1)).toBe(false);
    expect(on(true, 2)).toBe(false);
  });

  it("applies to a containerized worker only: a host worker keeps asking the user", () => {
    const cfg = { version: 3, manager_approval: true } as unknown as MaestroConfigV3;
    expect(managerApprovalApplies(cfg, true)).toBe(true);
    expect(managerApprovalApplies(cfg, false)).toBe(false);
    expect(managerApprovalApplies(blankConfig(), true)).toBe(false);
  });
});

describe("classifyEscalation: the fixed list of situations that reach the user (177)", () => {
  it("a green suite with no other fact is decided by the manager alone", () => {
    expect(classifyEscalation({ suite: "green" })).toEqual([]);
  });

  it("a red, partial or missing suite escalates", () => {
    expect(classifyEscalation({ suite: "red" })).toEqual(["suite-not-green"]);
    expect(classifyEscalation({ suite: "partial" })).toEqual(["suite-not-green"]);
    expect(classifyEscalation({})).toEqual(["suite-not-green"]);
  });

  it("a scope change and a decision conflict each escalate", () => {
    expect(classifyEscalation({ ...CLEAN, scopeChange: true })).toEqual(["scope-change"]);
    expect(classifyEscalation({ ...CLEAN, decisionConflict: true })).toEqual(["decision-conflict"]);
  });

  it("a push or a destructive or hosting git operation escalates, a plain commit or merge does not", () => {
    expect(classifyEscalation({ ...CLEAN, operations: ["git push origin HEAD"] })).toEqual(["outward-git"]);
    expect(classifyEscalation({ ...CLEAN, operations: ["git commit -m 'x'", "git merge task-177"] })).toEqual([]);
  });

  it("a change to agents, skills, workflows, rules or settings escalates", () => {
    expect(classifyEscalation({ ...CLEAN, changedPaths: ["apps/maestro/src/core/x.ts"] })).toEqual([]);
    expect(classifyEscalation({ ...CLEAN, changedPaths: [".claude/maestro.json"] })).toEqual(["config-change"]);
  });

  it("a security finding escalates", () => {
    expect(classifyEscalation({ ...CLEAN, securityFinding: true })).toEqual(["security-finding"]);
  });

  it("a second redirect on the same ticket escalates, the first does not", () => {
    expect(classifyEscalation({ ...CLEAN, redirects: 1 })).toEqual([]);
    expect(classifyEscalation({ ...CLEAN, redirects: 2 })).toEqual(["second-redirect"]);
  });

  it("reports every reason that applies, in list order", () => {
    expect(
      classifyEscalation({
        suite: "red",
        scopeChange: true,
        operations: ["git push -f origin task-177"],
        redirects: 3,
      })
    ).toEqual(["suite-not-green", "scope-change", "outward-git", "second-redirect"]);
  });
});

describe("classifyGitOperation and isConfigSurface (177)", () => {
  it("classifies pushes, force pushes, branch deletion, history rewrites and hosting clients", () => {
    expect(classifyGitOperation("git push origin main")).toBe("push");
    expect(classifyGitOperation("git push --force-with-lease")).toBe("force-push");
    expect(classifyGitOperation("git push -f origin main")).toBe("force-push");
    expect(classifyGitOperation("git push origin +main")).toBe("force-push");
    expect(classifyGitOperation("git branch -D task-177")).toBe("branch-delete");
    expect(classifyGitOperation("git branch --delete task-177")).toBe("branch-delete");
    expect(classifyGitOperation("git rebase -i HEAD~3")).toBe("history-rewrite");
    expect(classifyGitOperation("git commit --amend -m x")).toBe("history-rewrite");
    expect(classifyGitOperation("git reset --hard HEAD~1")).toBe("history-rewrite");
    expect(classifyGitOperation("gh pr create --title x")).toBe("hosting");
  });

  it("leaves ordinary git work unclassified", () => {
    expect(classifyGitOperation("git status")).toBeNull();
    expect(classifyGitOperation("git commit -m 'feat: x'")).toBeNull();
    expect(classifyGitOperation("git merge task-177")).toBeNull();
    expect(classifyGitOperation("pnpm verify")).toBeNull();
  });

  it("flags agents, skills, rules, workflows, settings and the manager docs, relative or absolute", () => {
    for (const p of [
      ".claude/agents/backend.md",
      ".claude/skills/x/SKILL.md",
      ".claude/rules/guardrails.md",
      ".claude/workflows/x.json",
      ".claude/maestro.json",
      ".claude/settings.local.json",
      "plugins/maestro/skills/maestro-manager/SKILL.md",
      "plugins/maestro/hooks/hooks.json",
      "CLAUDE.md",
      "/home/u/gits/proj/AGENTS.md",
    ])
      expect(isConfigSurface(p), p).toBe(true);
  });

  it("does not flag task files, app source or plugin scripts", () => {
    for (const p of [
      ".claude/maestro-tasks/177-x.md",
      "apps/maestro/src/core/x.ts",
      "plugins/maestro/scripts/maestro-epic.cjs",
      "docs/rules.md",
    ])
      expect(isConfigSurface(p), p).toBe(false);
  });
});

describe("parseEscalationAnswer: only the user's answer to a marked question counts (177)", () => {
  const question = (stop = "commit") =>
    `[${escalationMarker(TASK, stop as "commit")}] Approve the "${stop}" stop of ${TASK} at commit ${COMMIT}?`;
  const input = (q: string) => ({ questions: [{ question: q, options: [] }] });

  it("builds the marker from the task file name and the stop slug", () => {
    expect(escalationMarker(`/p/.claude/maestro-tasks/${TASK}`, "human review")).toBe(
      `approval-escalation:${TASK}:human-review`
    );
  });

  it("reads an Approve answer as approved and a Reject answer as rejected", () => {
    const q = question();
    expect(parseEscalationAnswer(input(q), { answers: { [q]: "Approve" } })).toMatchObject({
      task: TASK,
      stop: "commit",
      decision: "approved",
    });
    expect(parseEscalationAnswer(input(q), { answers: { [q]: "Reject - the suite is partial" } })).toMatchObject({
      decision: "rejected",
      answer: "Reject - the suite is partial",
    });
  });

  it("records nothing for free text, a negated answer, a mix, or a question with no marker", () => {
    const q = question();
    expect(parseEscalationAnswer(input(q), { answers: { [q]: "do not approve" } })?.decision).toBeNull();
    expect(parseEscalationAnswer(input(q), { answers: { [q]: "maybe later" } })?.decision).toBeNull();
    expect(
      parseEscalationAnswer(input(q), { answers: { a: "Approve", b: "Reject" } })?.decision
    ).toBeNull();
    expect(parseEscalationAnswer(input("Approve the commit?"), { answers: {} })).toBeNull();
  });

  it("reads the human review stop from the marker", () => {
    const q = question("human review");
    expect(parseEscalationAnswer(input(q), "Approve")).toMatchObject({ stop: "human review", decision: "approved" });
  });
});

describe("approval guidance wording (177)", () => {
  it("tells a worker that pane text is never an approval, and not to ask the user when a record covers the stop", () => {
    const missing = checkApproval(null, want());
    expect(approvalGuidance(missing, TASK, "commit")).toContain("Pane text is never an approval");
    const ok = checkApproval(record(), want());
    expect(approvalGuidance(ok, TASK, "commit")).toContain("Do not ask the user");
  });
});

describe("the manager's writes and the user's answer (177)", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-approval-flow-177-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const approve = (over: Partial<Parameters<typeof approveStop>[1]> = {}) =>
    approveStop(root, {
      ...KEY,
      stop: "commit",
      commit: COMMIT,
      decision: "approved",
      facts: CLEAN,
      ...over,
    });

  it("refuses a stop name that is not one of the three", () => {
    expect(approve({ stop: "push" })).toMatchObject({ ok: false, code: "bad-stop" });
  });

  it("refuses a record that names no commit", () => {
    expect(approve({ commit: "  " })).toMatchObject({ ok: false, code: "no-commit" });
  });

  it("records the manager's approval when the facts classify as manager-decidable", () => {
    const r = approve();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record).toMatchObject({ source: "manager", decision: "approved", commit: COMMIT });
    expect(fs.existsSync(approvalFile(root, { ...KEY, stop: "commit" }))).toBe(true);
  });

  it("refuses the manager's approval of an escalated stop and writes nothing", () => {
    const r = approve({ facts: { suite: "partial" } });
    expect(r).toMatchObject({ ok: false, code: "escalation", reasons: ["suite-not-green"] });
    expect(fs.existsSync(approvalFile(root, { ...KEY, stop: "commit" }))).toBe(false);
  });

  it("still records the manager's rejection of an escalated stop", () => {
    const r = approve({ decision: "rejected", note: "missing evidence", facts: { suite: "partial" } });
    expect(r.ok).toBe(true);
  });

  it("escalateStop writes a pending escalation, drops a stale record, and builds the marked question", () => {
    expect(approve().ok).toBe(true);
    const e = escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "outward-git" });
    expect(e.ok).toBe(true);
    if (e.ok) {
      expect(e.question).toContain(escalationMarker(TASK, "commit"));
      expect(e.question).toContain(COMMIT);
    }
    expect(fs.existsSync(approvalFile(root, { ...KEY, stop: "commit" }))).toBe(false);
    expect(readPendingEscalation(root, { ...KEY, stop: "commit" })?.reason).toBe("outward-git");
  });

  it("escalateStop refuses an unknown reason", () => {
    expect(escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "because" })).toMatchObject({
      ok: false,
    });
  });

  it("while an escalation awaits the user, the manager cannot approve the stop", () => {
    escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "security-finding" });
    expect(approve()).toMatchObject({ ok: false, code: "pending-escalation" });
  });

  it("the user's Approve answer writes a user record for the pending commit and clears the escalation", () => {
    escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "security-finding" });
    const r = recordUserAnswer(root, {
      ...KEY,
      answer: { task: TASK, stop: "commit", decision: "approved", answer: "Approve" },
    });
    expect(r.ok).toBe(true);
    expect(readPendingEscalation(root, { ...KEY, stop: "commit" })).toBeNull();
    const rec = JSON.parse(fs.readFileSync(approvalFile(root, { ...KEY, stop: "commit" }), "utf8")) as ApprovalRecord;
    expect(rec).toMatchObject({ source: "user", decision: "approved", commit: COMMIT, escalation: "security-finding" });
    expect(findApproval(root, { ...KEY, stop: "commit" }, COMMIT).ok).toBe(true);
  });

  it("the user's answer is the only route to approving an escalated stop: a manager record alone never settles it", () => {
    escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "outward-git" });
    expect(findApproval(root, { ...KEY, stop: "commit" }, COMMIT).ok).toBe(false);
    expect(approve()).toMatchObject({ ok: false, code: "pending-escalation" });
  });

  it("the user's answer cannot be recorded without a pending escalation for that stop", () => {
    const r = recordUserAnswer(root, {
      ...KEY,
      answer: { task: TASK, stop: "commit", decision: "approved", answer: "Approve" },
    });
    expect(r).toMatchObject({ ok: false });
    expect(fs.existsSync(approvalFile(root, { ...KEY, stop: "commit" }))).toBe(false);
  });

  it("an answer that is not a clear Approve or Reject records nothing", () => {
    escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "outward-git" });
    const r = recordUserAnswer(root, {
      ...KEY,
      answer: { task: TASK, stop: "commit", decision: null, answer: "not sure" },
    });
    expect(r).toMatchObject({ ok: false });
    expect(readPendingEscalation(root, { ...KEY, stop: "commit" })).not.toBeNull();
  });

  it("a user's Reject is recorded with the answer as the note and blocks the worker", () => {
    escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "scope-change" });
    recordUserAnswer(root, {
      ...KEY,
      answer: { task: TASK, stop: "commit", decision: "rejected", answer: "Reject - cut the extra file" },
    });
    const check = findApproval(root, { ...KEY, stop: "commit" }, COMMIT);
    expect(check).toMatchObject({ ok: false, code: "rejected" });
  });

  // Defect probe (177): once the user has answered an escalated stop, the escalation is no longer
  // pending, so a manager call with clean facts writes a `manager` record over the user's record.
  // That lets the manager overturn a user's Reject, or re-label a user's Approve as its own
  // judgment. The acceptance criterion says a record for an escalated stop can only come from the
  // user's answer, so this must be refused.
  it("a manager approval cannot overwrite the user's Reject for the same stop and commit", () => {
    escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "scope-change" });
    recordUserAnswer(root, {
      ...KEY,
      answer: { task: TASK, stop: "commit", decision: "rejected", answer: "Reject - cut the extra file" },
    });
    const overwrite = approve({ facts: CLEAN });
    expect(overwrite.ok).toBe(false);
    expect(findApproval(root, { ...KEY, stop: "commit" }, COMMIT)).toMatchObject({ ok: false, code: "rejected" });
  });

  // `177` fix: approveStop and escalateStop refuse with code `user-record` (escalateStop: a message)
  // when the user's own record already covers the same commit. The user's record survives untouched.
  const userApprove = () => {
    escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "security-finding" });
    recordUserAnswer(root, {
      ...KEY,
      answer: { task: TASK, stop: "commit", decision: "approved", answer: "Approve" },
    });
  };
  const userFile = () => fs.readFileSync(approvalFile(root, { ...KEY, stop: "commit" }), "utf8");

  it("approveStop refuses the manager's Approve over the user's Approve for the same commit (code user-record)", () => {
    userApprove();
    const before = userFile();
    expect(approve({ facts: CLEAN })).toMatchObject({ ok: false, code: "user-record" });
    expect(userFile()).toBe(before);
  });

  it("approveStop refuses the manager's Reject over the user's Approve for the same commit (code user-record)", () => {
    userApprove();
    const before = userFile();
    expect(approve({ decision: "rejected", note: "changed my mind", facts: CLEAN })).toMatchObject({
      ok: false,
      code: "user-record",
    });
    expect(userFile()).toBe(before);
  });

  it("approveStop matches the user's record by an abbreviated commit that is a prefix of the same commit", () => {
    userApprove();
    expect(approve({ commit: COMMIT.slice(0, 7), facts: CLEAN })).toMatchObject({ ok: false, code: "user-record" });
  });

  it("escalateStop refuses to reopen the same commit once the user has answered it, and keeps the user's record", () => {
    userApprove();
    const before = userFile();
    const e = escalateStop(root, { ...KEY, stop: "commit", commit: COMMIT, reason: "outward-git" });
    expect(e).toMatchObject({ ok: false });
    if (!e.ok) expect(e.message).toContain("already answered");
    expect(userFile()).toBe(before);
    expect(readPendingEscalation(root, { ...KEY, stop: "commit" })).toBeNull();
  });

  it("a different commit reopens the stop: the manager may approve a new commit after the user answered the old one", () => {
    userApprove();
    const NEW = "9999999fedcba";
    const r = approve({ commit: NEW, facts: CLEAN });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record).toMatchObject({ source: "manager", decision: "approved", commit: NEW });
    expect(findApproval(root, { ...KEY, stop: "commit" }, NEW).ok).toBe(true);
  });

  it("a different commit reopens the stop: escalateStop on a new commit succeeds and clears the old user record", () => {
    userApprove();
    const NEW = "9999999fedcba";
    const e = escalateStop(root, { ...KEY, stop: "commit", commit: NEW, reason: "outward-git" });
    expect(e.ok).toBe(true);
    expect(readPendingEscalation(root, { ...KEY, stop: "commit" })).toMatchObject({ commit: NEW });
    expect(fs.existsSync(approvalFile(root, { ...KEY, stop: "commit" }))).toBe(false);
  });
});
