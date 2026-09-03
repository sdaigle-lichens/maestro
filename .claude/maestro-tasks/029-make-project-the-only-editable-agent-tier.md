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

- [ ] `EDITABLE_AGENT_SOURCES` is `["project"]`, and `setAgentDescription` refuses every other tier
      before touching the filesystem
- [ ] The `user`-tier refusal message describes a machine-wide agent in `~/.claude/agents/` and does
      not refer to a project it was created in
- [ ] The `maestro`/plugin refusal message explains that a plugin update overwrites the file
- [ ] The left pane renders two labelled sections, Project and Global, and every discovered agent
      appears in exactly one of them
- [ ] The card carries a tier tag consistent with the section the agent is listed under
- [ ] On a global agent, the description field is read-only while type, project tag, avatar, report
      and skills all still save
- [ ] "Fork into this project" on the card writes `.claude/agents/<name>.md` with the template's
      content byte-for-byte, and the agent moves from the Global section to the Project section on
      the next refresh
- [ ] A same-name fork shadows its template: the list shows one row, sourced from the project
- [ ] A renamed fork copies the template's avatar, type and project tag rows under the new name
- [ ] `/create-subagent` offers an installed agent as a template, and the option is unavailable when
      `target` is `marketplace`
- [ ] Every fork writes a sidecar record holding source tier, plugin, plugin version, template body
      hash and template body — and no fork writes anything into the agent's frontmatter beyond what
      the template already had
- [ ] `test/isolation.test.ts` still passes: nothing new crosses the core/main/preload/renderer split

## Notes for whoever picks this up

Hash the **body**, not the file. The description is expected to diverge — that is the entire point
of a fork — so a whole-file hash marks every fork as user-modified the moment its description is
edited, and `031`'s sync would then never fire for anybody. Normalise the `description:` line out
before hashing, and pin that with a test now rather than discovering it in `031`.

`030` rekeys three of the stores this ticket copies rows in. The two are independent, but forking is
what makes same-named agents across projects common, so landing `030` close behind is worth doing.

## Blocked by

_none_
