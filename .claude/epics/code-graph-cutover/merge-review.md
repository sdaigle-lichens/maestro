# Review: did merging concept-skills into code-graph cost us quality?

**Short answer: mostly no, with one exception.** Reading the documentation through the graph got worse
in this project. The merge cost a small amount of always-on context and roughly doubled the scribe's
per-run load. In return it brought per-concept freshness, a gap channel with acknowledgement and
retention, and a single plugin to opt into. One design constraint is breached by measurement: code-graph
commits a 491 KB bundle, and it has 20 versions in history.

Comparison points used:

| | before | after |
|---|---|---|
| maestro | `62480e7^` = 1ae903d | `feat/use-code-graph` @ 8763af6 |
| code-graph | `main` @ 18a019d | `feat/integrate-concept-skills` @ 9b06f59 |
| installed | concept-skills 0.2.0 (+ old code-graph) | code-graph 0.3.15, maestro 0.12.2 |

Note: the brief's text for criterion 10 is truncated. It runs into "...code-graph's own agree), mirrors
that must be kept in sync, and how the tests cover the seams between the repos". I treated that as
criterion **11 (duplication, mirrors, seam tests)**. Criteria the brief did not name are 12–13.

Legend: **measured** = I ran it and the number is in Measurements. **inferred** = reasoned from code or
text, not executed.

---

## Summary table

| # | Criterion | Verdict | One-line evidence |
|---|---|---|---|
| 1 | Context saving (always-on) | **same** (slightly better vs two plugins, worse vs concept-skills alone) | Skill listing 4327 → 4111 B vs both old plugins; +1330 B vs concept-skills alone (measured) |
| 2 | Context cost of operating | **worse** | Scribe load 13273 → 25165 B (~3.3k → ~6.3k tok); `skills status --json` 32 KB; `search --json --max-tokens 400` returns 9038 B (measured) |
| 3 | Ease of use | **same** | Install 6 → 8 steps but covers what two plugins did; one new user-shell step (`deps install`); Maestro scribe wiring is still manual (measured from skills) |
| 4 | Flexibility to document as you go | **better** | Gap channel with run_id, 14-day retention and `SKILL_GAPS_HANDLED` ack; `skills check`/`status` added; docs-only projects work (measured) |
| 5 | Quality of docs generated | **same** (graph layer adds accurate detail where enriched) | Concept SKILL.md format unchanged, sizes within ±8 %; sampled enriched purposes match code; only 2/16 concepts enriched (measured) |
| 6 | Quality of docs read (search/eval) | **worse** | Own 8-task eval: **2/8** pass; 8 of 13 battery queries miss with exit 0; retrieval skill says "don't fall back to grep" (measured) |
| 7 | Freshness and drift | **better tooling, but one silent-wrong signal** | Per-concept git windows are new and work; graph "0 changed" after a source change with no re-extract (measured) |
| 8 | Degraded paths | **worse on one path** | No `node:sqlite` → `search` exit 1 with a raw module error, code not in the skill's table; absent deps dir reported "unreadable (not absent)" (measured) |
| 9 | Opt-in / opt-out / autonomy / bundles | **worse** | 491 047 B committed bundle, 20 blobs ≈ 9.6 MB raw / 2.3 MB deflated in history; uninstall leaves 5 kinds of artefacts; install suggestion has no command (measured) |
| 10 | Lost features | **same** (all drops recorded) | Every concept-skills skill and CLI command has a successor; `state-set` folded into `stamp`; `--root` kept on `skills`; old `/scribe-enrich`, `/code-graph-init`, `/add-concept` commands dropped on purpose (EPIC 007) (measured) |
| 11 | Duplication, mirrors, seam tests | **worse** (one-sided seam) | maestro pins the gap/skill-id seam in tests; code-graph has no test of the gap-file format it tells agents to write; legacy `.claude/concept-skills.json` still beside `scribe.config.json` (measured) |
| 12 | Publishing hygiene (added) | **worse** | `plugin/skills/CLAUDE.md` (developer rules) sits in the published plugin dir, added in 6ee80fe with no version bump (measured) |
| 13 | Gap channel without Maestro (added) | **worse** (inferred impact) | No code-graph code reads `.claude/channels/scribe/`; the retrieval skill still writes there (measured: grep; impact inferred) |

---

## Regressions, ranked by impact

### R1. Graph retrieval misses most un-enriched concepts and tells the agent not to fall back (criterion 6)

- **Evidence (measured):**
  - The 8-task eval run with code-graph's own `eval` against this project passes **2/8**. Failures:
    - av-description (rank 15)
    - afs-fork
    - ma-design-check
    - ma-gap-ack (`parseGapsHandled` exists as a vertex but is not found)
    - ma-handoff-route
    - im-install
  - Search battery: 8 of 13 plain-language queries miss. They return agents-view or task-queue noise
    **with exit 0**, so nothing tells the agent the answer is wrong.
  - Exact identifiers do work (`checkRoute` → correct, ~185 tok).
  - Only 2 of 16 concepts are enriched (task-queue 28/103 vertices, agents-view 18/66).
  - code-graph's own self-eval passes 7/7, so this failure is specific to this project.
- **Cause (inferred):** BM25 ranks the enriched purposes in the 2 enriched concepts above the
  un-enriched ones, so queries about the other 14 concepts get crowded out.
- **Why it matters:** `code-graph-retrieval` tells agents to treat results as authoritative and not to
  grep. With lazy enrichment as the default, most concepts stay un-enriched for a long time, so the
  confident wrong answer is the steady state. It is not a transitional one.
- **Owner:** code-graph.
- **Task:** *Keep search honest while most concepts are un-enriched.*
  - Acceptance:
    1. On this repo's 8-task eval (`/tmp/claude-1000/review/maestro-eval-tasks.json`), at least 6/8 pass
       with the current 2/16 enrichment.
    2. When the top cluster's score is below a threshold, or its concept is un-enriched, `search` says
       so in text and JSON (e.g. `low_confidence: true`) and exits with a documented non-zero code.
    3. `code-graph-retrieval` names grep or the SKILL.md as the fallback in that case.
    4. code-graph's self-eval stays at 7/7.

### R2. A committed 491 KB CLI bundle breaks the "no large committed bundles" constraint (criterion 9)

- **Evidence (measured):**
  - `plugin/scripts/code-graph.cjs` is 491 047 B and is tracked.
  - It has changed in 20 commits: 20 distinct blobs, 9 604 073 B raw, 2 323 895 B deflated.
  - The repo pack is 8.04 MiB, so this one file is a large share of it. The exact share inside the
    delta-compressed pack was not isolated.
  - Before: code-graph's plugin shipped only `plugin.json` plus markdown. The CLI was invoked as a bare
    `code-graph` (inferred: installed separately).
  - concept-skills' bundle was 15 266 B and existed in 1 version.
  - The EPIC records "bundled CLI is 471 KB" at 0.3.0 as a known decision. It does not weigh it against
    the constraint.
- **Owner:** code-graph.
- **Task:** *Stop the CLI bundle growing the repo on every release.*
  - Acceptance, either:
    - the bundle is built at publish or install time and is not tracked; or
    - the brief's constraint is explicitly amended, with the per-release cost recorded.

    Plus: a CI check fails if a tracked file under `plugin/` exceeds an agreed size.

### R3. Graph freshness reports "0 changed" after source edits (criterion 7)

- **Evidence (measured):**
  - Commit 204f013 changed `install.ts`, added `session-name.ts`, and changed `epics.ts`/`types.ts`.
    No extract was run.
  - The graph has `installRuntime` at line 683; the source has it at line 705.
  - `session-name.ts` has no vertices (`search` exit 6).
  - `drift installing-maestro` reports "unchanged 116".
  - `skills status` prints `graph: 0 changed, 0 stale` next to `1 commit(s), 1 file(s)`.
  - Cause: `freshness.ts` compares `.ast.json` against the store and never re-extracts, so it can only
    see drift that somebody has already extracted.
- **Mitigation:** the git window in the same `skills status` line does flag the change.
- **Owner:** code-graph.
- **Task:** *Make graph freshness detect unextracted source changes.*
  - Acceptance: after editing a file covered by a concept's globs, without running `extract`:
    - `skills status` and `drift` report that concept as changed (e.g. by comparing file mtime or hash
      with what the snapshot recorded);
    - a new file matching the globs counts as changed;
    - the test lives in code-graph's suite.

### R4. Operating cost: the scribe load doubled, and budgets leak (criterion 2)

- **Evidence (measured):**
  - Scribe agent body plus skill: 13 273 → 25 165 B (~3.3k → ~6.3k tokens) on every scribe run.
  - Enrichment sections alone are about 8 110 B. They are loaded even on runs that do not enrich.
  - `skills status --json` is 32 128 B (~8k tok).
  - `search "design check" --json --max-tokens 400` returns 9 038 B (~2.3k tok): 0 hits plus an
    unbudgeted `gaps` block that lists all 16 concepts twice.
  - `enrich targets … --summary` is fine: 6.5–9.8 KB vs 25–57 KB without it.
- **Owner:** code-graph.
- **Task:** *Keep the scribe's default load near its pre-merge size.*
  - Acceptance:
    1. The enrichment procedure moves into a reference file that the scribe reads only when it enriches.
       `code-graph:scribe` SKILL.md is ≤ 9 KB.
    2. `search --json --max-tokens N` output is ≤ ~4N bytes, `gaps` included.
    3. `skills status` gains a compact JSON form ≤ 8 KB for 16 concepts.

### R5. Missing `node:sqlite` fails with a raw error (criterion 8)

- **Evidence (measured)** with `node --no-experimental-sqlite`:
  - `skills status` degrades gracefully: it drops the graph column.
  - `search` exits 1 with "No such built-in module: node:sqlite". It gives no advice, and exit 1 is
    not in the retrieval skill's exit-code table.
  - Inside the sandbox, an absent deps dir is reported as "unreadable (not absent)" by `deps status`
    (`project-deps.ts` `probeDepsDir` treats ENOENT as unreadable).
  - Missing ts-morph: `extract` fails clearly and `search` still works. That is good.
- **Owner:** code-graph.
- **Task:** *Name the fix when the graph store can't open.*
  - Acceptance:
    - with no `node:sqlite`, every graph command exits with a documented code and a one-line message
      naming the required Node version;
    - the retrieval skill's table lists that code;
    - `deps status` says "absent" for ENOENT, inside or outside the sandbox.

### R6. Opt-out leaves artefacts, and opt-in has no command (criterion 9)

- **Evidence (measured):** `code-graph-uninstall` disables the plugin and optionally removes the
  `skills` block. It does not mention:
  - the `.gitignore` line added by install step 6;
  - the sandbox `allowRead` entry install step 7 offers to add to user settings;
  - `~/.cache/code-graph/deps`;
  - stamped gap files under `.claude/channels/scribe/`;
  - `scribe-output/`, `tsconfig.code-graph.json` and `concepts` in `scribe.config.json`. These are
    left on purpose, but the skill does not list them for the user.

  Separately: `installed_plugins.json` still lists `concept-skills@maestro` 0.2.0 at user and project
  scope, and the cache keeps concept-skills 0.1.0/0.1.1/0.2.0. That is a migration leftover; nothing
  removes the old plugin.

  On the opt-in side, maestro's `skill-availability.ts` used to say
  `claude plugin install concept-skills@maestro`. It now says "Install it from the code-graph
  marketplace and enable it" and gives no command or marketplace source.
- **Owner:** code-graph (uninstall); maestro (suggestion text and concept-skills retirement).
- **Tasks:**
  - *code-graph: make uninstall list or undo everything install added.* Acceptance: the uninstall skill
    names each install-added artefact (gitignore line, allowRead entry, deps cache, gap files) and
    offers to remove each. It states which files it keeps on purpose.
  - *maestro: give a concrete install command for code-graph, and retire concept-skills.* Acceptance:
    the suggestion includes the exact `claude plugin marketplace add …` and `claude plugin install …`
    lines, and a test pins them. The maestro marketplace update or install flow offers to uninstall
    `concept-skills@maestro` when it finds it.

### R7. The gap contract is tested only on maestro's side (criteria 11, 13)

- **Evidence (measured):**
  - maestro tests pin its gap parser and acknowledgement: `handoff-channels.test.ts`,
    `scribe-gap-retention.test.ts` and `code-graph-plugin.test.ts`, which also asserts that no plugin
    name is left in maestro.
  - In code-graph, `skill_gaps` / `SKILL_GAPS_HANDLED` appear only in markdown: the retrieval and
    scribe SKILL.md files and `plugin/skills/CLAUDE.md`. No code-graph test checks the format it tells
    agents to write.
  - `hasGapBlock` in maestro accepts both `skill_gaps` and the legacy `concept_skill_gaps`.
  - No code-graph code reads `.claude/channels/scribe/`.
  - The scribe skill says gaps "arrive inlined… the next time you're invoked", which is maestro
    behaviour.
- **Impact (inferred):**
  - A wording change in code-graph's skill can silently break maestro's parser, and only maestro's
    tests would notice, and only if someone updates the fixture.
  - In a project without maestro, gap files are written and never read.
- **Owner:** code-graph (contract and non-maestro behaviour); maestro (fixture provenance).
- **Task:** *Give the gap-file format a single tested owner.*
  - Acceptance:
    1. code-graph ships a small fixture or schema for the gap block, and a test asserts the SKILL.md
       example matches it.
    2. maestro's test reads that same fixture from the installed plugin, or a pinned copy with a
       parity check.
    3. Without maestro, the scribe skill says where gaps go (e.g. the scribe reads the channel
       directly at start) instead of promising inline delivery.

### R8. A developer rules file ships in the published plugin (criterion 12)

- **Evidence (measured):** the repo's `plugin/skills/CLAUDE.md` is not in the installed 0.3.15 cache.
  Otherwise the cache and the repo `plugin/` are identical. The file was added in 6ee80fe with no
  version bump. It is developer guidance under the published dir; this repo's own publishing rule
  forbids that for maestro, and the equivalent applies to code-graph (inferred).
- **Owner:** code-graph.
- **Task:** *Move developer rules out of `plugin/`.* Acceptance: no `CLAUDE.md` or `.claude/` under
  `plugin/`; the guidance lives in the repo's own `.claude/`; a check fails if one reappears.

### R9. Minor: stale wording and a stale state record

- `code-graph-retrieval` still says a whole-concept re-enrich "spins up the enrichment subagent". That
  contradicts the rule that a subagent cannot spawn agents (measured: text). **Owner:** code-graph.
  **Task:** *Fix the retrieval skill's enrichment hand-off wording.* Acceptance: the skill says to
  report the need via the gap channel or hand off to the scribe.
- log-view and plugin-libs-parity are still stamped @9a92b6c6, although the EPIC records a re-stamp.
  The repo-level list is v1.29 @4d162ea with 37 commits since (measured). **Owner:** maestro (content).
  **Task:** *Re-stamp concepts the EPIC says were re-stamped.* Acceptance: `skills status` shows those
  two at a commit after the EPIC entry.

---

## Improvements

- **Per-concept freshness** (criterion 7, measured): `skills status` gives each concept its own git
  window from its globs, plus a graph column. Before, there was one manual `git diff` from
  `last-update`, with no per-concept scoping.
- **New `skills check` and `skills status`** (criterion 4, measured). Every old command still exists.
- **Gap channel is robust** (criterion 4, measured from code and tests):
  - SubagentStop stamps a run_id;
  - SubagentStart inlines the gap to every scribe until the scribe acknowledges it with
    `SKILL_GAPS_HANDLED:`;
  - unacknowledged gaps expire after 14 days;
  - on resume the hook lists files instead of re-inlining them.

  Before, the gap section was 535 B of prose with no retention or acknowledgement.
- **Docs-only projects work** (criterion 8, measured in a scratch non-TS repo): `skills
  state/list/stamp/check/status` all run. Only the graph commands exit 6.
- **One plugin to opt into** (criteria 1 and 9, measured): the listing is 4 111 B vs 4 327 B for the
  two old plugins together. maestro only soft-references code-graph, through one candidate id and
  suggestion prose. `code-graph-plugin.test.ts` pins that no plugin name creeps back into maestro, so
  maestro stays autonomous.
- **Enriched docs are accurate where they exist** (criterion 5, measured on a sample):
  - `buildStatusMap`'s purpose correctly states done / ready-if-every-blocker-done-or-absent / blocked
    and the kept epic link;
  - `claimPathFor` uses the basename only;
  - `readClaim` requires `session_id` and `claimed_at`.

  Enriched records also carry `sig_seen`, which lets drift catch a signature change.
- **The CRLF stamp bug was fixed in the port** (EPIC, not re-tested).
- **Install migrates the legacy state file** (step 2). `scribe.config.json` holds the `skills` block,
  and the legacy file is kept on purpose.

---

## Open questions

1. **Deps cache size.** The guardrail hook rejected `du -sh ~/.cache/code-graph` even though the sandbox
   allows reading it, so the opt-out footprint of the ts-morph install is unmeasured. To measure it, run
   `! du -sh ~/.cache/code-graph`.
2. **Old-Node behaviour.** The hook blocked listing `~/.nvm/versions/node`. I simulated a missing
   `node:sqlite` with `--no-experimental-sqlite` and did not run a real old Node. Behaviour on Node < 22
   may differ, e.g. a syntax error before the module error.
3. **Is lazy enrichment the intended steady state?** If yes, R1 is structural. If a project is expected
   to enrich "core" for every concept early, R1 shrinks. Which does the design intend?
4. **Should `search` be byte-read-only?** It changes `graph.db`'s bytes (sha changed) although every
   table row is identical (`dbdiff.mjs`). This is probably SQLite WAL or checkpoint activity (inferred).
   It is harmless, but it dirties the file if `graph.db` is ever tracked or hashed.
5. **Bundle constraint.** Is the 491 KB committed CLI an accepted exception (EPIC 0.3.0 note) or a
   breach? R2 assumes the brief's constraint wins.
6. **Agent notes.** 0 agent notes exist both before and after, although 6 agents are listed. Is the
   agent-notes feature used anywhere? If not, it is surface with no consumer, in both versions.
7. **Old code-graph CLI delivery.** Before, the skills called a bare `code-graph`. I did not confirm how
   users got that binary, so the "before" bundle size of 0 is a lower bound.

---

## Measurements

Scratch scripts are in `/tmp/claude-1000/review/`. Commands were run from the stated cwd. "~tok" is
bytes/4.

### Always-on listing (criterion 1)

`node /tmp/claude-1000/review/fm.mjs <plugin>/skills`: frontmatter `name`+`description` bytes per skill.
Skills with `disable-model-invocation` are excluded from the totals.

| Plugin set | Listing bytes | ~tok |
|---|---|---|
| before: concept-skills | 2 781 | 695 |
| before: old code-graph | 1 546 | 387 |
| before: both | 4 327 | 1 082 |
| after: code-graph 0.3.15 | 4 111 | 1 028 |

Largest after: scribe 545, update-concept-skills 487, create 474, update-single 434, retrieval 431,
code-architecture-design 390.

### Per-run loads (criterion 2), `wc -c`

| Item | Before | After |
|---|---|---|
| scribe skill | concept-skills:scribe 6 331 (+ old scribe-code-graph 4 052, separate) | code-graph:scribe 16 666 |
| maestro scribe.md template | 6 942 | 8 499 |
| project scribe.md | 6 966 | 8 523 |
| scribe total (body + skill) | 13 273 | 25 165 |
| enrichment sections in scribe | — | ~8 110 |
| gap section | 535 | 1 583 |
| update-concept-skills | 7 802 | 9 949 |
| update-single-concept-skill | 5 858 | 8 093 |
| create-concept-skills | 9 859 | 8 838 |
| SubagentStart addition when a stamped gap exists | — | 409 (ack) + 119 (header) + gap bodies |

### CLI output sizes (criterion 2)

`node /tmp/claude-1000/review/sizes.mjs /tmp/claude-1000/maestro-after <code-graph.cjs> '<args>'…`

| Command | Bytes | Notes |
|---|---|---|
| `enrich targets maestro-architecture --summary --json` | 6 527 | 33 targets, core 23 |
| same, no `--summary` | 24 953 | |
| `enrich targets claude-session-bridge --summary --json` | 9 753 | |
| same, no `--summary` | 56 942 | |
| `enrich targets task-queue --summary --json` | 167 | |
| `skills status --json` | 32 128 | |
| `skills list --json` | 3 539 | |
| `query concept maestro-architecture` | 12 270 | |
| `search "design check" --json` | 10 874 | |
| `search "design check" --json --max-tokens 400` | 9 038 | 0 hits; `gaps` lists 16 concepts twice |

### Concept skill sizes (criterion 5), `node concept-sizes.mjs`

| Concept | SKILL.md before / after | Dir total before / after |
|---|---|---|
| maestro-architecture | 21 122 / 22 301 | 92 351 / 99 471 |
| task-queue | 8 704 / 8 637 | 32 290 / 33 107 |
| agents-view | 23 881 / 24 134 | 42 807 / 43 060 |

Graph store (`scribe-output/graph.db`): 1 489 vertices, 3 541 edges, 16 concepts. Enriched: task-queue
28/103 and agents-view 18/66. The other 14 concepts have none.

### Retrieval (criterion 6)

- Battery: `node /tmp/claude-1000/review/queries.mjs` in `/tmp/claude-1000/maestro-after`.

  | Query | Result |
  |---|---|
  | blockedBy cascade | `parseBlockedBy` rank 2 (~1 855 tok) |
  | task becomes ready | rank 1 |
  | claim a task | rank 3 |
  | parseBlockedBy | rank 1 |
  | agent's description is edited | `setAgentDescription` rank 11 |
  | checkRoute (identifier) | correct, ~185 tok |
  | fork, design check, plugin libs parity, SubagentStart gap delivery, SKILL_GAPS_HANDLED, HANDOFF route check, session name, install runtime | miss, exit 0 |

- Eval: `node <code-graph.cjs> eval --tasks /tmp/claude-1000/review/maestro-eval-tasks.json` (cwd
  `/tmp/claude-1000/maestro-after`) gave **2/8**. Output:
  `/tmp/claude-1000/maestro-after/eval/results-2026-10-21T01-41-50-181Z.json` (deleted with the
  worktree; the numbers are recorded here). code-graph's own latest self-eval result: 7/7.
- Search side effect: `node /tmp/claude-1000/review/dbdiff.mjs <db before> <db after>` reported every
  table `same`, while the file sha changed.

### Freshness (criterion 7)

- `git -C /home/superadmin/gits/maestro show --stat 204f013` lists `install.ts`, `session-name.ts`
  (new), `epics.ts` and `types.ts`.
- `query`: `installRuntime` at line 683 in the graph; `grep -n 'export function installRuntime'` puts it
  at 705.
- `search session-name`: exit 6.
- `drift installing-maestro`: unchanged 116.
- `skills status`: `graph: 0 changed, 0 stale` beside `1 commit(s), 1 file(s)`.
- Other stale concepts: maestro-architecture 3, log-view 4, maestro-config-model 1. The list is v1.29
  @4d162ea, 37 commits behind.

### Degraded paths (criterion 8)

`node /tmp/claude-1000/review/seq.mjs <cwd> <cli> …`:

| Condition | How it was run | Result |
|---|---|---|
| no `node:sqlite` | `node --no-experimental-sqlite <cli> search …` | exit 1, "No such built-in module: node:sqlite" |
| no `node:sqlite` | same flag, `skills status` | works, graph column omitted |
| no ts-morph | `extract` | clear failure message |
| no ts-morph | `search` | works |
| absent deps dir, in sandbox | `deps status` | "unreadable (not absent)" |
| non-TS project, no config (`/tmp/claude-1000/docsproj`) | `skills state/list/stamp/check/status` | all work |
| same project | `search` | exit 6 |

### Bundles and opt-out (criterion 9)

- `git -C …/code-graph ls-files -s plugin/scripts/code-graph.cjs`: tracked, blob ef60596.
- `wc -c`: 491 047 B.
- `node /tmp/claude-1000/review/blobhist.mjs /home/superadmin/gits/code-graph plugin/scripts/code-graph.cjs`:
  commits=20, blobs=20, raw=9 604 073, zlib=2 323 895.
- `git count-objects -vH`: size-pack 8.04 MiB.
- Same script, concept-skills lib in maestro: 1 blob, 15 266 raw, 4 363 zlib.
- Old code-graph plugin (`find /tmp/claude-1000/cg-before/plugin -type f -not -name '*.md'`): only
  `plugin.json` (262 B).
- Plugin caches: maestro 10 old versions; code-graph 0.3.9, 0.3.11, 0.3.14, 0.3.15; concept-skills
  0.1.0, 0.1.1, 0.2.0. `installed_plugins.json` still lists `concept-skills@maestro` 0.2.0 (user and
  project scope).
- Project `enabledPlugins`: `code-graph@code-graph` only.

### Ease of use (criterion 3)

`grep -n -E '^[0-9]+\. '` and `wc -c` on the install/update/uninstall skills:

| Skill | Steps before / after | Bytes before / after |
|---|---|---|
| install | 6 / 8 | 3 186 / 6 416 |
| update | — | 2 058 / 2 383 |
| uninstall | — | 2 119 / 2 467 |

The two new install steps are the gitignore line and `deps install`. `deps install` needs the user's
own shell (`! code-graph deps install`). The Maestro scribe wiring is still a manual step in the desktop
app, both before and after. Restart or `/reload-plugins` is the same in both.

### Lost features (criterion 10)

- Skills: all 12 concept-skills skills have a code-graph successor with the same name, except the
  install/update/uninstall trio, which are renamed `code-graph-*`. The old code-graph skills
  `scribe-code-graph`, `code-graph-init` and `code-graph-retrieval` were folded into `scribe`, `install`
  and `code-graph-retrieval`.
- Commands: `/scribe-enrich`, `/code-graph-init` and `/add-concept` were dropped (EPIC task 007, on
  purpose; the add-concept skill stays). `/graph` is kept.
- CLI: old `list, state, agents, agents-discover, agents-set, stamp, state-set`. New: all of those, with
  `state-set` folded into `stamp`, plus `check` and `status`.
- `--root`: kept on every `skills` command (`commands.ts:53`; fallback `$CLAUDE_PROJECT_DIR` → nearest
  `scribe.config.json` → cwd). Graph commands use cwd (`config.ts:30`), the same as old code-graph.
- The concept-skills-system developer skill was deleted from maestro. That was expected.

### Seams (criterion 11)

- `grep -rln -E 'skill_gaps|SKILL_GAPS_HANDLED'`:
  - code-graph: 3 markdown files, 0 code or test files;
  - maestro: 9 test files and 6 src files.
- `code-graph-plugin.test.ts` pins:
  - the seed with the plugin enabled and not enabled;
  - `code-graph:` ids passing through the real SubagentStart hook, in both the project copy and the
    plugin copy;
  - "no plugin name left in maestro".
- The mirrors `plugins/maestro/scripts/lib` ↔ `.claude/scripts/lib` are checked by `parity.test.ts`.
  That is unchanged by the merge.
- `.claude/concept-skills.json` (v1.29) and the `scribe.config.json` `skills` block (v1.29) both exist.
  They agree today; nothing checks that they keep agreeing (inferred risk, low, since the legacy file
  is read only for migration).
