# Make project the only editable agent tier, and fork the rest

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`/agents` currently lets three of the four tiers rewrite their own definition file:

```ts
export const EDITABLE_AGENT_SOURCES: readonly string[] = ["project", "user", "maestro"];
```

The `maestro` entry is editable by accident. Bundled agents are ordinary files in a repo checkout,
but in a packaged build they live inside `app.asar` — so `setAgentDescription`'s
`fs.accessSync(ref.file, W_OK)` guard throws "this build ships it read-only". The same Edit button
works or fails depending on how the user installed the app, and the failure only appears at Save.
Most users will never have this repository cloned at all.

Narrow the list to `["project"]` and make the two remaining tiers legible instead of surprising.

**The `user` tier is immutable too, and the reason is not the one you'd guess.** A
`~/.claude/agents/*.md` agent was not "created in some other project" — it belongs to no project and
is shared by every project on the machine. Any message that tells the user to go edit it where it
was created points at a place that does not exist. Say what is true: this agent is machine-wide, and
forking it is how you customise it here. For `maestro` and plugin agents, say that a plugin update
overwrites the file, so an edit there would be silently temporary.

**Split the left pane into two sections — Project agents and Global agents — and tag the card to
match.** This costs less than it looks: `discoverAgents` already runs `dedupeById` over
project → user → bundled → plugins, first wins, so an agent appears exactly once, in its winning
tier. The two sections are therefore exhaustive and non-overlapping for free, and forking an agent
*moves its row* from Global to Project. That movement is the confirmation the fork worked — no toast
needs to explain it.

**Lock the description, not the card.** Only one of the six fields writes into a file this app does
not own:

| field | writes to | locked for a global agent? |
| --- | --- | --- |
| description | the agent's own `.md` frontmatter | **yes** |
| type | `~/.claude/maestro-agent-types.sqlite` | no |
| project tag | `~/.claude/maestro-agent-project-tags.sqlite` | no |
| avatar | `~/.claude/maestro-avatars.sqlite` | no |
| report | `.claude/reports/` + the project's `reports` slice | no |
| skills | `maestro.json`'s `workflows` slice | no |

The boundary is "does this write into a file the app doesn't own", not "is this agent global". Make
the UI copy say that, or people will assume the whole card is frozen.

**Forking.** A "Fork into this project" button on the read-only card, and a template field on
`/create-subagent` that seeds the form from an installed agent. The card button matters most — it
sits exactly where the user hits the wall, and it turns a refusal into a next step. The operation
itself is small: `findAgentFile` already resolves an agent in any tier, so a fork is a read plus a
write to `.claude/agents/<name>.md`. No Claude session, no token.

Default the fork to the **same name**. Shadowing is the mechanism, not a side effect: a project
`.claude/agents/reviewer.md` shadows the global one in Claude Code's own resolution, and
`dedupeById` shows one row. A prefixed name like `my-project-reviewer` would leave the original
installed and dispatchable, so the model would be choosing between two reviewers by description —
a rival, not a customisation. Offer a free-text rename for the case where a variant beside the
original is genuinely wanted; the useful name there describes the difference (`strict-reviewer`),
not the project, which the agent's own location already implies.

**On rename, copy the global rows explicitly.** All three stores are `agent_name TEXT PRIMARY KEY`,
so a same-name fork inherits its template's avatar, type and project tag for free, while a renamed
one starts blank. That asymmetry will surprise someone. Copy the rows as part of the rename.

**Restrict template-forking to `target: "project"`.** `/create-subagent` can also target a
marketplace, and forking a third-party plugin's agent into your own plugin is republishing someone
else's work.

**Record the fork's baseline, even though nothing reads it yet.** `031` builds the sync that keeps a
fork in step with its template; this ticket only has to write down where the fork came from. Do it
here anyway, because it is the one part that cannot be retrofitted — a fork created without a
baseline is permanently unsyncable, since there is no way to recover afterwards what it was forked
from. Store, per forked agent: the source tier and plugin, the plugin version at fork time, a hash
of the template body, and the template body itself.

Put that in a **project-local sidecar, not the agent's frontmatter**. `agent-descriptions.ts` argues
the description belongs in frontmatter precisely *because Claude Code reads it*, while Maestro's own
per-agent metadata lives in stores because it does not. Fork provenance is squarely the second kind,
and a `maestro-fork:` key would be this app writing private bookkeeping into a file format it does
not own. The sidecar also gives `031` somewhere to keep the baseline body, which a hash alone cannot
replace when the time comes to show a diff.

## Acceptance criteria

- [x] `EDITABLE_AGENT_SOURCES` is `["project"]`, and `setAgentDescription` refuses every other tier
      before touching the filesystem — `contracts.ts:182`; refusal asserted in
      `test/core/agent-descriptions.test.ts`, and live: editing `reviewer` (plugin) rendered a
      read-only paragraph
- [x] The `user`-tier refusal message describes a machine-wide agent in `~/.claude/agents/` and does
      not refer to a project it was created in — `describeUneditableSource` in
      `agent-descriptions.ts`; asserted by name/negative-assertion test in
      `test/core/agent-descriptions.test.ts`
- [x] The `maestro`/plugin refusal message explains that a plugin update overwrites the file — same
      function, same test file; live: `reviewer`'s footer note named the `maestro` plugin
- [x] The left pane renders two labelled sections, Project and Global, and every discovered agent
      appears in exactly one of them — `agent-list.tsx`'s `SectionLabel` + `projectItems`/`globalItems`
      split; live in a fixture project: one Project row, eight Global rows (7 bundled + 1 from another
      installed plugin), no duplicates
- [x] The card carries a tier tag consistent with the section the agent is listed under — `agent-card.tsx`
      `isProjectTier` tag; live: `reviewer` showed "Global" under Edit
- [x] On a global agent, the description field is read-only while type, project tag, avatar, report
      and skills all still save — description renders as a paragraph, not a textarea, while the type
      `<select>` stayed interactive in the live check; the other four fields are unaffected by
      `EDITABLE_AGENT_SOURCES`, which only gates `agent:describe`
- [x] "Fork into this project" on the card writes `.claude/agents/<name>.md` with the template's
      content byte-for-byte, and the agent moves from the Global section to the Project section on
      the next refresh — `forkAgent` in `agent-fork.ts`; live: forking `reviewer` made
      `.claude/agents/reviewer.md` byte-identical to `plugins/maestro/agents/reviewer.md`, and the left
      pane showed exactly one `reviewer` row, now under Project
- [x] A same-name fork shadows its template: the list shows one row, sourced from the project — same
      live check as above (one `reviewer` row post-fork)
- [x] A renamed fork copies the template's avatar, type and project tag rows under the new name —
      `copyAgentAttributeRows` in `agent-fork.ts`, covered end-to-end in `test/core/agent-fork.test.ts`
      with injectable `storeDbPaths`; live: forked `scribe` as `strict-scribe`
- [x] `/create-subagent` offers an installed agent as a template, and the option is unavailable when
      `target` is `marketplace` — "Start from a template" bar in `create-subagent.tsx`, gated on
      `target === "project" && agentTemplates.length > 0`; live: bar visible on Project, hidden on
      Marketplace
- [x] Every fork writes a sidecar record holding source tier, plugin, plugin version, template body
      hash and template body — and no fork writes anything into the agent's frontmatter beyond what
      the template already had — `writeAgentFork` → `<projectRoot>/.claude/agent-forks.json`; live:
      the `reviewer` entry recorded `sourceTier: "plugin"`, `sourcePlugin: "maestro"`,
      `pluginVersion: "0.3.3"`, and the matching hash/body
- [x] `test/isolation.test.ts` still passes: nothing new crosses the core/main/preload/renderer split
      — full suite green: `pnpm typecheck` and `pnpm test`, 709 tests / 38 files

## Notes for whoever picks this up

Hash the **body**, not the file. The description is expected to diverge — that is the entire point
of a fork — so a whole-file hash marks every fork as user-modified the moment its description is
edited, and `031`'s sync would then never fire for anybody. Normalise the `description:` line out
before hashing, and pin that with a test now rather than discovering it in `031`.

`030` rekeys three of the stores this ticket copies rows in. The two are independent, but forking is
what makes same-named agents across projects common, so landing `030` close behind is worth doing.

## Divergences from this page

1. **Sidecar location/shape**: this page said only "a project-local sidecar", with no path named.
   Landed as `<projectRoot>/.claude/agent-forks.json`, a flat JSON object keyed by the forked agent's
   name, one `AgentForkRecord` per entry. `031` should target that path and shape.
2. **`AgentForkRecord.sourceTier` is `"user" | "plugin"`, not the raw `DiscoveredDefinition.source`
   string.** This page said "the source tier and plugin" as two facts; the implementation models
   `"user"` as its own tier with no plugin, and folds both `maestro` (this repo's bundled copy) and
   any real installed plugin into tier `"plugin"` with `sourcePlugin` naming which one. `031` reads
   `sourceTier`/`sourcePlugin`, not `source`.
3. **`describeUneditableSource` backs the thrown error in `setAgentDescription`, but the `/agents`
   card's footer-note copy is a separately hand-written string in `agents.tsx`**, not the same
   function call — `src/renderer` may only import `contracts`/`text` from `src/core`, so a shared
   helper would need to move into `text.ts` (renderer-safe) to be literally shared. Left as two
   similar-but-separate strings; a future edit to one should check the other.
4. **`/create-subagent`'s template field is a lightweight form seed, not a byte-for-byte fork.** It
   sets `mode: "manual"`, `name`, and `description` from the picked `DiscoveredDefinition` (which only
   carries `id`/`description`) — the scaffold still writes a fresh skeleton via `manualAgentBody()`,
   it does not clone the source agent's actual body. The real byte-for-byte fork is `/agents`' "Fork
   into this project" button (`forkAgent`). Only `forkAgent`-created agents get an `agent-forks.json`
   entry — an agent created via the create-subagent template field gets no provenance record.
5. **`CreateOptions.agentTemplates` lists every discovered agent, project included** — not filtered to
   global-tier only. The UI restricts which `target` can use the feature at all, not which agent can
   seed a new form.

## Blocked by

_none_
