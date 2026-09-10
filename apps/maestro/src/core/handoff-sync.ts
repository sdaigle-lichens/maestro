// Install/update's handoff sync step — the app-side half. Mirrored in plain JS by
// `plugins/maestro/scripts/maestro-install.js` for the terminal path (which reads the global store
// through the same generated `lib/maestro-handoff-defaults.cjs`, and reaches `decideSync` through
// `lib/maestro-agent-sync.cjs`, so neither half carries its own copy of the branches).
//
// Structurally `report-sync.ts` with a different candidate set. Two things differ, and only two:
//
//   - THE CANDIDATES COME FROM THE GRAPH. A report's candidates are "every agent already tracked,
//     plus every agent in `agents_available`" — a bounded, project-scoped set. The pair analogue
//     of `agents_available` would be a CROSS PRODUCT: 18 files for a fullstack project whose
//     workflows wire 6-8. So the candidates are the routes the workflows actually wire, from
//     `handoffRoutes()` — the same function the SubagentStart hook uses to decide what to inject,
//     which is what stops the installed files and the injected protocols from disagreeing. Plus
//     every id already in the slice, so a pair the graph no longer wires still gets its tracking
//     honoured rather than silently abandoned.
//   - THE ID IS A PATH. `"<sender>/<receiver>"` contains a `/` by design and is joined into
//     `.claude/handoffs/`, so it is validated against `isValidHandoffId` BEFORE any `path.join`.
//
// Everything else is identical, deliberately: the hash is over the whole file (a handoff template
// has no frontmatter to normalise out), "the global advanced" is an integer `>`, and the branches
// are `decideSync`'s — this is its THIRD caller, and shares `059`'s `adopt` branch (an untracked
// file whose bytes match a known version of the global default) rather than growing its own.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readConfig, writeConfig } from "./config.js";
import { readHandoffDefault, DEFAULT_HANDOFF_DEFAULTS_DB_PATH } from "./handoff-defaults.js";
import { handoffRoutes, handoffPairs } from "./handoff-routes.js";
import { isValidHandoffId, PRIOR_SEEDS } from "./handoff-seeds.js";
import { decideSync, type SyncTracking } from "./sync-decision.js";
import type { MaestroHandoffsSlice } from "./types.js";
import type { HandoffSyncSummary } from "./contracts.js";

export type { HandoffSyncSummary };

/** `.claude/handoffs/<sender>/<receiver>.md` — the id IS the path, which is why it is validated. */
export function handoffFilePath(projectRoot: string, handoffId: string): string {
  if (!isValidHandoffId(handoffId)) throw new Error(`Invalid handoff id: ${String(handoffId)}`);
  const [sender, receiver] = handoffId.split("/");
  return path.join(projectRoot, ".claude", "handoffs", sender, `${receiver}.md`);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** No-op (returns all-empty) when the project has no `maestro.json` yet. */
export function syncProjectHandoffs(
  projectRoot: string,
  dbPath: string = DEFAULT_HANDOFF_DEFAULTS_DB_PATH
): HandoffSyncSummary {
  const summary: HandoffSyncSummary = {
    materialized: [],
    refreshed: [],
    adopted: [],
    staleCustomized: [],
    unchanged: [],
  };
  const cfg = readConfig(projectRoot);
  if (!cfg) return summary;

  const handoffs: MaestroHandoffsSlice = { ...(cfg.handoffs ?? {}) };
  const wired = handoffPairs(handoffRoutes(cfg.workflows, cfg.workflow_instances));
  // An id already in the slice that the graph no longer wires stays a candidate: it may still be
  // tracking a global default, and dropping it from the walk would leave a file the user believes
  // is maintained silently frozen.
  const candidates = [...new Set([...Object.keys(handoffs), ...wired])].filter(isValidHandoffId);
  let changed = false;

  for (const id of candidates) {
    const entry = handoffs[id];
    const global = readHandoffDefault(id, dbPath);

    const filePath = handoffFilePath(projectRoot, id);
    const onDisk = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
    const localHash = onDisk === null ? null : sha256(onDisk);

    // A `handoffs` entry with no `syncedFrom` is a hand-authored override, which
    // `saveProjectHandoffOverride` marks by dropping the field. No entry at all is a different
    // thing: `.claude/handoffs/` predates this slice as an undocumented escape hatch, so a file
    // sitting there with nothing pointing at it is somebody's own and must survive untouched —
    // unless its bytes are themselves the evidence (`matchesKnownVersion` below).
    const tracking: SyncTracking = entry
      ? entry.syncedFrom
        ? { kind: "tracked", hash: entry.syncedFrom.hash }
        : { kind: "detached" }
      : { kind: "untracked" };

    // Known versions of this route's protocol: the CURRENT global body, plus every body this
    // route has ever been seeded with (`refreshSupersededSeeds`'s own history in
    // `handoff-defaults.ts`). A pair only ever hand-written through `/templates` has no prior
    // seeds, so only the current body counts.
    const knownHashes = global ? [global.content, ...(PRIOR_SEEDS[id] ?? [])].map(sha256) : [];

    const verdict = decideSync({
      tracking,
      localHash,
      hasTemplate: global !== null,
      // The global store's version is an integer that only ever goes up, so "advanced" is `>`.
      templateAdvanced: !!global && !!entry?.syncedFrom && global.version > entry.syncedFrom.version,
      matchesKnownVersion: localHash !== null && knownHashes.includes(localHash),
    });

    // Neither of these is a state the user needs told about: one is content they own outright, the
    // other is a wired route with no template to sync from (`scribe -> reviewer` today).
    //
    // `no-template` has one side effect, though, and it is the only writing branch that reports
    // nothing: a global row the user DELETED on `/templates` leaves this project's entry pointing
    // at a version that no longer exists. The file stays — the project tier is the user's own and
    // outranks the global one at the hook either way — but the tracking is cleared, which is
    // exactly the shape `saveProjectHandoffOverride` writes for a hand-authored override. Left
    // alone it would be a `syncedFrom` that can never match and can never advance, and the row
    // would flip back to `refresh` the moment somebody re-created the pair under the same name.
    if (verdict === "no-template") {
      if (entry?.syncedFrom) {
        handoffs[id] = { id };
        changed = true;
      }
      continue;
    }
    if (verdict === "detached") continue;

    if (verdict === "materialize" || verdict === "refresh" || verdict === "adopt") {
      // `adopt` may already match byte-for-byte — the write is then a no-op on disk, done anyway
      // so tracking always ends up recorded without a second "did it already match" check.
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, global!.content);
      handoffs[id] = { id, syncedFrom: { version: global!.version, hash: sha256(global!.content) } };
      summary[verdict === "materialize" ? "materialized" : verdict === "refresh" ? "refreshed" : "adopted"].push(id);
      changed = true;
      continue;
    }

    if (verdict === "stale-customized") {
      summary.staleCustomized.push(id);
      continue;
    }

    summary.unchanged.push(id);
  }

  if (changed) writeConfig(projectRoot, { ...cfg, handoffs });
  return summary;
}
