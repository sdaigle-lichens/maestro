// When a live session has to ask a PERSON — and what the question looks like on screen.
//
// This is not a fourth permission engine. `write-scope.ts` decides writes, `session-scope.ts`
// decides whether a read stayed inside the disclosed directories, and both are called from here
// unchanged: what this module adds is the third answer neither of them can give. `decideWrite`
// returns allow or deny because a headless run has nobody to ask; a pane session does, so the same
// two decisions gain a branch that means "the answer comes from the user, not from the path list".
//
// THREE OUTCOMES, AND ONLY ONE OF THEM IS NEW.
//
//   • `settled` — the engine answered. Allow, or a deny the user is not asked to overrule: a tool
//     this session never offered is refused outright, because the answer to "may I use Bash" is not
//     a question for a dialog box.
//   • `ask` — a person decides. Reads the boundary stopped, writes the empty write scope refused,
//     and every call that leaves the machine.
//
// WHY A WRITE ASKS RATHER THAN SIMPLY BEING REFUSED. `019` shipped the pane read-only because there
// was nobody to ask; that is the sentence this module deletes. `decideWrite` still produces the
// refusal and still produces its reason — the prompt shows exactly that reason as why the call was
// stopped — but the user may now override it for THAT ONE CALL. Nothing accumulates: allowing a
// write leaves `writable` exactly as it was, and the next write outside it asks again.
//
// WHAT `022` CHANGED, AND WHAT IT DID NOT. The write scope is no longer always `[]`: a create-*
// form handed off to the pane appends the artifact's own directory, so a write inside it is
// `decideWrite`'s ALLOW and never reaches a prompt at all — the user-visible win is the questions
// that stop being asked, not new ones. Everything below is unchanged by that; this module reads
// `writable` and has never cared where it came from, which is exactly why the accumulator could be
// built without a second engine.
//
// PURE — string and path arithmetic. No `fs`, no spawn, no SDK, exactly like the two modules it
// composes, which is what lets the whole decision be tested without a window.

import path from "node:path";
import { decideBoundary } from "./session-scope.js";
import { decideWrite, targetPathOf, READ_ONLY_TOOLS, WRITE_TOOLS, type WriteDecision } from "./write-scope.js";
import type { PermissionDetail, PermissionDiff, SessionEventBody } from "./contracts.js";

/**
 * Tools that always ask, whatever the path check says.
 *
 * Neither touches the filesystem, so neither scope module has an opinion about them — and that was
 * fine while a run was headless and a fetch was the price of authoring a skill about something
 * external. In a session it is not: the model can read the user's project, and an outbound request
 * is how the contents of that project leave the machine. So the URL is shown, in full, and a person
 * says yes.
 */
export const PANE_ASK_TOOLS = ["WebFetch", "WebSearch"] as const;

/** How much of a body a prompt renders before it stops being a question and becomes a file viewer. */
const BODY_CAP = 600;

/** How many hunks of a multi-part edit are shown; the rest are counted. */
const HUNK_CAP = 3;

/** How the write scope reads inside a prompt. Absolute paths, because that is what the user sees. */
function listWritable(writable: readonly string[]): string {
  if (writable.length === 1) return writable[0];
  return `${writable.slice(0, -1).join(", ")} and ${writable[writable.length - 1]}`;
}

export interface PaneCallInput {
  tool: string;
  /** The tool input as the SDK delivered it. Untrusted shape, not a typed payload. */
  input: Record<string, unknown>;
  /**
   * What the session may write: empty until a create-\* form is handed off to it, one directory per
   * submit afterwards. A person can still allow a single call outside it, which adds nothing.
   */
  writable: readonly string[];
  /** What the session may read — the same list the hook and the disclosure use. */
  directories: readonly string[];
  cwd: string;
}

/**
 * What to do about one tool call in a pane session.
 *
 * `settled` carries the SDK-shaped answer itself rather than a flag, so the caller returns a value
 * this module produced instead of building a `{ behavior: … }` literal of its own. That is what
 * keeps the permission decision in one place: `agent-sdk.ts` routes, and never decides.
 */
export type PaneVerdict =
  | { outcome: "settled"; decision: WriteDecision }
  | {
      outcome: "ask";
      /** Why a PERSON is being asked. Written for the user — it is what the prompt shows. */
      reason: string;
      /**
       * What the MODEL is told if the user denies without typing a reason of their own.
       *
       * Two audiences, two sentences, and collapsing them costs one of them. `decideWrite`'s
       * refusal — "started to answer, not to author; say what should be written and where" — is
       * written to steer a model back to useful work and reads oddly in a dialog addressed to a
       * human. Keeping it here is what makes "a refused write still carries `decideWrite`'s reason"
       * true even though the write now raises a prompt first.
       */
      denyReason: string;
      target: string | null;
      detail: PermissionDetail;
      /**
       * The user may be offered more than "allow this one call" — a session grant on `target`.
       *
       * TRUE ONLY FOR A READ THE BOUNDARY STOPPED, and the narrowness is the point. A refused WRITE
       * is not grantable here and did not become so in `022`: the write scope grows from a submitted
       * form and its completed preview, never from a prompt, so offering a "grant the folder" button
       * on a write prompt would be a second door onto the one scope this app keeps single-sourced.
       * A network call is not grantable either; there is no path in it to grant.
       *
       * This flag says a grant is IN ORDER, not what it would be: resolving the options needs to
       * know whether `target` is a file or a directory, which needs the disk, which this module does
       * not touch. `grantOptionsFor` in `session-scope.ts` does that half.
       */
      grantable: boolean;
    };

/** A reason that is never empty. An unexplained refusal is a bare "denied", which steers nothing. */
export function permissionReason(text: string | null | undefined, fallback: string): string {
  const trimmed = String(text ?? "").trim();
  return trimmed === "" ? fallback : trimmed;
}

function str(input: Record<string, unknown>, key: string): string | null {
  const value = input?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function clip(text: string): { text: string; clipped: boolean } {
  return text.length <= BODY_CAP ? { text, clipped: false } : { text: `${text.slice(0, BODY_CAP)}…`, clipped: true };
}

/** What a write would change, as hunks — one for `Write` and `Edit`, several for `MultiEdit`. */
function diffOf(tool: string, input: Record<string, unknown>): PermissionDiff | null {
  const raw: Array<{ before: string | null; after: string }> = [];

  if (Array.isArray(input?.edits)) {
    for (const entry of input.edits as Array<Record<string, unknown>>) {
      const after = typeof entry?.new_string === "string" ? entry.new_string : null;
      if (after === null) continue;
      raw.push({ before: typeof entry?.old_string === "string" ? entry.old_string : null, after });
    }
  } else if (tool === "Edit" || typeof input?.old_string === "string") {
    const after = str(input, "new_string") ?? "";
    raw.push({ before: typeof input?.old_string === "string" ? input.old_string : null, after });
  } else {
    // `Write` carries the whole file as `content`; `NotebookEdit` carries a cell as `new_source`.
    const body = str(input, "content") ?? str(input, "new_source");
    if (body === null) return null;
    raw.push({ before: null, after: body });
  }

  if (raw.length === 0) return null;

  let clipped = false;
  const hunks = raw.slice(0, HUNK_CAP).map((hunk) => {
    const after = clip(hunk.after);
    const before = hunk.before === null ? null : clip(hunk.before);
    if (after.clipped || before?.clipped) clipped = true;
    return { before: before === null ? null : before.text, after: after.text };
  });

  return { hunks, more: Math.max(0, raw.length - HUNK_CAP), clipped };
}

/**
 * What the prompt for one call renders — the whole of "prompts render per tool".
 *
 * Built from the fields the call actually carries, never from a stringified payload. A tool this
 * function does not recognise still gets a NAME and whatever path or pattern it mentioned, which is
 * the least a user needs to answer; what it never gets is a JSON blob, because a prompt nobody can
 * read is answered with a reflexive Allow and that is worse than never having asked.
 */
export function describeCall(tool: string, input: Record<string, unknown>, cwd: string): PermissionDetail {
  if (tool === "WebFetch") {
    // THE COMPLETE URL, query string included. Eliding it to a hostname is the failure this whole
    // prompt exists to prevent: `example.com` and `example.com/collect?body=<the user's file>` are
    // the same prompt, and only one of them is worth denying.
    const url = str(input, "url");
    return url ? { kind: "fetch", url, prompt: str(input, "prompt") } : { kind: "other", summary: "WebFetch" };
  }

  if (tool === "WebSearch") {
    const query = str(input, "query");
    return query ? { kind: "search", query } : { kind: "other", summary: "WebSearch" };
  }

  if ((WRITE_TOOLS as readonly string[]).includes(tool)) {
    const target = targetPathOf(input);
    return { kind: "write", path: target ? path.resolve(cwd, target) : "", diff: diffOf(tool, input) };
  }

  if (tool === "Glob" || tool === "Grep") {
    const base = str(input, "path");
    return { kind: "scan", path: base ? path.resolve(cwd, base) : null, pattern: str(input, "pattern") };
  }

  if (tool === "Read") {
    const target = targetPathOf(input);
    return { kind: "read", path: target ? path.resolve(cwd, target) : "" };
  }

  const named = targetPathOf(input) ?? str(input, "pattern") ?? str(input, "skill") ?? str(input, "command");
  return { kind: "other", summary: named ? `${tool}(${named})` : tool };
}

/**
 * Decide one tool call in a pane session.
 *
 * The order is the design, and each step is where it is for a reason:
 *
 *   1. **The always-ask tools first**, because no path check has anything to say about them and
 *      falling through would auto-allow them.
 *   2. **The read boundary, over the read-only tools only.** The same restriction the hook has, for
 *      the same reason: letting the boundary answer for `Write` too would replace `decideWrite`'s
 *      reason with a different one, and the requirement is that a refused write keeps its own.
 *   3. **`decideWrite` for everything else** — the form path's engine, unchanged. Its allow is an
 *      allow. Its deny becomes a question only when the tool is one this app RECOGNISES as a write;
 *      a deny that means "this session does not offer that tool" stays a deny, because offering the
 *      user a button to grant `Bash` is not a permission prompt, it is a hole with a dialog on it.
 */
export function decidePaneCall({ tool, input, writable, directories, cwd }: PaneCallInput): PaneVerdict {
  const detail = (): PermissionDetail => describeCall(tool, input, cwd);

  if ((PANE_ASK_TOOLS as readonly string[]).includes(tool)) {
    const target = detail();
    return {
      outcome: "ask",
      reason:
        `${tool} reaches the network from inside this project, so it is not something this app decides for you. ` +
        `Check what is being sent and where before allowing it.`,
      denyReason:
        `The user did not allow this ${tool} call. Work from what is already in the project, ` +
        `and say what you would have looked up if it matters.`,
      target: target.kind === "fetch" ? target.url : null,
      detail: target,
      // Nothing to grant: the "path" here is a URL, and a session-scoped directory has no bearing
      // on whether the project's contents may leave the machine.
      grantable: false,
    };
  }

  if ((READ_ONLY_TOOLS as readonly string[]).includes(tool)) {
    const verdict = decideBoundary({ tool, input, directories, cwd });
    if (verdict.decision === "allow") return { outcome: "settled", decision: { behavior: "allow" } };
    // The boundary's reason is the one sentence that reads correctly to both audiences: it names
    // the path, names what IS in scope, and ends with "ask the user to open the directory you need".
    return {
      outcome: "ask",
      reason: verdict.reason,
      denyReason: verdict.reason,
      target: verdict.path || null,
      detail: detail(),
      // THE ONE BRANCH THAT CAN BE GRANTED. A read stopped by the boundary names a path the user
      // can meaningfully open, and `verdict.path` is empty only for the call the hook denies
      // outright — where there is nothing to authorise in the first place.
      grantable: verdict.path !== "",
    };
  }

  const decision = decideWrite({ tool, input, writable, cwd });
  if (decision.behavior === "allow") return { outcome: "settled", decision };
  if (!(WRITE_TOOLS as readonly string[]).includes(tool)) return { outcome: "settled", decision };

  const target = targetPathOf(input);
  const resolved = target ? path.resolve(cwd, target) : null;
  return {
    outcome: "ask",
    // TWO SENTENCES, BECAUSE THE SCOPE IS NO LONGER ALWAYS EMPTY. Until `022` there was one state
    // to describe — a session that had been given nothing — and after it there are two: a session
    // that has still been given nothing, and one that was handed a directory by a form and is now
    // reaching outside it. Telling a user "nothing has given this session write access" while the
    // header lists a directory it may write is the kind of wrong that teaches people to stop
    // reading prompts.
    reason:
      writable.length === 0
        ? `Nothing has given this session write access${resolved ? ` to ${resolved}` : ""} — it was started to answer ` +
          `questions rather than to author files. Allowing this lets that one write through and grants nothing ` +
          `further; the next one asks again.`
        : `${resolved ?? "That path"} is outside everything this session may write (${listWritable(writable)}), ` +
          `each of which was opened by a form you submitted. Allowing this lets that one write through and adds ` +
          `nothing to the list; the next write outside it asks again.`,
    // The model's sentence stays `decideWrite`'s, unchanged since `018`.
    denyReason: decision.message,
    target: resolved,
    detail: detail(),
    // A WRITE IS NEVER GRANTABLE HERE, and `022` did not change that. The write scope grows in
    // exactly one place — a create-\* form handed off with its completed preview — so that every
    // writable directory traces to an artifact the user made rather than to a button they pressed
    // while being asked about something else. A "grant this folder" here would be the second door,
    // and it would open on a prompt whose subject is a write the user has not thought about yet.
    grantable: false,
  };
}

/**
 * The SDK's auto-denial, as a transcript entry.
 *
 * THE FOURTH REFUSAL ROUTE, and the one with no code in common with the other three. The permission
 * system refuses some calls without ever reaching `canUseTool` — a deny RULE, or the permission
 * mode — and reports them only as a `permission_denied` stream event. A session that renders the
 * first three and not this one has a hole exactly where a user's own configuration is doing the
 * refusing, which is the case they are least able to diagnose.
 *
 * `decision_reason_type` is the discriminator naming the component that decided (`rule`, `mode`,
 * `classifier`, `asyncAgent`). It is carried through rather than folded into the sentence, because
 * "a rule refused this" and "a classifier refused this" call for different actions.
 *
 * Pure, and lifted out of the read loop for one reason: this is the branch that cannot be provoked
 * from a window without a machine-wide administrator policy file, so it has to be reachable by a
 * test instead of only by a regex over the source.
 */
export function autoRefusal(message: {
  tool_name?: string;
  decision_reason?: string;
  decision_reason_type?: string;
  message?: string;
}): SessionEventBody {
  const tool = String(message?.tool_name ?? "a tool");
  return {
    kind: "refusal",
    tool,
    // The event carries no path: it names the tool and the reason, and inventing a target here
    // would be this module guessing at input it was never given.
    target: null,
    reason: permissionReason(
      message?.decision_reason ?? message?.message,
      `${tool} was refused by this session's permission settings.`
    ),
    source: "auto",
    decidedBy: message?.decision_reason_type ?? null,
  };
}
