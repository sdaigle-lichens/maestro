# Report r006: 111-end-to-end-check-of-code-graph-0-3-11-s-incremental-enrichment-through-maestro-s-scribe.md

- Task: 111-end-to-end-check-of-code-graph-0-3-11-s-incremental-enrichment-through-maestro-s-scribe.md
- Written: 2026-10-17T12:45:01.903Z
- From session: maestro-94

# Report: task 111 — code-graph 0.3.11 incremental enrichment, end to end

**Outcome: the incremental path and the gap channel work; the sources of two surprises are noted below. Nothing committed. No code under apps/ or plugins/ was changed by this task.**

## Preconditions
- Plugin cache lists 0.3.11 (and 0.3.9); ran with the 0.3.11 CLI. `skills check`: ok before and after.

## Inline path (agents-view)
- Run 1 failed to exercise it: the scribe's file-map row named `utils/avatar.ts` exports, which pushed `enrich targets --core` from 18 to 22 (over the 20 limit), so it enriched nothing and reported all 22. The user chose to redo it: SKILL.md and ast.json reverted (`git checkout`), the gap file kept.
- Run 2 (prose-only file-map row, core stayed 18, skill 1.13 -> 1.14): scribe enriched all 18 core vertices itself, no fan-out; `enrich merge` 18 vertices / 13 edge reasons, `apply` 18 updated; re-running `enrich targets --core` returned no targets. Targets: findAgentFile, describeUneditableSource, extractAgentBody, replaceBodyInFrontmatter, getAgentBody, setAgentContent (agent-descriptions.ts); openDb, isValidLayers (avatar-store.ts); ColorControl (agent-avatar-block.tsx, avatar-picker.tsx), SectionLabel, AgentSkill, AgentDraft, clampText, cycleOption, AvatarCanvas, handoffsOf, cloneDraft. leftOut 48, thin false.

## Left-to-enrich path (task-queue)
- Scribe edit: three missing tasks.ts exports added to a Files row (setTaskEpic, readTaskTracker, tailTasks), skill 1.5 -> 1.6. That edit grew the core from the measured 27 to **28**; above 20 so the scribe enriched none and reported all 28 as left to enrich (claims.ts 8, epics.ts 4, tasks.ts 15, maestro-tasks.tsx 1). leftOut 75, thin false.
- Main-session fan-out: 3 Haiku batches (10 / 10 / 8), `enrich merge` each (10v/25e, 10v/16e, 8v/46e = 28 vertices, 87 edges, all 87 with reasons), `apply`: 28 updated. No batch re-asked, no description dropped.
- Spot-check against code (6 read, all correct): writeStatusMap, buildStatusMap, isSessionLive, readClaims, updateState, listTaskFiles.
- Haiku-side deviations: batch 2 reported "9 vertices" but the merge took 10 (miscount, nothing missing); batch 3 used an `Edit` after its `Write` to fix a mistyped edge key, against the "single Write, no Edit" rule. The merge accepted the result.

## Gap channel
- Run 1's scribe ran `code-graph search "how an agent's description or avatar is edited"`; it did not route to agents-view (returned create-skills-architecture and installing-maestro; no agent-descriptions.ts, no avatar editor) and wrote `.claude/channels/scribe/scribe.1.md`.
- Stamped at SubagentStop: the file starts `<!-- maestro:run_id=71f16f75-30d2-426e-bac9-1fefe9777667 -->`.
- Inlined at the next scribe SubagentStart (run 2 quoted it verbatim): `From scribe (scribe.1.md): {"skill_gaps":[{"skill":"agents-view","missing":"Plain-text search for 'how an agent's description or avatar is edited' did not route to agents-view at all (it returned create-skills-architecture and installing-maestro). ..."}]}`. The channel dir was empty afterwards (the task-queue scribe saw nothing to inline), so the file was retired at that start.
- The gap itself was not acted on (no update-single run).

## Checks
- Edge reasons survive: a second `extract` + `apply` on both concepts left the enriched files and reasons intact (apply: 28 and 18 vertices updated, AST edges replaced, no drift).
- `.ast.json`: `git diff --stat scribe-output` shows agents-view +/-272 lines and task-queue +/-420, but a structural compare against HEAD shows 0 vertices and 0 edges added, removed or changed. The whole diff is 0.3.11 no longer writing `ast.extractor_version` (the committed snapshots say `code-graph@0.3.5`, now `"ast": {}`). So: no real code change, but a mechanical churn the committed snapshots will show whenever re-extracted.
- `gaps` is not a command in 0.3.11 (`unknown command 'gaps'`), so that criterion could not be checked as written. `skills check` is ok; coverage is evidenced by `enrich targets --core` returning no targets for agents-view and 28 enriched task-queue vertices.
- `code-graph search blockedBy` before: 20 vertices, "matched only through skill docs; enrich the concept...", ~3004 tokens, ranked epicDirFor, readEpicState, readClaimFile, readClaims, claimsDirFor, deleteTask, readStatusMap, tasksDirFor, tasksFromFiles, updateState, readFileSafe, nameOf, parseBlockedBy (13th), closeTask. After: 27 vertices, ~1821 tokens, no hint line, ranked tasksFromFiles, readTaskTracker, buildStatusMap, parseBlockedBy (4th), deleteTask, closeTask, readClaims, ...; enriched vertices carry their one-sentence purpose.

## code-graph-d1 observations
- (a) Code reading query output as --json: yes, seen in every scribe run (agents-view runs 1 and 2, task-queue): `node .../0.3.11/scripts/code-graph.cjs enrich targets <concept> --core --json`. This is `enrich targets`, not a `query`/`search` command, and the plain-text form omits each target's `edgesWithoutReason`, so enrichment needs the JSON. The task-queue scribe also noted the JSON output was too large to inline and did not tally core.size/thin from it. My own splitting script also parsed this JSON. No search output was read as JSON.
- (b) Plain-text search dropping needed edges: yes, in the poor search above (natural-language query, agents-view not matched at all, edges to agent-descriptions.ts and the avatar editor absent). Not seen for `search blockedBy`.

## Other findings
- Counts differ from the task's measurements because the scribe's own SKILL.md edit changes the core (18 -> 22 when it named exports, 27 -> 28 with three more). A "small true improvement" is not neutral to the core size.
- A scribe subagent ended `HANDOFF: done`, which the Documentation workflow has no route for (handoff-issues: NO ROUTE); the orchestrator stopped and asked.
- Unexpected modified files appeared during the run that this task did not touch: `.claude/maestro.json`, `plugins/maestro/.claude-plugin/plugin.json` (likely another session). Not part of this task's changes.
- The installed maestro plugin (0.11.23) is older than the project runtime (0.11.26).

## Files changed by this task (uncommitted)
- `.claude/skills/task-queue/SKILL.md` (1.5 -> 1.6, 3+/3-), `apps/maestro/.claude/skills/agents-view/SKILL.md` (1.13 -> 1.14, 3+/2-, a file-map row)
- `scribe-output/agents-view.ast.json` (272 lines, extractor_version only), `scribe-output/task-queue.ast.json` (420 lines, extractor_version only)
- new: `scribe-output/agents-view.enriched.json` (14,120 bytes), `scribe-output/task-queue.enriched.json` (34,879 bytes)
- The graph store was updated by extract/apply. `.claude/channels/scribe/scribe.1.md` was retired by the second scribe's start.

## Suggested ticket changes
- code-graph: stop writing/dropping `extractor_version` silently, or document that re-extract rewrites committed snapshots; make `--core` stable against a skill edit, or have the update flow say the core grew; add the `gaps` command the task refers to (or fix the task text).
- Manager to ask the user whether to commit the .enriched.json files and the stamped SKILL.md files.
