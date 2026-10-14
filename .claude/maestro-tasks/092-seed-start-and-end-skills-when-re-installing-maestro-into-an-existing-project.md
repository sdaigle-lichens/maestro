# Seed start and end skills when re-installing Maestro into an existing project

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Since the legacy `gates` fallback was removed, the start/end skill lists are read only from `start_skills` / `end_skills` in `maestro.json`, and a config without them resolves to empty lists. A fresh install seeds them, but re-installing (or updating) Maestro into a project that already has a `maestro.json` keeps the existing config untouched, so an upgraded project silently loses its Step 1 skills: `/maestro` and `/to-maestro-tasks` both say no start skills are configured, and `confidence-check` and the design check stop running. This repo hit exactly that after re-installing 0.11.9.

Make the install and update paths (both the desktop app's install and `/maestro-install` / `/maestro-update`) fill in whatever is missing: when the existing config has no `start_skills`, write the same defaults a fresh seed would (including the design check only when it resolves, in its plugin-qualified form); when it has no `end_skills`, write the empty default. A config that already has the lists is never touched, including an empty list the user chose. A leftover `gates` key is removed, since nothing reads it any more. Do not reintroduce a runtime fallback that reads `gates` — this is a one-time write at install/update time only. The install output says what it seeded and points to the app's `/maestro` page to change it, so the user is not surprised. The stale-references check run by `/maestro-update` also reports a config that lacks the lists, so a project upgraded by copying files alone is told to re-install.

## Acceptance criteria

- [ ] Re-installing or updating into a project whose maestro.json lacks start_skills writes the fresh-seed defaults, with the design check only when it resolves and in its plugin-qualified form
- [ ] A missing end_skills is written as the empty default
- [ ] A config that already has start_skills / end_skills is left byte-for-byte unchanged, including deliberately empty lists
- [ ] A leftover gates key is removed and no runtime code reads gates
- [ ] The install output names what was seeded and points to the /maestro page
- [ ] The /maestro-update stale-references step reports a config missing start_skills
- [ ] Both install paths (desktop app and plugin script) behave the same, covered by tests that run the real install against a temp project with a pre-existing config; mirrors and parity stay in sync and the maestro plugin version is bumped
- [ ] pnpm verify passes

## Blocked by

None — can start immediately
