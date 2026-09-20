# Forking a global agent, and reviewing the fork

How [`agents-view`](../SKILL.md) copies a global-tier agent into the project, and how it later shows
that the fork has fallen behind its template.

## The fork

Only the description and the Content tab body lock on a Global-tier card — every other field still
saves normally. The escape hatch is an icon-only Copy button in the view-mode footer
(`data-testid="agent-fork-button"`, title "Copy into the project"), calling `forkAgent`
(`src/core/agent-fork.ts`) over the `agent:fork` channel with the agent's own name — this card
always shadows, never renames; there is no free-text field here.

**This page is no longer the only caller of `forkAgent` (`041`).** `/workflows`' `InstancePicker`
offers a *renamed*-fork path from its all-placed dead end, with its own free-text field — a
workflow can't place two instances on one bare agent (`placedAgentTypes`), so forking under a new
name is the supported way to get a second, genuinely distinct instance. Same channel, same
provenance record, same `renameAgentInFrontmatter`/`copyAgentAttributeRows` machinery described
below; the differences are the caller, the fact that a name can be typed at all, and what happens
on success (there it selects the fork into the picker's own field and adds it to
`config.agents_available`, not this page's edit session). The `isProjectTier` gate travels with it:
the picker is handed a `forkableAgents` list built the same way (a discovered agent whose `source`
is not `"project"`), because `forkAgent` throws on a project agent — so neither surface can offer a
fork that cannot happen. See `workflow-view`'s picker/fork note.

- A **same-name fork** — the only kind this card's Copy button performs — copies the template file
  byte-for-byte, including its `description:` line — shadowing is the mechanism: a project
  `.claude/agents/<name>.md` wins `dedupeById`'s resolution, so the list shows one row, now sourced
  from the project.
- A **renamed fork**, reachable only from `/workflows`' `InstancePicker`, rewrites only the
  frontmatter `name:` line and calls `copyAgentAttributeRows(fromName, toName, projectRoot)` to copy
  the avatar/type/project-tag rows to the new name — see `global-stores`. The read side stays
  global/name-only (the template is always a global-tier agent); the write side scopes to the fork's
  own project (`030`), since the copy always lands on a project-tier agent. A same-name fork needs no
  copy: the shadowing row *is* the template's own global row.

Every fork — same-name or renamed — writes a provenance record to
`<projectRoot>/.claude/agent-forks.json` (`AgentForkRecord`: `sourceTier: "user" | "plugin"`,
`sourcePlugin`, `pluginVersion`, `templateBodyHash`, `templateBody`, `forkedAt`), **never** into the
agent's own frontmatter beyond the rename — `agent-fork.ts`'s header explains why (Maestro's own
bookkeeping doesn't belong in a file format it doesn't own, same argument as the description
exception among the write paths). `hashAgentBody` strips **both** the `name:` and the `description:`
frontmatter lines (and their continuations) before hashing, so neither editing the description after
forking nor renaming the fork at creation marks it as diverged. The `name:` half is `031`'s
correction: `forkAgent` rewrites exactly that line on a renamed fork, so a description-only
normalisation left every renamed fork hashing differently from its own template **from birth** —
permanently stale-but-customized, with the refresh branch never firing for it.

`/create-subagent`'s "Start from a template" field (`target: "project"` only) is a **different,
lighter-weight thing** — it seeds a fresh manual-mode form's `name`/`description` from a picked
agent, not a byte-for-byte copy of its body. See `create-skills-architecture`.

## Reviewing a fork against its template (`031`)

A fork is a snapshot, and the template moves on. `src/core/agent-sync.ts` notices; **this page is
where the user answers.**

**The mechanism is not documented here.** The shared decision function, the two staleness triggers,
the hashing normalisation, the provenance record and what `update`/`keep`/`detach` actually write
all live in [`agent-fork-sync`](../../agent-fork-sync/SKILL.md) — a concept, not a view, because
`report-sync.ts` is its other caller and a reader arriving from there has no reason to open this
file. Read that first; what follows is only what is true of this page.

| Surface | What it shows |
| --- | --- |
| `/maestro`'s `ForkedAgentsCard` (`maestro.tsx`, `data-testid="maestro-diverged-forks"`) | The headline count from `useInstall().agentSync`, linking to `/agents`. Renders nothing when `diverged` is empty. |
| This page's banner (`data-testid="agent-fork-diverged"`) | One chip per diverged fork at the top of `<main>`; clicking one selects it. |
| `agent-fork-review.tsx` (`data-testid="agent-fork-review"`, `data-verdict`) | The per-agent review: both descriptions side by side, the body diff (`data-testid="agent-fork-diff"`, from `src/core/diff.ts`), and **Update / Keep as fork / Detach**. |

- **The review renders BELOW the card, not inside `AgentCard`.** `CARD_MIN_HEIGHT` is a measured
  constant keeping the card the same height in view and edit mode; a conditional diff block inside it
  would make that height vary by agent and by template state. The review is also hidden while
  editing. Because no edit-mode card content changed, `CARD_MIN_HEIGHT` did **not** need
  re-measuring for `031`.
- **Update is offered even for a stale-customized fork, behind a two-click confirmation**
  ("Take the new body…" → "Discard my edits and take it"). "Never overwritten" is a promise about
  the **automatic** path — `computeAgentSync` writes nothing, ever — and refusing a user who has
  read the diff and pressed twice would leave no route to take the update at all.
- **Both descriptions are on screen beside the diff on purpose.** A fork syncs its body while its
  description stays the user's, so the two drift — the description ending up promising something the
  new body no longer does. Not a blocker, and only noticeable if both are visible.
- **`refresh()` fans out a seventh read** (`window.maestro.agents.sync()`), so a fork, an update or
  a detach is reflected without a round trip of its own. The count the banner shows is
  `summary.diverged`, which is deliberately narrower than `refreshed + staleCustomized` — see
  [`agent-fork-sync`](../../agent-fork-sync/SKILL.md).
