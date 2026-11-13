// Manager approval (`177`): with the opt-in `manager_approval` setting on, an epic's manager is the
// approving authority for a CONTAINERIZED worker's human-review, commit and merge stops, and only a
// fixed list of situations escalates to the user.
//
// An approval is a record file in a directory OUTSIDE the repository (default
// `~/.config/maestro/approvals/`), keyed by project, epic, task and stop. The worker launcher mounts
// that directory read-only into every worker container, so a worker reads approvals and never
// writes one. The worker's gate accepts a stop only when a record matches its exact task, stop and
// commit; pane text and messages (task 176's `[manager message]`) never count.
//
// Two writers, and only two: the epic CLI (`maestro-epic.cjs approve`, the manager's own judgment,
// `source: "manager"`, refused for anything on the escalation list) and the manager session's
// AskUserQuestion hook (the user's answer to an escalation, `source: "user"`). The CLI has no way to
// write a `user` record.
//
// `fs`/`path`/`crypto` only, so the bundle runs under bare node and carries no `node:sqlite`.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MaestroConfigV3 } from "./types.js";
import { mainCheckoutRoot } from "./worktree.js";

export const APPROVAL_STOPS = ["human review", "commit", "merge"] as const;
export type ApprovalStop = (typeof APPROVAL_STOPS)[number];

/** Overrides the approvals directory (tests, and the container, where the host path is mounted elsewhere). */
export const APPROVALS_DIR_ENV = "MAESTRO_APPROVALS_DIR";
/** Relative to the host user's home. */
export const APPROVALS_REL = path.join(".config", "maestro", "approvals");

/**
 * The one reader of `manager_approval`: true only for the boolean `true`. Absent, `false` or any
 * other value (including the string "true") is off, so nothing changes by default.
 */
export function resolveManagerApproval(cfg: MaestroConfigV3 | null | undefined): boolean {
  if (!cfg || cfg.version !== 3) return false;
  const v: unknown = cfg.manager_approval;
  return v === true;
}

/** Manager approval applies to a containerized worker only: a host worker can forge a record. */
export function managerApprovalApplies(cfg: MaestroConfigV3 | null | undefined, containerWorker: boolean): boolean {
  return containerWorker && resolveManagerApproval(cfg);
}

/** Where approvals live: the env override, else `<home>/.config/maestro/approvals`. */
export function approvalsDir(home: string, env: Record<string, string | undefined> = process.env): string {
  const override = env[APPROVALS_DIR_ENV]?.trim();
  return override ? override : path.join(home, APPROVALS_REL);
}

/** `Human Review`, `human-review` and `human_review` all name the stop `human review`. */
export function normalizeStop(stop: unknown): ApprovalStop | null {
  if (typeof stop !== "string") return null;
  const s = stop
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, " ");
  return (APPROVAL_STOPS as readonly string[]).includes(s) ? (s as ApprovalStop) : null;
}

function stopSlug(stop: ApprovalStop): string {
  return stop.replace(/ /g, "-");
}

function taskStem(task: string): string {
  return path.basename(task).replace(/\.md$/, "");
}

/** A path-safe key for a project: its slug plus a short hash of the main checkout's real path. */
export function projectKeyFor(projectRoot: string): string {
  const root = path.resolve(mainCheckoutRoot(path.resolve(projectRoot)));
  const slug =
    path
      .basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "-")
      .replace(/^[-.]+/, "") || "project";
  return `${slug}-${crypto.createHash("sha256").update(root).digest("hex").slice(0, 10)}`;
}

export interface ApprovalKey {
  project: string;
  epic: string;
  task: string;
  stop: ApprovalStop;
}

function keyDir(root: string, key: ApprovalKey): string {
  return path.join(root, key.project, key.epic, taskStem(key.task));
}

export function approvalFile(root: string, key: ApprovalKey): string {
  return path.join(keyDir(root, key), `${stopSlug(key.stop)}.json`);
}

function escalationFile(root: string, key: ApprovalKey): string {
  return path.join(keyDir(root, key), `${stopSlug(key.stop)}.escalation.json`);
}

// ------------------------------------------------------------------------------------ records

export type ApprovalDecision = "approved" | "rejected";
export type ApprovalSource = "manager" | "user";

export interface ApprovalRecord {
  version: 1;
  project: string;
  epic: string;
  task: string;
  stop: ApprovalStop;
  commit: string;
  decision: ApprovalDecision;
  note?: string;
  /** `manager`: the manager's own judgment. `user`: the user's answer in the manager session. */
  source: ApprovalSource;
  /** Set on a `user` record: the escalation reason it answers. */
  escalation?: EscalationReason;
  /** Set on a `user` record: the answer text as the hook saw it. */
  answer?: string;
  ts: string;
}

export interface PendingEscalation {
  version: 1;
  project: string;
  epic: string;
  task: string;
  stop: ApprovalStop;
  commit: string;
  reason: EscalationReason;
  ts: string;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export interface RecordInput extends ApprovalKey {
  commit: string;
  decision: ApprovalDecision;
  note?: string;
  source: ApprovalSource;
  escalation?: EscalationReason;
  answer?: string;
}

/** Write a record (replacing the stop's previous one) and clear any pending escalation it answers. */
export function writeApproval(root: string, input: RecordInput): { file: string; record: ApprovalRecord } {
  const record: ApprovalRecord = {
    version: 1,
    project: input.project,
    epic: input.epic,
    task: path.basename(input.task),
    stop: input.stop,
    commit: input.commit.trim(),
    decision: input.decision,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    source: input.source,
    ...(input.escalation ? { escalation: input.escalation } : {}),
    ...(input.answer ? { answer: input.answer } : {}),
    ts: new Date().toISOString(),
  };
  const file = approvalFile(root, input);
  writeJson(file, record);
  if (input.source === "user") fs.rmSync(escalationFile(root, input), { force: true });
  return { file, record };
}

export function readApproval(root: string, key: ApprovalKey): ApprovalRecord | null {
  const raw = readJson(approvalFile(root, key));
  return raw && typeof raw === "object" ? (raw as ApprovalRecord) : null;
}

export function writePendingEscalation(
  root: string,
  key: ApprovalKey,
  commit: string,
  reason: EscalationReason
): { file: string } {
  const pending: PendingEscalation = {
    version: 1,
    project: key.project,
    epic: key.epic,
    task: path.basename(key.task),
    stop: key.stop,
    commit: commit.trim(),
    reason,
    ts: new Date().toISOString(),
  };
  const file = escalationFile(root, key);
  writeJson(file, pending);
  return { file };
}

export function readPendingEscalation(root: string, key: ApprovalKey): PendingEscalation | null {
  const raw = readJson(escalationFile(root, key));
  return raw && typeof raw === "object" ? (raw as PendingEscalation) : null;
}

// ------------------------------------------------------------------------------------ matching

export type ApprovalCheck =
  | { ok: true; record: ApprovalRecord }
  | {
      ok: false;
      code: "missing" | "wrong-task" | "wrong-stop" | "wrong-commit" | "rejected" | "malformed";
      reason: string;
    };

/** Two commits match when both are at least 7 hex characters and one is a prefix of the other. */
export function sameCommit(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length < 7 || y.length < 7 || !/^[0-9a-f]+$/.test(x) || !/^[0-9a-f]+$/.test(y)) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * The gate's decision: does `record` approve THIS task, stop and commit? A record for another task,
 * stop or commit is refused with the reason named; so is a rejection and a record with no commit.
 */
export function checkApproval(
  record: ApprovalRecord | null | undefined,
  want: { task: string; stop: ApprovalStop; commit: string | null | undefined }
): ApprovalCheck {
  if (!record) return { ok: false, code: "missing", reason: "no approval record exists for this stop yet" };
  if (record.version !== 1 || typeof record.task !== "string" || typeof record.commit !== "string")
    return { ok: false, code: "malformed", reason: "the approval record is malformed" };
  if (path.basename(record.task) !== path.basename(want.task))
    return {
      ok: false,
      code: "wrong-task",
      reason: `the record is for task ${record.task}, not ${path.basename(want.task)}`,
    };
  if (record.stop !== want.stop)
    return { ok: false, code: "wrong-stop", reason: `the record is for the "${record.stop}" stop, not "${want.stop}"` };
  if (!sameCommit(record.commit, want.commit))
    return {
      ok: false,
      code: "wrong-commit",
      reason: `the record approves commit ${record.commit}, not ${want.commit || "(no commit given)"}`,
    };
  if (record.decision !== "approved")
    return {
      ok: false,
      code: "rejected",
      reason: `the manager rejected this stop${record.note ? `: ${record.note}` : ""}`,
    };
  return { ok: true, record };
}

/** Read the record at the key's path and judge it for `want.commit`. */
export function findApproval(root: string, key: ApprovalKey, commit: string | null | undefined): ApprovalCheck {
  return checkApproval(readApproval(root, key), { task: key.task, stop: key.stop, commit });
}

// ------------------------------------------------------------------------------- escalation

export const ESCALATION_REASONS = [
  "suite-not-green",
  "scope-change",
  "decision-conflict",
  "outward-git",
  "config-change",
  "security-finding",
  "second-redirect",
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export function isEscalationReason(v: unknown): v is EscalationReason {
  return typeof v === "string" && (ESCALATION_REASONS as readonly string[]).includes(v);
}

/** What each reason asks the user, in the manager's words. */
export const ESCALATION_TEXT: Record<EscalationReason, string> = {
  "suite-not-green": "the full suite is red or only partly run",
  "scope-change": "the work changes the ticket's scope",
  "decision-conflict": "the work conflicts with an epic decision",
  "outward-git": "a push, or another outward-facing or destructive git operation",
  "config-change": "a change to agents, skills, workflows, rules or settings",
  "security-finding": "a security finding",
  "second-redirect": "a second redirect on the same ticket",
};

/**
 * Git and hosting commands that leave the machine or destroy history: push (any form), force
 * flags, branch deletion, history rewrites, and the `gh`/`glab` clients.
 */
export type GitOperationKind = "push" | "force-push" | "branch-delete" | "history-rewrite" | "hosting";

export function classifyGitOperation(text: string): GitOperationKind | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (/\bgit\b[^;&|]*\bpush\b/.test(t)) {
    return /(\s--force(-with-lease)?\b|\s-f\b|\s\+[\w/.-]+)/.test(t) ? "force-push" : "push";
  }
  if (/\bgit\b[^;&|]*\bbranch\b[^;&|]*(\s-d\b|\s-D\b|\s--delete\b)/.test(t)) return "branch-delete";
  if (/\bgit\b[^;&|]*\b(rebase|filter-branch|filter-repo|replace)\b/.test(t)) return "history-rewrite";
  if (/\bgit\b[^;&|]*\bcommit\b[^;&|]*--amend\b/.test(t)) return "history-rewrite";
  if (/\bgit\b[^;&|]*\breset\b[^;&|]*--hard\b/.test(t)) return "history-rewrite";
  if (/(^|[;&| ])(gh|glab)\s/.test(t)) return "hosting";
  return null;
}

const CONFIG_SURFACES = [
  /(^|\/)\.claude\/(agents|skills|rules|workflows|handoffs|reports)\//,
  /(^|\/)\.claude\/maestro\.json$/,
  /(^|\/)\.claude\/settings(\.local)?\.json$/,
  /(^|\/)plugins\/[^/]+\/(agents|skills|hooks|templates)\//,
  /(^|\/)(CLAUDE|AGENTS)\.md$/,
];

/** Does a changed path (repo-relative or absolute) belong to agents, skills, workflows, rules or settings? */
export function isConfigSurface(file: string): boolean {
  const p = file.replace(/\\/g, "/");
  return CONFIG_SURFACES.some((re) => re.test(p));
}

export interface EscalationFacts {
  /** The full suite on the commit (for a merge, on the merged result). Anything but `green` escalates. */
  suite?: string | null;
  scopeChange?: boolean;
  decisionConflict?: boolean;
  /** Git/hosting commands the stop would run, as text. */
  operations?: string[];
  /** Files the work changed. */
  changedPaths?: string[];
  securityFinding?: boolean;
  /** Redirects the manager has issued on the ticket, counting the one it is deciding now. */
  redirects?: number;
}

/** The escalation reasons that apply, in list order; empty means the manager may decide alone. */
export function classifyEscalation(facts: EscalationFacts): EscalationReason[] {
  const out: EscalationReason[] = [];
  if ((facts.suite ?? "").trim().toLowerCase() !== "green") out.push("suite-not-green");
  if (facts.scopeChange) out.push("scope-change");
  if (facts.decisionConflict) out.push("decision-conflict");
  if ((facts.operations ?? []).some((op) => classifyGitOperation(op) !== null)) out.push("outward-git");
  if ((facts.changedPaths ?? []).some(isConfigSurface)) out.push("config-change");
  if (facts.securityFinding) out.push("security-finding");
  if ((facts.redirects ?? 0) >= 2) out.push("second-redirect");
  return out;
}

// ------------------------------------------------------------------ the user's answer (hook)

/** Marks the question the manager asks the user for an escalated stop. */
export function escalationMarker(task: string, stop: ApprovalStop): string {
  return `approval-escalation:${path.basename(task)}:${stopSlug(stop)}`;
}

const MARKER_RE = /approval-escalation:([^\s:]+\.md):(human-review|commit|merge)/;

export interface EscalationAnswer {
  task: string;
  stop: ApprovalStop;
  decision: ApprovalDecision | null;
  answer: string;
}

function answerTexts(toolResponse: unknown, question: string): string[] {
  if (typeof toolResponse === "string") return [toolResponse];
  if (!toolResponse || typeof toolResponse !== "object") return [];
  const answers = (toolResponse as { answers?: unknown }).answers;
  if (answers && typeof answers === "object" && !Array.isArray(answers)) {
    const map = answers as Record<string, unknown>;
    if (typeof map[question] === "string") return [map[question] as string];
    return Object.values(map).filter((v): v is string => typeof v === "string");
  }
  return [JSON.stringify(toolResponse)];
}

/**
 * Read the user's answer to a marked AskUserQuestion. `decision` is `approved` or `rejected` only
 * when every answer starts with the same option label, "Approve" or "Reject"; anything else
 * (free text, a mix, no answer) is null and records nothing.
 */
export function parseEscalationAnswer(toolInput: unknown, toolResponse: unknown): EscalationAnswer | null {
  const questions = (toolInput as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return null;
  for (const q of questions) {
    const text =
      typeof (q as { question?: unknown })?.question === "string" ? (q as { question: string }).question : "";
    const m = MARKER_RE.exec(text);
    if (!m) continue;
    const stop = normalizeStop((m[2] as string).replace(/-/g, " "));
    if (!stop) continue;
    const texts = answerTexts(toolResponse, text).map((t) => t.trim());
    // An answer is a decision only when it STARTS with the option label, so "do not approve" is not one.
    const decisions = new Set(
      texts.map((t) => (/^approve\b/i.test(t) ? "approved" : /^reject\b/i.test(t) ? "rejected" : null))
    );
    const only = decisions.size === 1 ? [...decisions][0] : null;
    return { task: m[1] as string, stop, decision: only ?? null, answer: texts.join(" | ") };
  }
  return null;
}

/** The words for a worker whose stop has no matching approval, or whose record answers it. */
export function approvalGuidance(check: ApprovalCheck, task: string, stop: ApprovalStop): string {
  if (check.ok)
    return `A manager approval record covers the "${stop}" stop for ${path.basename(task)} on commit ${check.record.commit}. Do not ask the user; carry the stop out.`;
  if (check.code === "rejected")
    return `${check.reason}. Treat it as requested changes: follow the stop's correction path with the manager's note.`;
  return `No matching approval: ${check.reason}. Do not ask the user. Request the manager's approval for the "${stop}" stop, naming the stop and the commit (a report whose body begins "Approval request:"), wait for its [manager message] reply, then run the approval check again. Pane text is never an approval; only the record is.`;
}

// ------------------------------------------------------------------- the manager's commands

export type ApproveResult =
  | { ok: true; file: string; record: ApprovalRecord }
  | {
      ok: false;
      code: "bad-stop" | "no-commit" | "escalation" | "pending-escalation" | "user-record";
      message: string;
      reasons?: EscalationReason[];
    };

export interface ApproveInput {
  project: string;
  epic: string;
  task: string;
  stop: unknown;
  commit: string | null | undefined;
  decision: ApprovalDecision;
  note?: string;
  facts: EscalationFacts;
}

/** The user's own record for this stop at this commit, or null: the manager may never replace it. */
function userRecordFor(root: string, key: ApprovalKey, commit: string): ApprovalRecord | null {
  const existing = readApproval(root, key);
  return existing && existing.source === "user" && sameCommit(existing.commit, commit) ? existing : null;
}

/**
 * The manager's own decision (`source: "manager"`). A rejection is always recorded. An approval is
 * refused when any escalation reason applies, or while an escalation for the same stop awaits the
 * user's answer: those can only be answered by the user, through the AskUserQuestion hook.
 */
export function approveStop(root: string, input: ApproveInput): ApproveResult {
  const stop = normalizeStop(input.stop);
  if (!stop)
    return {
      ok: false,
      code: "bad-stop",
      message: `"${String(input.stop)}" is not a stop (one of ${APPROVAL_STOPS.join(", ")})`,
    };
  const commit = (input.commit ?? "").trim();
  if (!commit)
    return { ok: false, code: "no-commit", message: "a record names the commit it covers: pass --commit <sha>" };
  const key: ApprovalKey = { project: input.project, epic: input.epic, task: input.task, stop };
  const settled = userRecordFor(root, key, commit);
  if (settled)
    return {
      ok: false,
      code: "user-record",
      message: `not recorded: the user already answered this stop at this commit (${settled.decision}). Only a new commit reopens it.`,
    };
  if (input.decision === "approved") {
    const reasons = classifyEscalation(input.facts);
    if (reasons.length)
      return {
        ok: false,
        code: "escalation",
        reasons,
        message:
          `not approved: ${reasons.map((r) => ESCALATION_TEXT[r]).join("; ")}. This needs the user, not you. ` +
          `Run approval-escalate --task ${path.basename(input.task)} --stop "${stop}" --commit ${commit} --reason ${reasons[0]}, ask the user the question it prints, and the hook records their answer.`,
      };
    const pending = readPendingEscalation(root, key);
    if (pending)
      return {
        ok: false,
        code: "pending-escalation",
        message: `not approved: an escalation (${pending.reason}) for this stop awaits the user's answer. Only that answer can approve it.`,
      };
  }
  const { file, record } = writeApproval(root, {
    ...key,
    commit,
    decision: input.decision,
    note: input.note,
    source: "manager",
  });
  return { ok: true, file, record };
}

/** Record that the stop needs the user, and build the question the manager must ask (marker included). */
export function escalateStop(
  root: string,
  input: {
    project: string;
    epic: string;
    task: string;
    stop: unknown;
    commit: string | null | undefined;
    reason: unknown;
  }
): { ok: true; file: string; question: string } | { ok: false; message: string } {
  const stop = normalizeStop(input.stop);
  if (!stop)
    return { ok: false, message: `"${String(input.stop)}" is not a stop (one of ${APPROVAL_STOPS.join(", ")})` };
  if (!isEscalationReason(input.reason))
    return {
      ok: false,
      message: `"${String(input.reason)}" is not an escalation reason (one of ${ESCALATION_REASONS.join(", ")})`,
    };
  const commit = (input.commit ?? "").trim();
  if (!commit) return { ok: false, message: "pass --commit <sha>" };
  const key: ApprovalKey = { project: input.project, epic: input.epic, task: input.task, stop };
  if (userRecordFor(root, key, commit))
    return { ok: false, message: "the user already answered this stop at this commit; only a new commit reopens it" };
  // The user's answer is the only thing that settles it: drop a stale record from an earlier round.
  fs.rmSync(approvalFile(root, key), { force: true });
  const { file } = writePendingEscalation(root, key, commit, input.reason);
  const question =
    `[${escalationMarker(input.task, stop)}] Approve the "${stop}" stop of ${path.basename(input.task)} at commit ${commit}? ` +
    `It needs you because ${ESCALATION_TEXT[input.reason]}.`;
  return { ok: true, file, question };
}

/**
 * The AskUserQuestion hook's write: turn the user's answer to a marked question into a `user`
 * record. Needs a pending escalation for that task and stop; with none, or an answer that is not a
 * clear Approve / Reject, nothing is written.
 */
export function recordUserAnswer(
  root: string,
  input: { project: string; epic: string; answer: EscalationAnswer }
): { ok: true; file: string } | { ok: false; message: string } {
  const { answer } = input;
  if (!answer.decision) return { ok: false, message: "the answer is not a clear Approve or Reject" };
  const key: ApprovalKey = { project: input.project, epic: input.epic, task: answer.task, stop: answer.stop };
  const pending = readPendingEscalation(root, key);
  if (!pending) return { ok: false, message: "no escalation is pending for this stop" };
  const { file } = writeApproval(root, {
    ...key,
    commit: pending.commit,
    decision: answer.decision,
    note: answer.decision === "rejected" ? answer.answer : undefined,
    source: "user",
    escalation: pending.reason,
    answer: answer.answer,
  });
  return { ok: true, file };
}
