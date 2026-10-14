# Skill-lists slice

`MaestroSkillListsSlice` is `{ start_skills: { maestro: string[]; to_maestro_tasks: string[] }; end_skills: { maestro: string[] } }`
(`089`) — the ordered skills the orchestrator runs at **Step 1** (start), the ones `/to-maestro-tasks`
runs before it sizes work, and the ones the orchestrator runs at **Step 7** (end). It replaced the
`gates` slice and its two checkboxes (`032`); `sliceType` is `"skill-lists"`, the card is
`SkillListsCard`, the channels are `data:skill-lists` / `project:skill-lists:set`.

## `resolveSkillLists` is the only reader

`src/core/skill-lists.ts` takes `unknown`, never throws, and returns `{ maestroStart,
toMaestroTasksStart, maestroEnd }`. The same function runs in the app and (bundled as
`lib/maestro-skill-lists.cjs`) in the runtime scripts, so the two cannot disagree — unlike the old
`resolveGates`, which had a hand-duplicated twin in the script.

| Input                             | Result                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `start_skills` a plain object     | Authoritative. A missing key is an empty list.                                                                                              |
| no `start_skills`                 | All three start lists empty. The pre-`089` `gates` booleans are no longer read (`090`).                                                     |
| `end_skills.maestro`              | Read the same way; absent is empty.                                                                                                         |
| absent, corrupt, `version !== 3`  | Empty lists.                                                                                                                                |

List entries are kept only if they are non-empty strings with no internal whitespace (it would break
the scripts' one-line output); trimmed and de-duplicated in first-seen order.

## Saving

`mergeSlice`'s `skill-lists` arm writes `start_skills` and `end_skills`. There is no second
cross-slice write — a start/end skill implies nothing about
the project's agents. The read handler returns the _resolved_ lists (the empty lists when no
project is open, so the route stays renderable); the set handler re-resolves the renderer's lists
through `resolveSkillLists` before saving, the same don't-trust-the-renderer discipline as before.

## Readers in the runtime

`maestro-step1-gates.cjs` prints Step 1 (`--for to_maestro_tasks` selects that list instead) and
`maestro-end-skills.cjs` prints Step 7 — both exit 0, no stderr, one line. See `maestro-architecture`.

## The barrel rule bites here

`MaestroSkillListsSlice` is re-exported from `contracts.ts`, **not** from the `src/core/index.ts`
type barrel (keeps `fs` out of the renderer's type graph). The value `resolveSkillLists` **is** on
the barrel, because `src/main/` needs it.

Files: `src/core/skill-lists.ts`, `src/core/plugin-entries/maestro-skill-lists.ts`,
`src/core/types.ts`, `src/core/config.ts` (the `skill-lists` arm of `mergeSlice`),
`src/core/contracts.ts`, `src/core/seed.ts`, `src/shared/ipc.ts`, `src/main/ipc.ts`,
`src/renderer/src/routes/maestro.tsx` (`SkillListsCard`).
