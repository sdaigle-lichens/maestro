# Never overwrite or crash on a corrupt or unsupported maestro.json during install

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Installing Maestro into a project whose existing `.claude/maestro.json` can't be used behaves badly on both install paths. The desktop app's install treats a file that is not valid JSON, or not a version-3 config, as if there were none and writes a blank config over it, silently throwing away the user's workflows, instances and skill lists. The plugin's `/maestro-install` script crashes with an unhandled parse error instead. Both were found while doing task 092 and predate it.

Make both install paths refuse, leaving the file byte-for-byte untouched: an unparseable file and a parseable file with a missing or unsupported `version` each produce a clear message naming the file and the problem (the parse error's position, or the version it found) and what to do (fix it by hand, or move it aside to start fresh). Nothing else the install would write is written either, so a refused install leaves the project exactly as it was. A missing `maestro.json` still installs normally, and a valid version-3 config keeps the 092 behaviour (missing skill lists seeded, `gates` dropped). The two paths must agree on what counts as unusable and on the outcome. In the app, the refusal is shown in the install result card, which today has no rendering tests: add tests for that card's rendering (the existing runtime-refresh description included) alongside the new refusal state.

## Acceptance criteria

- [ ] With an unparseable maestro.json, both the app install and /maestro-install refuse, leave the file byte-for-byte unchanged and write nothing else, and say which file is broken and where
- [ ] With a parseable maestro.json whose version is missing or not 3, both refuse the same way and name the version found
- [ ] The plugin install script never exits with an unhandled exception for these cases
- [ ] A missing maestro.json still installs a fresh config, and a valid v3 config keeps the 092 seeding behaviour
- [ ] The app's install result card shows the refusal, and its rendering (including the runtime-refresh description) is covered by tests
- [ ] Both install paths are covered by tests against temp projects; mirrors and parity stay in sync, and the maestro plugin version is bumped
- [ ] pnpm verify passes

## Blocked by

None — can start immediately
