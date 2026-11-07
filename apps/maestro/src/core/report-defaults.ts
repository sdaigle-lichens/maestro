// Report defaults: the GLOBAL (per machine, every project) fallback tier for a per-agent
// "Mandatory Output Format" report, backed by `node:sqlite` — mirrors skill-tags.ts's
// ~/.claude/maestro-skill-tags.sqlite in mechanism (see that file's header for why `node:sqlite`
// over another JSON blob or a native module), but global for a DIFFERENT reason: a skill tag is
// global because "a skill is the same skill everywhere"; a report default is global because it's
// the fallback tier a project falls back to when it has no opinion of its own, and it's what
// install/update syncs a project's `.claude/reports/*.md` FROM.
//
// Two tables, exactly as specified: `agent_reports` (agent_name -> report_id) and `reports`
// (report_id -> content + version). The indirection through `report_id` — rather than keying
// content directly by agent name — is what lets a future global-editing UI point two agents at
// one shared report id without a schema change; nothing in this slice creates that sharing itself
// (the migration below seeds one row per agent, deliberately not collapsing the near-identical
// backend/frontend/mobile/infra shapes into one id — see the migration task's header for why).
//
// SEEDED ON FIRST READ, not by a one-off script: `reports` starts empty on a fresh machine, and
// every read function seeds it (backend/frontend/mobile/infra/scribe/test, version 1) the first
// time the table is empty. This is what makes a fresh install of the plugin — with no maintainer
// having run a migration script — still see the same six defaults the bundled agent files used
// to carry inline, before their `## Mandatory Output Format` sections were stripped out.
//
// The `/templates` page's Reports tab is the UI that writes here — `writeAgentReportDefault`
// below. Every write it makes is one agent -> one report, keyed by the agent's own name; it never
// creates the id-sharing indirection the schema allows for (see the header note above).
//
// DELIBERATELY NOT REKEYED BY (project_root, agent_name) — unlike agent-types.ts,
// agent-project-tags.ts and avatar-store.ts (030). Those three are Maestro's own metadata about an
// agent INSTANCE and the "same everywhere" assumption is genuinely false for a project-tier one.
// This store is a different kind of thing: it is already the GLOBAL FALLBACK TIER by definition —
// "what a reviewer outputs by default on this machine" — and every project already has its own
// override at `.claude/reports/<name>.md`, resolved project → global → none by `resolveReport`.
// Rekeying `agent_reports`/`reports` by project would collapse that two-tier design into one tier
// with two names for the same thing. `030` leaves this file alone on purpose.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ReportDefault } from "./contracts.js";

export type { ReportDefault };

/** `~/.claude/maestro-report-defaults.sqlite` — one store, every project on this machine. */
export const DEFAULT_REPORT_DEFAULTS_DB_PATH = path.join(os.homedir(), ".claude", "maestro-report-defaults.sqlite");

// `090`: the gap note is generic. Maestro names no particular kind of skill — any skill an agent
// loaded can have been missing something — and the scribe channel it lands on is read by whatever
// the project has wired to handle it (the code-graph plugin's scribe skill, for one).
// The previous, concept-skill-specific text lives on below as `conceptGapsChannelNote`, kept
// verbatim because the superseded bodies in `PRIOR_SEEDS` are rebuilt from it.
function skillGapsChannelNoteUnscoped(subagent: string): string {
  return (
    "If a skill you loaded was missing something you had to work out from the code " +
    `yourself, write \`.claude/channels/scribe/${subagent}.1.md\` with a fenced \`json\` block: ` +
    '`{ "skill_gaps": [{ "skill": "<skill-id>", "missing": "<what it did not tell you>" }] }`. ' +
    "Leave it unwritten when nothing was missing — do not write a gap just to fill the file."
  );
}

// `144`: channel lanes are scoped per task/session — `.claude/channels/<scope>/<receiver>/` — so a
// gap note naming the unscoped path would land in the legacy layout, which is never delivered. The
// agent never works out its scope: SubagentStart names it (`channelScopeLine`), and the note points
// there. The unscoped wording above is kept for the prior seeds.
function skillGapsChannelNote(subagent: string): string {
  return (
    "If a skill you loaded was missing something you had to work out from the code " +
    `yourself, write \`.claude/channels/<scope>/scribe/${subagent}.1.md\` (\`<scope>\` is the channel scope ` +
    "named in your injected context) with a fenced `json` block: " +
    '`{ "skill_gaps": [{ "skill": "<skill-id>", "missing": "<what it did not tell you>" }] }`. ' +
    "Leave it unwritten when nothing was missing — do not write a gap just to fill the file."
  );
}

// `036`: a concept-skill gap no longer travels as a `conceptSkillGaps` field in the JSON report —
// it goes on the scribe's own channel, unconditionally, whether or not this run's workflow wires a
// route to `@scribe` at all. That is what makes a gap reachable even from an agent with no scribe
// edge: `SubagentStart` delivers whatever is waiting in the scribe lane (since `144`,
// `.claude/channels/<scope>/scribe/`) the next time `@scribe` is invoked in the same scope. `filesChanged` is dropped outright rather than
// moved — `grep` found it had zero consumers, and the files-changed information a *receiving*
// agent actually needs already travels per-route, inside the `handoff-seeds.ts` shapes that most
// routes already carry as `files_added_removed_renamed`.
function conceptGapsChannelNote(subagent: string): string {
  return (
    "If a concept skill you loaded was missing something you had to work out from the code " +
    `yourself, write \`.claude/channels/scribe/${subagent}.1.md\` with a fenced \`json\` block: ` +
    '`{ "concept_skill_gaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell you>" }] }`. ' +
    "Leave it unwritten when nothing was missing — do not write a gap just to fill the file."
  );
}

// `083`: the report's verdict and the terminal HANDOFF line must agree. Appended to the reports
// that carry a verdict (everything but scribe); the previous bodies are the V3 prior seeds below.
const VERDICT_HANDOFF_NOTE =
  'Your `"verdict"` and your final `HANDOFF:` line must agree. A real defect must end with the matching ' +
  "condition-edge label when the workflow has one. A verdict of FAIL with `HANDOFF: success` is invalid, " +
  "and so is ending with no `HANDOFF:` line — the orchestrator is told about both and never treats either as success.";

function backendLikeReport(subagent: string): string {
  return backendLikeBody(subagent, skillGapsChannelNote(subagent)) + "\n\n" + VERDICT_HANDOFF_NOTE;
}

// The body before `083` added the verdict/HANDOFF note.
function backendLikeV3(subagent: string): string {
  return backendLikeBody(subagent, conceptGapsChannelNote(subagent));
}

// The body before `090` made the gap note generic: V3 plus the verdict/HANDOFF note.
function backendLikeV4(subagent: string): string {
  return backendLikeV3(subagent) + "\n\n" + VERDICT_HANDOFF_NOTE;
}

// The body before `144` scoped the gap note's channel path.
function backendLikeV5(subagent: string): string {
  return backendLikeBody(subagent, skillGapsChannelNoteUnscoped(subagent)) + "\n\n" + VERDICT_HANDOFF_NOTE;
}

// The body before `148` gave the backend report its `testTargets` section.
function backendLikeV6(subagent: string): string {
  return backendLikeReport(subagent);
}

// `148`: the backend report feeds the backend -> test handoff, so it names what the tests must
// cover and which checks already ran. Project-neutral: no command is named, the agent copies the
// ones it actually ran.
const BACKEND_TEST_TARGETS_NOTE =
  "## Test targets (mandatory)\n" +
  "\n" +
  "The report feeds the backend -> test handoff, so the `testTargets` section is required, never omitted. " +
  "For each behavior you changed, name the failure mode to test (empty or closed input, missing file, stale generated copy, edge input) " +
  "and the files the tests must touch. List every pre-handoff check you ran, copied verbatim with its result, " +
  "and mark one `n/a` only when it does not apply to your change. You must run the project's own " +
  "static check yourself before handing off; do not leave it to the test agent.";

// The body before `155` moved the test targets off the report into the test-hints channel file.
function backendReportV7(): string {
  return (
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    '  "subagent": "backend",\n' +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "description": "<summary of what was implemented>",\n' +
    '  "testTargets": {\n' +
    '    "behaviors": [\n' +
    "      {\n" +
    '        "behavior": "<behavior you changed>",\n' +
    '        "failureModes": ["<empty/closed input | missing file | stale generated copy | edge input | ...>"],\n' +
    '        "files": ["<files the tests must touch>"]\n' +
    "      }\n" +
    "    ],\n" +
    '    "preHandoffChecks": [\n' +
    '      { "command": "<exact command run>", "result": "pass | fail | n/a" }\n' +
    "    ]\n" +
    "  }\n" +
    "}\n" +
    "```\n" +
    "\n" +
    BACKEND_TEST_TARGETS_NOTE +
    "\n\n" +
    skillGapsChannelNote("backend") +
    "\n\n" +
    VERDICT_HANDOFF_NOTE
  );
}

// `155`: the orchestrator never forwards a report, so `testTargets` never reached @test. Test hints
// have one home now, the `backend/test` channel file the SubagentStart hook names (a direct route, or
// `testHintRoutes` for a later @test step), and the report only records where they went.
const BACKEND_TEST_HINTS_NOTE =
  "## Test hints\n" +
  "\n" +
  "Test hints never go in this report. When your injected context names a channel file for `test` (a direct " +
  "route, or test hints because @test runs later in this workflow), write your hints there in the shape it gives " +
  "and name that path in `testHints`; otherwise `testHints` is `none: no later @test step`. They are hints, not " +
  "@test's scope: do not try to list everything @test should cover, and do list in `notHandled` every case you " +
  "deliberately left open.\n" +
  "\n" +
  "List every pre-handoff check you ran in `preHandoffChecks`, copied verbatim with its result, and mark one `n/a` " +
  "only when it does not apply to your change. Run the project's own static check yourself before handing off, " +
  "through the project's own recipe or script rather than the raw tool under it; do not leave it to the test agent.";

function backendReport(): string {
  return (
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    '  "subagent": "backend",\n' +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "description": "<summary of what was implemented>",\n' +
    '  "preHandoffChecks": [{ "command": "<exact command run>", "result": "pass | fail | n/a" }],\n' +
    '  "testHints": "<channel file you wrote your test hints to, or \'none: no later @test step\'>"\n' +
    "}\n" +
    "```\n" +
    "\n" +
    BACKEND_TEST_HINTS_NOTE +
    "\n\n" +
    skillGapsChannelNote("backend") +
    "\n\n" +
    VERDICT_HANDOFF_NOTE
  );
}

function backendLikeBody(subagent: string, gapsNote: string): string {
  return (
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    `  "subagent": "${subagent}",\n` +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "description": "<summary of what was implemented>"\n' +
    "}\n" +
    "```\n" +
    "\n" +
    gapsNote
  );
}

// The body before `090` dropped `conceptSkillsUpdated`.
const SCRIBE_REPORT_V2 =
  "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
  "\n" +
  "```json\n" +
  "{\n" +
  '  "subagent": "scribe",\n' +
  '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
  '  "agentsMdUpdated": 0,\n' +
  '  "docsUpdated": 0,\n' +
  '  "claudeFilesUpdated": 0,\n' +
  '  "conceptSkillsUpdated": 0,\n' +
  '  "changelogUpdated": false,\n' +
  '  "description": "<summary of what was updated>"\n' +
  "}\n" +
  "```\n" +
  "\n" +
  '"Claude files" covers any file under `.claude/agents/`, `.claude/rules/`, or `.claude/skills/`. ' +
  "Use the counts to keep the handoff message small — do not list individual file names unless the caller asks.\n" +
  "\n" +
  "`conceptSkillsUpdated` counts concept skills you created or revised — it is a subset of " +
  "`claudeFilesUpdated`, broken out because the caller usually wants to know whether the concept " +
  "list moved without reading the whole summary.";

// `090`: Maestro no longer knows about concept skills, so the scribe's report does not count them
// separately — they are part of `claudeFilesUpdated` like any other `.claude/skills` file. This is
// character-for-character the pre-concept-skill (V1) body, and it was the current body until `114`
// appended `SCRIBE_ENDING_NOTE` below.
const SCRIBE_REPORT_V1 =
  "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
  "\n" +
  "```json\n" +
  "{\n" +
  '  "subagent": "scribe",\n' +
  '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
  '  "agentsMdUpdated": 0,\n' +
  '  "docsUpdated": 0,\n' +
  '  "claudeFilesUpdated": 0,\n' +
  '  "changelogUpdated": false,\n' +
  '  "description": "<summary of what was updated>"\n' +
  "}\n" +
  "```\n" +
  "\n" +
  '"Claude files" covers any file under `.claude/agents/`, `.claude/rules/`, or `.claude/skills/`. ' +
  "Use the counts to keep the handoff message small — do not list individual file names unless the caller asks.";

// `114`: the scribe carries no verdict, so `VERDICT_HANDOFF_NOTE` never reached it, and a finished
// scribe ended `HANDOFF: done` — a label no workflow routes, so the orchestrator stopped and asked.
// `112`'s acknowledgement line lived only in the SubagentStart block, which a RESUMED scribe never
// gets. Both rules travel here (and in plugins/maestro/agents/scribe.md), in the order
// `parseGapsHandled` and `lastHandoffLabel` read them: the gap line first, the HANDOFF line last.
function scribeEndingNote(gapsDir: string): string {
  return (
    "End your final message with these plain-text lines, in this order:\n" +
    "\n" +
    "1. `SKILL_GAPS_HANDLED: <file>, <file>, …` — only when you acted on skill-gap reports from " +
    `\`${gapsDir}\`. Name every gap file you acted on, including one handled by enrichment only, ` +
    "one with a remainder left to enrich, and one with no graph to enrich. A gap file you do not " +
    "name stays in your channel for the next scribe run.\n" +
    "2. `HANDOFF: <label>` — always last. `HANDOFF: success` when the documentation is done, even if you " +
    "skipped a step (a graph refresh skipped for lack of a tsconfig, targets left to enrich): report skipped " +
    "steps in the report body, never through the label. `done` or `complete` is not a label — no workflow " +
    "routes it. When you could not finish, end with a condition label from your injected routes when one fits, " +
    "else `HANDOFF: partial` with the reason in the body: the orchestrator's unrouted check stops there and asks the user."
  );
}

// The body before `144` scoped the scribe lane's path.
const SCRIBE_REPORT_V3 = SCRIBE_REPORT_V1 + "\n\n" + scribeEndingNote(".claude/channels/scribe/");

// The body before `148` made the scribe report list per-file evidence.
const SCRIBE_REPORT_V4 = SCRIBE_REPORT_V1 + "\n\n" + scribeEndingNote(".claude/channels/<scope>/scribe/");

// `148`: a count tells the reader nothing checkable, so the report names each file, the source it
// was verified against, any stamp failure, and what was deliberately left alone. Project-neutral.
const SCRIBE_REPORT =
  "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
  "\n" +
  "```json\n" +
  "{\n" +
  '  "subagent": "scribe",\n' +
  '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
  '  "agentsMdUpdated": 0,\n' +
  '  "docsUpdated": 0,\n' +
  '  "claudeFilesUpdated": 0,\n' +
  '  "changelogUpdated": false,\n' +
  '  "description": "<summary of what was updated>",\n' +
  '  "files": [\n' +
  "    {\n" +
  '      "path": "<file path>",\n' +
  '      "action": "edited | stamped-only",\n' +
  '      "verifiedAgainstCode": ["<source file(s) actually read to support the claims>"],\n' +
  '      "stampFailures": ["<exact error text, or omit if none>"]\n' +
  "    }\n" +
  "  ],\n" +
  '  "changelogEntryAdded": "yes | no (<why>)",\n' +
  '  "intentionallyNotTouched": ["<published, generated or changelog files left alone>"]\n' +
  "}\n" +
  "```\n" +
  "\n" +
  "After the JSON block, add these lines in plain text:\n" +
  "\n" +
  "- `Verified against code: <source file(s) read>` for each edited file.\n" +
  "- `CHANGELOG entry added: yes/no (<why>)`.\n" +
  "- `Files: <path> — edited | stamped only` per file, then `Stamp failures: <path> — <exact error>` (or `none`).\n" +
  "- `Intentionally NOT touched: <files left alone>` (or `none`).\n" +
  "\n" +
  "The scribe is read-only on application code and on published or generated files: never edit them.\n" +
  "\n" +
  scribeEndingNote(".claude/channels/<scope>/scribe/") +
  "\n\n" +
  '"Claude files" covers any file under `.claude/agents/`, `.claude/rules/`, or `.claude/skills/`. ' +
  "Use the counts to keep the handoff message small — do not list individual file names unless the caller asks.";

function testReportBody(gapsNote: string): string {
  return (
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    '  "subagent": "test",\n' +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "testResult": "<N passed, N failed>",\n' +
    '  "description": "<summary of what was tested>"\n' +
    "}\n" +
    "```\n" +
    "\n" +
    gapsNote
  );
}

const TEST_REPORT_V3 = testReportBody(conceptGapsChannelNote("test"));

// The body before `090` made the gap note generic: V3 plus the verdict/HANDOFF note.
const TEST_REPORT_V4 = TEST_REPORT_V3 + "\n\n" + VERDICT_HANDOFF_NOTE;

// The body before `144` scoped the gap note's channel path.
const TEST_REPORT_V5 = testReportBody(skillGapsChannelNoteUnscoped("test")) + "\n\n" + VERDICT_HANDOFF_NOTE;

// The body before `148` asked for the gates run and a notCaught line per test.
const TEST_REPORT_V6 = testReportBody(skillGapsChannelNote("test")) + "\n\n" + VERDICT_HANDOFF_NOTE;

// `148`: checkable evidence. Project-neutral — the agent names the project's own commands.
// The body before `155` made implementer hints neither the minimum nor the scope.
const TEST_REPORT_V7 =
  "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
  "\n" +
  "```json\n" +
  "{\n" +
  '  "subagent": "test",\n' +
  '  "verdict": "SUCCESS | FAIL",\n' +
  '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
  '  "testResult": "<N passed, N failed>",\n' +
  '  "description": "<summary of what was tested>",\n' +
  '  "gates": [{ "command": "<exact command run>", "result": "<exit code, N passed / N failed>" }],\n' +
  '  "gatesSkipped": [{ "command": "<command not run>", "reason": "<why>" }],\n' +
  '  "notCaught": ["<one line per new test: what this test would NOT catch>"]\n' +
  "}\n" +
  "```\n" +
  "\n" +
  "`gates` lists the exact verify commands you ran, copied verbatim with their result: the project test suite, " +
  "lint, static check or typecheck, and any parity or generated-artifact check the change touches. " +
  "Any of those you did not run goes in `gatesSkipped` with a reason. A verdict of SUCCESS is invalid if any of " +
  "them was skipped without a stated reason.\n" +
  "\n" +
  'The implementing agent\'s "Test targets" are the minimum, not the scope: cover every one, then add your own ' +
  "adversarial cases that it did not name, and list in `notCaught` what neither side covered.\n" +
  "\n" +
  "For each new test you write, add one line to `notCaught` saying what that test would NOT catch, for example " +
  "closed or empty input, a copy of a file that no test compares, or a missing feature rather than a wrong one.\n" +
  "\n" +
  skillGapsChannelNote("test") +
  "\n\n" +
  VERDICT_HANDOFF_NOTE;

// `155`: implementer hints (`<sender>/test` in the test lane) never set the scope. The plan comes from
// the acceptance criteria and the code first; the three new fields make that checkable by the
// reviewer, through the test -> reviewer handoff that carries the same three.
// The body before `knownGaps`.
const TEST_REPORT_V8 =
  "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
  "\n" +
  "```json\n" +
  "{\n" +
  '  "subagent": "test",\n' +
  '  "verdict": "SUCCESS | FAIL",\n' +
  '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
  '  "testResult": "<N passed, N failed>",\n' +
  '  "description": "<summary of what was tested>",\n' +
  '  "gates": [{ "command": "<exact command run>", "result": "<exit code, N passed / N failed>" }],\n' +
  '  "gatesSkipped": [{ "command": "<command not run>", "reason": "<why>" }],\n' +
  '  "acceptanceCoverage": [{ "criterion": "<ticket acceptance criterion>", "tests": ["<test name>"], "reason": "<required when tests is empty>" }],\n' +
  '  "testOrigin": {\n' +
  '    "fromHints": ["<test name>"],\n' +
  '    "independent": [{ "test": "<test name>", "source": "<acceptance criterion | file:line code path | failure mode not in hints>" }]\n' +
  "  },\n" +
  '  "hintsSkipped": [{ "hint": "<implementer hint>", "reason": "<one line>" }],\n' +
  '  "notCaught": ["<one line per new test: what this test would NOT catch>"]\n' +
  "}\n" +
  "```\n" +
  "\n" +
  "`gates` lists the exact verify commands you ran, copied verbatim with their result: the project test suite, " +
  "lint, static check or typecheck, and any parity or generated-artifact check the change touches. " +
  "Any of those you did not run goes in `gatesSkipped` with a reason. A verdict of SUCCESS is invalid if any of " +
  "them was skipped without a stated reason.\n" +
  "\n" +
  "Build your test plan from the ticket's acceptance criteria and the code (the diff and the modules it touches) " +
  "before you read any implementer hints in your channel. The hints are neither the minimum nor the scope, and they " +
  "never narrow your plan. Then compare: add a hint that names a real behavior, failure mode or `notHandled` case " +
  "your plan missed; drop one you judge wrong or redundant and list it in `hintsSkipped` with the reason. Run tests " +
  "through the project's own recipe or script (the hints' `howToRun` names it), never the raw tool under it.\n" +
  "\n" +
  "A hint never makes you add a test framework, runner, config, folder structure or kind of test the project does " +
  "not have yet. Work within the test setup that exists; a hint that only an absent setup could cover goes in " +
  "`hintsSkipped` with that reason, so the user can decide whether to add one.\n" +
  "\n" +
  "`acceptanceCoverage` maps every acceptance criterion to its tests, or gives the reason it has none. `testOrigin` " +
  "splits your tests between those a hint suggested and those you found yourself, each with its source. Write the " +
  "same three facts into the reviewer's handoff (`acceptance_coverage`, `test_origin`, `hints_skipped`).\n" +
  "\n" +
  "For each new test you write, add one line to `notCaught` saying what that test would NOT catch, for example " +
  "closed or empty input, a copy of a file that no test compares, or a missing feature rather than a wrong one.\n" +
  "\n" +
  skillGapsChannelNote("test") +
  "\n\n" +
  VERDICT_HANDOFF_NOTE;

// `knownGaps`: @test failed a run for outdated docs a later @scribe owned, and for a generated-file
// diff against HEAD that nothing commits during a run. Neither had a route, so the run stopped.
// Built from V8 by two anchored inserts; the report-defaults test asserts both landed.
const TEST_REPORT = TEST_REPORT_V8.replace(
  '  "notCaught": [',
  '  "knownGaps": [{ "issue": "<what is not right yet>", "owner": "<later step, e.g. @scribe, or \'after commit\'>", "reason": "<why it is not a failure of this step>" }],\n' +
    '  "notCaught": ['
).replace(
  "\n\nFor each new test you write",
  "\n\n" +
    "FAIL only for a defect in the code or tests this task changed. Two things are never a FAIL, and go in " +
    "`knownGaps` instead: work a LATER step on the workflow's success path owns (outdated README, CLAUDE.md or " +
    "docs when @scribe runs after you; a review finding when @reviewer does), and a check that can only pass " +
    "once the work is committed (for example a generated-file check that diffs against HEAD: compare the " +
    "regenerated files to the working tree instead, and record the result). Write the same list into the " +
    "reviewer's handoff as `known_gaps`.\n" +
    "\n" +
    "For each new test you write"
);

/**
 * The exact bodies stripped from
 * `plugins/maestro/agents/{backend,frontend,mobile,infra,scribe,test}.md` — one row per agent,
 * `report_id` equal to the agent's own name. `infra` never had a report body inline to begin with
 * (`050` wrote it stripped, the same as the other three implementation agents by this point) and
 * is seeded here directly rather than "moved" from a prior body. `refactor`/`reviewer` are
 * deliberately absent: they never had a `## Mandatory Output Format` section (their own
 * `## Mandatory Output` sections are a different heading and untouched by this migration), so they
 * get no seed row and resolve to `"none"`, exactly as before.
 */
const SEED_REPORTS: Record<string, string> = {
  backend: backendReport(),
  frontend: backendLikeReport("frontend"),
  mobile: backendLikeReport("mobile"),
  infra: backendLikeReport("infra"),
  scribe: SCRIBE_REPORT,
  test: TEST_REPORT,
};

// ---------------------------------------------------------------------------
// Superseded seeds
// ---------------------------------------------------------------------------

/**
 * Every body this file has ever seeded, per agent, newest-superseded first.
 *
 * `seedIfEmpty` only fires on a store that has never been written to, so on any machine that has
 * ever opened this db, editing `SEED_REPORTS` above does NOTHING — the new field is in the source,
 * the agents never see it, and nothing reports the discrepancy. That is the failure this list
 * exists to close.
 *
 * The rule is the one `report-sync.ts` already applies one tier down: a row whose content matches a
 * superseded seed VERBATIM was never touched by a human, so it is safe to move forward; a row that
 * matches nothing here is either current or hand-edited, and either way is left alone. Comparing
 * against known-old content rather than a stored "did we migrate yet" flag is what makes it safe to
 * run on every open and safe to run twice.
 *
 * When you change a body in `SEED_REPORTS`, move its previous text here verbatim. A body that is
 * changed without being recorded here simply stops propagating — silently.
 */
const PRIOR_SEEDS: Record<string, string[]> = (() => {
  // v1: before `conceptSkillGaps` (the concept-skill feature).
  const backendLikeV1 = (subagent: string): string =>
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    `  "subagent": "${subagent}",\n` +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "filesChanged": ["<file1>", "<file2>"],\n' +
    '  "description": "<summary of what was implemented>"\n' +
    "}\n" +
    "```";

  const testV1 =
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    '  "subagent": "test",\n' +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "testResult": "<N passed, N failed>",\n' +
    '  "filesChanged": ["<file1>", "<file2>"],\n' +
    '  "description": "<summary of what was tested>"\n' +
    "}\n" +
    "```";

  // v2 (`036`): `conceptSkillGaps` and `filesChanged` were IN the JSON report, and the concept-gaps
  // note pointed at the field rather than at the scribe's channel. Superseded when both moved off
  // the report entirely — `conceptSkillGaps` onto `.claude/channels/scribe/`, `filesChanged` onto
  // nothing (zero consumers; what a receiver needs already travels per-route on its own channel).
  const conceptGapsFieldNoteV2 =
    "`conceptSkillGaps` is how a concept skill gets better: if one of the concept skills you loaded " +
    "was missing something you had to work out from the code yourself, say which skill and what was " +
    "missing, so the main session knows to hand it to the scribe. Leave the array empty when nothing " +
    "was missing — do not invent a gap to fill the field.";

  const backendLikeV2 = (subagent: string): string =>
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    `  "subagent": "${subagent}",\n` +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "conceptSkillGaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell you>" }],\n' +
    '  "filesChanged": ["<file1>", "<file2>"],\n' +
    '  "description": "<summary of what was implemented>"\n' +
    "}\n" +
    "```\n" +
    "\n" +
    conceptGapsFieldNoteV2;

  const testV2 =
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    '  "subagent": "test",\n' +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "conceptSkillGaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell you>" }],\n' +
    '  "testResult": "<N passed, N failed>",\n' +
    '  "filesChanged": ["<file1>", "<file2>"],\n' +
    '  "description": "<summary of what was tested>"\n' +
    "}\n" +
    "```\n" +
    "\n" +
    conceptGapsFieldNoteV2;

  // v3 (`083`): the body before the verdict/HANDOFF agreement note was appended. v4 (`090`): the
  // body with that note but the concept-skill-specific gap note, before the gap note went generic.
  // The V1 scribe body was absent while it was the current one (a prior equal to the current body
  // would be "refreshed" on every open); `114` superseded it, so it is a prior again. v5 (`144`):
  // the body whose gap note (scribe: whose ending note) named the unscoped channel path.
  return {
    backend: [
      backendLikeV1("backend"),
      backendLikeV2("backend"),
      backendLikeV3("backend"),
      backendLikeV4("backend"),
      backendLikeV5("backend"),
      backendLikeV6("backend"),
      backendReportV7(),
    ],
    frontend: [
      backendLikeV1("frontend"),
      backendLikeV2("frontend"),
      backendLikeV3("frontend"),
      backendLikeV4("frontend"),
      backendLikeV5("frontend"),
    ],
    mobile: [
      backendLikeV1("mobile"),
      backendLikeV2("mobile"),
      backendLikeV3("mobile"),
      backendLikeV4("mobile"),
      backendLikeV5("mobile"),
    ],
    infra: [backendLikeV3("infra"), backendLikeV4("infra"), backendLikeV5("infra")],
    scribe: [SCRIBE_REPORT_V2, SCRIBE_REPORT_V1, SCRIBE_REPORT_V3, SCRIBE_REPORT_V4],
    test: [
      testV1,
      testV2,
      TEST_REPORT_V3,
      TEST_REPORT_V4,
      TEST_REPORT_V5,
      TEST_REPORT_V6,
      TEST_REPORT_V7,
      TEST_REPORT_V8,
    ],
  };
})();

function openDb(dbPath: string): DatabaseSync {
  // Can be opened on a machine where `~/.claude` itself doesn't exist yet (no Claude Code session
  // has ever run there) — `DatabaseSync` doesn't create parent directories, so this makes the
  // store as robust as the file it's meant to complement.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      report_id TEXT PRIMARY KEY,
      content   TEXT NOT NULL,
      version   INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_reports (
      agent_name TEXT PRIMARY KEY,
      report_id  TEXT NOT NULL
    )
  `);
  seedIfEmpty(db);
  refreshSupersededSeeds(db);
  return db;
}

/**
 * Move any row still carrying a superseded seed body forward to the current one, bumping its
 * `version` so `report-sync.ts` refreshes the project copies it has already materialized.
 *
 * A row the user edited matches nothing in `PRIOR_SEEDS` and is left exactly as it is — the same
 * "never clobber a customization" rule `syncProjectReports` applies to `.claude/reports/*.md`.
 * Idempotent: after one pass the content matches the CURRENT seed, which is not in the prior list.
 */
function refreshSupersededSeeds(db: DatabaseSync): void {
  const select = db.prepare(
    "SELECT r.report_id AS id, r.content AS content, r.version AS version" +
      " FROM reports r JOIN agent_reports a ON a.report_id = r.report_id WHERE a.agent_name = ?"
  );
  const update = db.prepare("UPDATE reports SET content = ?, version = ? WHERE report_id = ?");

  db.exec("BEGIN");
  try {
    for (const [agentName, current] of Object.entries(SEED_REPORTS)) {
      const row = select.get(agentName) as { id: string; content: string; version: number } | undefined;
      if (!row) continue;
      if (!(PRIOR_SEEDS[agentName] ?? []).includes(row.content)) continue;
      update.run(current, row.version + 1, row.id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Idempotent: only runs when `reports` has never been written to, on THIS db file. */
function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number };
  if (row.n > 0) return;
  db.exec("BEGIN");
  try {
    const insertReport = db.prepare("INSERT INTO reports (report_id, content, version) VALUES (?, ?, 1)");
    const insertAgent = db.prepare("INSERT OR REPLACE INTO agent_reports (agent_name, report_id) VALUES (?, ?)");
    for (const [agentName, content] of Object.entries(SEED_REPORTS)) {
      insertReport.run(agentName, content);
      insertAgent.run(agentName, agentName);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Every body ever seeded for `agentName`, oldest first — the superseded history `refreshSupersededSeeds`
 * above checks against, exported so a caller can tell an untracked project file that merely
 * matches an OLD default from one that matches nothing at all (`059`). Empty for an agent this
 * module has never seeded (`refactor`, `reviewer`, or any agent whose default was only ever
 * written by hand through `/templates`) — those have no recorded history, so only the current
 * content counts as "known" for them.
 */
export function priorReportSeeds(agentName: string): string[] {
  return PRIOR_SEEDS[agentName] ?? [];
}

/** The global default report for one agent, or null when it has none. */
export function readAgentReportDefault(
  agentName: string,
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): ReportDefault | null {
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare(
        `SELECT r.report_id AS reportId, r.content AS content, r.version AS version
         FROM agent_reports a JOIN reports r ON r.report_id = a.report_id
         WHERE a.agent_name = ?`
      )
      .get(agentName) as { reportId: string; content: string; version: number } | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

/** One report row by its own id — for a sync step re-checking a version it already recorded. */
export function readReportById(
  reportId: string,
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): { content: string; version: number } | null {
  const db = openDb(dbPath);
  try {
    const row = db.prepare("SELECT content, version FROM reports WHERE report_id = ?").get(reportId) as
      { content: string; version: number } | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

/** Every agent with a global default, keyed by agent name — what install/update sync walks. */
export function readAllAgentReportDefaults(
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): Record<string, ReportDefault> {
  const db = openDb(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT a.agent_name AS agentName, r.report_id AS reportId, r.content AS content, r.version AS version
         FROM agent_reports a JOIN reports r ON r.report_id = a.report_id`
      )
      .all() as Array<{ agentName: string; reportId: string; content: string; version: number }>;
    const out: Record<string, ReportDefault> = {};
    for (const row of rows) out[row.agentName] = { reportId: row.reportId, content: row.content, version: row.version };
    return out;
  } finally {
    db.close();
  }
}

/**
 * Upsert `agentName`'s global default. Keyed by the agent's OWN name — same convention the seed
 * established, and the one restriction this UI carries: it never points an agent at a `report_id`
 * shared with another agent, so `report_id` is always `agentName` here.
 *
 * Bumps `version` by 1 when a `reports` row for `agentName` already exists, else inserts at
 * version 1 — this is what makes `report-sync.ts`'s "global version advanced past
 * `syncedFrom.version`" refresh logic fire for a project that already synced the old content.
 * `reports` and `agent_reports` move together in one transaction, same discipline as `seedIfEmpty`.
 */
export function writeAgentReportDefault(
  agentName: string,
  content: string,
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): ReportDefault {
  const db = openDb(dbPath);
  try {
    db.exec("BEGIN");
    try {
      const existing = db.prepare("SELECT version FROM reports WHERE report_id = ?").get(agentName) as
        { version: number } | undefined;
      const version = existing ? existing.version + 1 : 1;
      db.prepare(
        `INSERT INTO reports (report_id, content, version) VALUES (?, ?, ?)
         ON CONFLICT(report_id) DO UPDATE SET content = excluded.content, version = excluded.version`
      ).run(agentName, content, version);
      db.prepare("INSERT OR REPLACE INTO agent_reports (agent_name, report_id) VALUES (?, ?)").run(
        agentName,
        agentName
      );
      db.exec("COMMIT");
      return { reportId: agentName, content, version };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.close();
  }
}
