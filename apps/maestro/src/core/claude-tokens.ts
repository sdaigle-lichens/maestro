// The token contract between preview and run.
//
// This is the whole security design of the bridge in one file, so it is worth stating plainly:
//
//   `run` takes a token AND NOTHING ELSE.
//
// Not a token plus a prompt to check against it, not a token plus an argv to validate — a token,
// which names an invocation this process built and handed to the UI. There is consequently no
// argument a caller could pass that would make the run differ from what the preview returned, and
// nothing to get the validation of subtly wrong. The property that buys: *the only executable
// prompts are ones the user was shown*. A renderer bug — or a compromised renderer — cannot invent
// a prompt and execute it, because inventing a prompt is not something the run channel accepts.
//
// Three further rules, each closing a way a token could outlive its meaning:
//
//   • **Single use.** Claiming a token consumes it. A replayed token is refused, so a run cannot be
//     re-triggered from a stale message.
//   • **Expiry.** A preview is a snapshot of a decision the user made; ten minutes later the files
//     it describes may not be the files on disk. An old token is refused rather than run against a
//     changed project.
//   • **Process-local.** Tokens live in this process's memory and die with it. Nothing is persisted,
//     so no token survives a restart to be replayed against a different project.
//
// Refusals carry a reason the UI can show. "Refused" with no explanation is indistinguishable from
// a bug, and the user's next move (preview again) has to be obvious.

import { randomUUID } from "node:crypto";
import type { HandoffContext } from "./contracts.js";

/** How long a preview stays runnable. Long enough to read the prompt, short enough to still mean it. */
export const TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * What a token authorises, and therefore which run channel will accept it.
 *
 * Two things in this app spawn a previewed command: the `claude -p` bridge and the usage-stats
 * reader (`ccusage.ts`). They share this store — one expiry, one single-use rule, one place to
 * clear on a project switch — but they must not share TOKENS. Without this field a stats preview
 * would hand the renderer a token that `claude:run` would happily claim, and `runPreviewedClaude`
 * would spawn `npx` while every message on screen said Claude. The purpose is checked on claim, so
 * a token can only ever run the thing it was previewed for.
 */
export type InvocationPurpose = "claude" | "usage-stats";

/** Exactly what will be spawned. Built by preview, never by a caller. */
export interface ClaudeInvocation {
  token: string;
  /** Which run path may claim this token. */
  purpose: InvocationPurpose;
  /** Absolute path of the resolved CLI — argv[0]. */
  bin: string;
  /** Arguments after the binary, including the prompt. */
  args: string[];
  cwd: string;
  /** The prompt as shown to the user; also present inside `args`. For a non-prompt run, "". */
  prompt: string;
  /**
   * Absolute paths the run may write, exactly as the confirmation listed them. A directory means
   * anything under it; empty means the run has no write authority at all.
   *
   * On the invocation rather than passed to the run for the same reason the prompt is: the run
   * takes a token and nothing else, so there is no argument by which a caller could widen what a
   * previewed run may write. The permission callback reads this and cannot be more generous than
   * what the user was shown.
   */
  writable: string[];
  /**
   * What continuing this preview IN THE PANE would open, or null when it cannot be continued there.
   *
   * On the invocation for exactly the reason `writable` and `prompt` are: `session:handoff` takes a
   * token and nothing else, so there is no argument by which a caller could hand the pane a
   * directory of its choosing. A renderer that wants the session to be able to write somewhere has
   * to submit a form and get a preview for it, which is the same friction the run channel imposes on
   * prompts. Null for a `maestro-task` preview — a task's write target is the whole project.
   */
  handoff: HandoffContext | null;
  createdAt: number;
  expiresAt: number;
}

const invocations = new Map<string, ClaudeInvocation>();

/** Thrown when a run request does not carry a token this process issued. */
export class TokenRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenRefused";
  }
}

function evictExpired(now: number): void {
  for (const [token, inv] of invocations) if (inv.expiresAt <= now) invocations.delete(token);
}

/** Record an invocation preview built, and return the token that can run it exactly once. */
export function issueInvocation(inv: Omit<ClaudeInvocation, "token" | "createdAt" | "expiresAt">): ClaudeInvocation {
  const now = Date.now();
  evictExpired(now);
  const issued: ClaudeInvocation = {
    ...inv,
    token: randomUUID(),
    createdAt: now,
    expiresAt: now + TOKEN_TTL_MS,
  };
  invocations.set(issued.token, issued);
  return issued;
}

/**
 * Take the invocation a token names, consuming it.
 *
 * Throws `TokenRefused` for anything that isn't a live, unused token issued by this process FOR
 * THIS PURPOSE. The cases are distinguished because they mean different things to the user: a
 * forged token is a bug worth reporting, an expired one just needs previewing again.
 */
export function claimInvocation(token: unknown, purpose: InvocationPurpose): ClaudeInvocation {
  if (typeof token !== "string" || token.length === 0) {
    throw new TokenRefused(
      "Refused: this run carried no preview token. Every run must come from a preview the user confirmed."
    );
  }
  const inv = invocations.get(token);
  if (!inv) {
    throw new TokenRefused(
      "Refused: no preview matches this token. It was never issued, or it has already run — preview again and confirm the prompt."
    );
  }
  // Consumed either way: a token that reaches this point is spent, expired or mis-aimed, so no
  // path leaves a claimable token behind.
  invocations.delete(token);
  if (inv.purpose !== purpose) {
    // The command this token describes is not the kind of command this channel runs. Refused
    // rather than coerced: the user confirmed one thing, and running the other under its
    // authorisation is exactly what the token exists to prevent.
    throw new TokenRefused(
      `Refused: this preview authorises a ${inv.purpose} run, not a ${purpose} one. Preview again from the surface you meant to run from.`
    );
  }
  if (inv.expiresAt <= Date.now()) {
    throw new TokenRefused(
      "This preview expired. The project may have changed since it was built — preview again and confirm the prompt."
    );
  }
  return inv;
}

/** Drop every outstanding token. Tests use it; so does a project switch, which invalidates every cwd. */
export function clearInvocations(): void {
  invocations.clear();
}
