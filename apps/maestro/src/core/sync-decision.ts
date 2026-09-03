// The one rule for "a project copy that tracks a moving global template".
//
// LIFTED OUT OF report-sync.ts, which is where it was written down first and where the four cases
// are stated in prose at the top of the file. `031` needed exactly the same decision for a FORKED
// AGENT — a project-local copy of a `user`/plugin agent that records where it came from — and a
// second implementation of these five branches is the failure that ticket exists to avoid, the
// same way `resolveReport` is shared between the hook and the app so the two "must never be able
// to disagree".
//
// It is `fs`-free and knows nothing about reports or agents. The two things that DO differ between
// the callers are handed in already answered:
//
//   - the HASH. Reports hash the whole file; a forked agent hashes its body with the `name:` and
//     `description:` frontmatter lines normalised out (`hashAgentBody`), because those two are
//     expected to diverge — the description is the user's own, and a renamed fork rewrote its own
//     name. A whole-file hash would mark every fork as user-modified the moment either changed,
//     and the refresh branch below would then never fire for anybody.
//   - "has the template MOVED?". A report compares the global store's integer `version`. A
//     plugin-tier fork compares the plugin's `version` STRING for inequality, because a plugin's
//     files come from a per-VERSION marketplace cache that `autoUpdate` only re-pulls when that
//     string changes (see the `updating-maestro` skill) — so a plugin edit shipped without a
//     version bump genuinely IS "no update available", and reporting it otherwise would promise a
//     refresh that no delivery path can deliver. A `user`-tier fork has no version at all
//     (`~/.claude/agents/*.md` are hand-edited files), so it compares template content hashes.
//
// Nothing here writes. The caller decides whether a verdict becomes a file write (install's report
// sync does) or stays a read-only report (agent sync does — see agent-sync.ts).

/**
 * What the project copy claims about its own provenance.
 *
 * - `tracked` — it is a copy of the template as of `hash`, and may be refreshed.
 * - `detached` — the user took ownership: a hand-authored report override (a `reports` entry with
 *   no `syncedFrom`), or a forked agent whose provenance record was dropped by "detach". Never
 *   compared against the template, never touched, never reported.
 * - `untracked` — there is no record at all. Distinct from `detached`: a file sitting where a copy
 *   would go, with nothing pointing at it, is somebody else's and is left alone.
 */
export type SyncTracking = { kind: "tracked"; hash: string } | { kind: "detached" } | { kind: "untracked" };

export type SyncVerdict =
  /** Owned by the user — out of scope entirely. */
  | "detached"
  /** Nothing to sync from: no global default, or the template no longer resolves anywhere. */
  | "no-template"
  /** No project copy on disk. The template's content is what belongs there. */
  | "materialize"
  /** Untouched since the last sync, and the template has moved on. Safe to overwrite. */
  | "refresh"
  /** The user edited it. Left alone on disk, surfaced so they know why it is not being updated. */
  | "stale-customized"
  /** Nothing to do. */
  | "unchanged";

export interface SyncDecisionInput {
  tracking: SyncTracking;
  /** The project copy's current hash, in whatever normalisation the caller uses. Null ⇒ no file. */
  localHash: string | null;
  /** There is a template to sync from at all. */
  hasTemplate: boolean;
  /** Has the template moved past what `tracking` recorded? Only consulted for a `tracked` copy. */
  templateAdvanced: boolean;
}

/**
 * The five branches, in the order report-sync.ts has always applied them — cheapest and most
 * fundamental first, so that "the user owns this" outranks every other consideration and "there is
 * nothing to sync from" is answered before anything is compared.
 */
export function decideSync({ tracking, localHash, hasTemplate, templateAdvanced }: SyncDecisionInput): SyncVerdict {
  if (tracking.kind === "detached") return "detached";
  if (!hasTemplate) return "no-template";
  if (localHash === null) return "materialize";
  // A file already sits where the copy would go, but nothing tracks it. Treating it as
  // unmodified-since a sync that never happened would overwrite an unrelated file, so it is left
  // alone and reported as unchanged.
  if (tracking.kind === "untracked") return "unchanged";
  if (localHash !== tracking.hash) return "stale-customized";
  return templateAdvanced ? "refresh" : "unchanged";
}
