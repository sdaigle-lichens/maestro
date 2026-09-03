# The shared decision

`src/core/sync-decision.ts` is one exported function and three types. It has no `fs`, no imports
beyond its own types, and no knowledge of reports or agents.

```ts
decideSync({ tracking, localHash, hasTemplate, templateAdvanced }): SyncVerdict
```

## The branches, in order

The order is the contract, not an implementation detail — two of these positions carry meaning:

1. `tracking.kind === "detached"` → **`detached`**. First, so "the user owns this" outranks
   everything else. Never compared against the template, never touched, never reported.
2. `!hasTemplate` → **`no-template`**. Answered before anything is compared.
3. `localHash === null` → **`materialize`**.
4. `tracking.kind === "untracked"` → **`unchanged`**. A file sits where the copy would go with
   nothing pointing at it. Treating it as unmodified-since-a-sync-that-never-happened would
   overwrite somebody else's file.
5. `localHash !== tracking.hash` → **`stale-customized`**. **Before** `templateAdvanced` is
   consulted. This is why a caller that wants to report "there is an update you can't take
   automatically" needs `templateAdvanced` carried alongside the verdict rather than inferred from
   it.
6. `templateAdvanced ? "refresh" : "unchanged"`.

Both ordering guarantees (1 outranks everything; 5 precedes 6) are asserted directly in
`test/core/sync-decision.test.ts`, because a reordering would still pass every other test in the
repo.

## `SyncTracking` has three states, not two

| Kind | Means | Produced by |
| --- | --- | --- |
| `{ kind: "tracked", hash }` | A copy of the template as of `hash` | a `reports` entry with `syncedFrom`; any `agent-forks.json` record |
| `{ kind: "detached" }` | The user took ownership | `saveProjectReportOverride` dropping `syncedFrom`; `applyAgentSync(…, "detach")` removing the record |
| `{ kind: "untracked" }` | No record at all | no `reports` entry; no fork record |

`detached` and `untracked` are deliberately distinct. Collapsing them loses the difference between
"this is mine now" and "I have no idea what this file is", and those get different verdicts.

## What each caller supplies

| | `report-sync.ts` | `agent-sync.ts` |
| --- | --- | --- |
| `localHash` | `sha256` of the whole file | `hashAgentBody` — `name:`/`description:` normalised out |
| `hasTemplate` | a global report default exists | the template still resolves in its recorded tier |
| `templateAdvanced` | `global.version > syncedFrom.version` (integer, monotonic) | plugin: `template.version !== tracked.pluginVersion` **and** body hashes differ · user: body hashes differ |
| On a verdict | writes the file and bumps `syncedFrom` | records it and writes nothing |

## Adding a third caller

Answer the two questions for your thing — *what is the hash over*, and *what does "the template
moved" mean here* — and pass them in. Do **not** add a branch. If you find yourself wanting one, the
new case almost certainly maps onto an existing verdict and the disagreement is about naming.

The one thing to decide separately is what a verdict *means for the user*: `report-sync` turns
`materialize`/`refresh` into writes, `agent-sync` turns them into a report and a button. That
mapping belongs in the caller, and it is why `agent-sync`'s `materialized` bucket means "the fork's
own file went missing" rather than "a file was created".
