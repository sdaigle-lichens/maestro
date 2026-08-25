// What a create-* form says to the session it hands off into — the seed, and the announcement.
//
// TWO SENTENCES WITH TWO AUDIENCES, and they are here together because they describe one event.
// `handoffSeed` is read by the MODEL: it is appended to the transcript with `shouldQuery: false`,
// so it costs nothing until the user types, and it exists so the conversation starts knowing what
// has already been decided rather than re-asking for a name the form captured. `handoffNotice` is
// read by the USER: it is the inline transcript line saying which directory just became writable,
// because a scope that grew silently is a scope nobody consented to.
//
// PURE — string arithmetic over a `HandoffContext` the preview already resolved. No `fs`, no path
// resolution, no SDK. The reading of the disk happened once, in `claude-preview.ts`, when the token
// was issued; by the time this runs, the facts are facts and this module only phrases them.

import type { HandoffContext } from "./contracts.js";

/** How each form reads in a sentence — the artifact, not the channel it arrived on. */
const ARTIFACT: Record<HandoffContext["kind"], string> = {
  "create-skill": "skill",
  "create-subagent": "subagent",
  "create-plugin": "plugin",
  "create-marketplace": "marketplace",
  "update-skill-tags": "skill tags",
};

/** What a `SessionWrite`'s scope means, in the words both the header and the model are given. */
export function writeScopeNote(scope: HandoffContext["scope"]): string {
  return scope === "directory" ? "this directory and everything under it" : "this file and nothing else";
}

/**
 * The context appended to the conversation, without spending a model call.
 *
 * Everything in it is a fact the user has already seen: the artifact the scaffold reported, the
 * frontmatter the form's live preview rendered, the repository state `016` decided, and the prompt
 * the confirmation dialog displayed in full. NOTHING NEW IS INVENTED HERE — the seed is a
 * re-statement of the same preview, which is what makes "the session starts from what you approved"
 * true rather than a claim about this function's good behaviour.
 *
 * `prompt` is that previewed prompt, verbatim, as "what is left to write". It reads as an
 * instruction because it is one — but it arrives without a turn, so nothing acts on it until the
 * user says something, and what they say is what steers it.
 */
export function handoffSeed(handoff: HandoffContext, prompt: string): string {
  const what = ARTIFACT[handoff.kind] ?? "artifact";
  const opening =
    handoff.kind === "update-skill-tags"
      ? `The user clicked "Update skill tags" on the /skills page. What follows is every project`
      : `The user submitted the ${handoff.kind} form and the deterministic scaffold has already run, so`;
  const openingRest =
    handoff.kind === "update-skill-tags"
      ? `skill's current description and tags — nothing else about those skills was read.`
      : `the ${what} is on disk. They chose to finish it here, in conversation, rather than as a headless run.`;
  return [
    `[Context from the Maestro app. No reply is needed: this was appended without starting a turn,`,
    `and the user's next message is the one to answer.]`,
    "",
    `${opening}`,
    `${openingRest}`,
    "",
    `Artifact: ${handoff.artifact}`,
    `Writable without interrupting the user: ${handoff.writeScope} (${writeScopeNote(handoff.scope)}).`,
    // MEASURED, AND THE WORDING IS THE FIX. An earlier draft said writes outside the scope were
    // "refused, or come back to the user as a question", and the session read that as a wall: asked
    // for a file one directory up it declined to try, explaining that it could not bypass the app's
    // boundary. That is the opposite of what `020` built — the user can allow a write, and the only
    // way they get the chance is if the model attempts it. So the sentence says what actually
    // happens, and says to go ahead.
    `A write anywhere else is not forbidden: it pauses and asks the user, who can allow it. So do`,
    `whatever the work needs and let them answer — do not talk yourself out of a tool call.`,
    `Repository: ${handoff.repo}`,
    "",
    handoff.kind === "update-skill-tags" ? `The project's skills, as discovered (id — description — tags):` : `What the scaffold wrote:`,
    indent(handoff.state),
    "",
    `What is left to write:`,
    indent(prompt),
    "",
    handoff.kind === "update-skill-tags"
      ? `Descriptions were derived from the skill's own id/name only; nothing else about a skill was ` +
        `read. Only after the user confirms in chat: fix a missing/wrong description with Edit on ` +
        `that skill's own SKILL.md frontmatter, and report every tag change as one ` +
        "```update-skill-tags``` " +
        `JSON block, keyed by skill id, as the last thing in that message.`
      : `The form captured the name, the description and the triggers above and the user approved them —` +
        `\ndo not ask for them again, and do not rewrite the frontmatter the scaffold produced.`,
  ].join("\n");
}

/** The inline transcript line. One sentence, naming the directory and what opened it. */
export function handoffNotice(handoff: HandoffContext): string {
  if (handoff.kind === "update-skill-tags") {
    return (
      `Opened from "Update skill tags" on the /skills page. This session may now write ${handoff.writeScope} ` +
      `(${writeScopeNote(handoff.scope)}) — so it can fix a skill's SKILL.md description. Tag changes go through ` +
      `the app instead, via the fenced block described above.`
    );
  }
  const what = ARTIFACT[handoff.kind] ?? "artifact";
  return (
    `Handed off from the ${handoff.kind} form. This session may now write ${handoff.writeScope} ` +
    `(${writeScopeNote(handoff.scope)}) — the ${what} “${handoff.name}” the scaffold just wrote. ` +
    `That is the only thing this added: writes anywhere else still ask, and the context above cost no model call.`
  );
}

/** The title the transcript's context block carries, so a collapsed entry still says what it is. */
export function handoffTitle(handoff: HandoffContext): string {
  return handoff.kind === "update-skill-tags"
    ? `Context from "Update skill tags"`
    : `Context from the ${handoff.kind} form — ${handoff.name}`;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `  ${line}`))
    .join("\n");
}
