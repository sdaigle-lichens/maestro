# Report r006: 092-seed-start-and-end-skills-when-re-installing-maestro-into-an-existing-project.md

- Task: 092-seed-start-and-end-skills-when-re-installing-maestro-into-an-existing-project.md
- Written: 2026-10-13T16:03:35.657Z
- From session: main

Outcome: task 092 done. Both installers seed missing start_skills/end_skills and drop gates; pnpm verify green (1863 passed).
Findings: installRuntime still overwrites a corrupt/non-v3 maestro.json with a blank config; maestro-install.js crashes on corrupt JSON (both pre-existing).
Suggested tickets: fix both corrupt-config behaviours; test the ReportCard/describeRuntimeRefresh rendering.
