# The fork record

`<projectRoot>/.claude/agent-forks.json` — a flat JSON object keyed by the **forked agent's own**
name (not the template's; a renamed fork is keyed by its new name). Written by `forkAgent` on every
fork, read by `agent-sync.ts`, and the only thing that makes a fork syncable at all: nothing about
the file on disk records what it was copied from, and no scan could recover it afterwards.

It is a sidecar and **not** frontmatter on the agent's own `.md`, for the same reason a description
*is* frontmatter: `.md` is a format Claude Code reads, and Maestro's own bookkeeping does not belong
in it. See `agents-view` and `global-stores` for the other side of that rule.

## `AgentForkRecord`

| Field | Meaning |
| --- | --- |
| `agentName` | The fork's own name — the key. |
| `sourceTier` | `"user"` or `"plugin"`. `"maestro"` (this repo's bundled copy) and any real installed plugin both land in `"plugin"`. |
| `sourcePlugin` | Which plugin, or `null` for `"user"`. |
| `pluginVersion` | The version forked from, or `null` for `"user"` (and `null` when no manifest could be read). |
| `templateBodyHash` | `hashAgentBody` of the template at fork time — the **baseline**, i.e. what the fork's own body should still hash to if untouched. |
| `templateBody` | The template's bytes at fork time. Used to recover the *template's* name, and as the fork side of a merge when the fork's own file has gone missing. |
| `forkedAt` | ISO timestamp. |
| `acknowledgedFrom?` | `031`. `{ pluginVersion, templateBodyHash }` the user has already declined. Absent until they press **Keep as fork**. |

## The hashing normalisation

`bodyForHashing` removes the `name:` and `description:` frontmatter lines and any continuation lines
indented under them, then hashes the rest. Both fields are expected to diverge — the description is
editable after a fork, the name is rewritten by `forkAgent` on a rename — so hashing either marks a
fork as user-modified for doing the thing forks exist to do.

`029` normalised out only the description. Renamed forks therefore hashed as modified **from
birth**, and the refresh branch could never fire for one; `031` added the `name:` half. Two tests
pin it: one in `agent-fork.test.ts` on the hash itself, one in `agent-sync.test.ts` end to end.

## Reading it defensively

`agent-forks.json` is a **committed** file — only the three ephemeral session files are gitignored —
so it arrives through merges and hand-edits, not only through `writeAgentForkRecord`. `readAgentForks`
therefore drops what it cannot use: unparseable JSON (what a merge conflict leaves behind) returns
`{}`, and an individually malformed record is skipped while its neighbours survive.

Both degrade to *this agent is not a tracked fork*, which is the same thing **detach** says and the
safest reading of a file the app can no longer interpret: nothing is compared, nothing is offered,
no `.md` is touched. Before that guard existed, a record missing `templateBody` threw a bare
`Cannot read properties of undefined` out of `computeAgentSync`; `callMain` swallowed it, and the
fork review *and* the `/maestro` banner vanished for every fork with nothing on screen to say why.

A dropped record does not survive the next `writeAgentForkRecord` — that rewrites the whole object
from what was read — so a malformed entry is repaired away rather than carried forever.

## What `keep` and `detach` write

- **`keep`** writes `acknowledgedFrom` and nothing else. `templateBodyHash` is untouched, because
  the *fork's body* has not changed — the acknowledgement is about the template. `templateAdvanced`
  then compares against the acknowledgement when present and the baseline otherwise, so the question
  re-opens by itself the next time the template moves. Without this field, "keep" would be a no-op
  that re-raised the identical diff on every launch, and would not be a choice at all.
- **`detach`** deletes the whole record. The `.md` is not read, not written, not moved. Afterwards
  the agent is `decideSync`'s `detached` verdict, reached by the user rather than by
  `saveProjectReportOverride`'s equivalent — and it is not recoverable: re-tracking means forking
  again.

## `mergeForkBody`, the inverse

An update writes the template's current contents with the fork's own `name:` and `description:`
lines carried over **verbatim** — not re-serialised through `replaceDescriptionInFrontmatter`, which
would rewrite quoting the user chose. The two fields that hash out are the two that carry over, so
`hashAgentBody(mergeForkBody(t, f)) === hashAgentBody(t)`: after an update the fork is genuinely in
step, and the next `computeAgentSync` says so. That identity is a test.

A template with no frontmatter block is returned unchanged rather than refused — there is nowhere to
put the fields, and failing the update over a file shape this app never authored helps nobody.
