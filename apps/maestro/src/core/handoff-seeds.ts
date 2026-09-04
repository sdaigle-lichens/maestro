// The handoff-protocol seed tier — WHAT MAESTRO SHIPS, and the floor every other tier sits on.
//
// SPLIT OUT OF handoff-defaults.ts for exactly the reason `031` split agent-fork-record.ts out of
// agent-fork.ts: this module must reach the SubagentStart hook through a bundle that runs under
// whatever `node` is on the session's PATH, and `node:sqlite` needs `node` >= 22.5. So nothing
// here may import anything that reaches `node:sqlite` — it is re-exported from
// `plugin-entries/maestro-session.ts`, the bundle the hook `require`s UNCONDITIONALLY, while the
// sqlite store gets its own bundle the hook `require`s inside a try/catch.
//
// The property to preserve, and it fails silently if you break it:
//
//   grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs   →   0
//
// Before `033` these 23 bodies were files under `plugins/maestro/templates/handoffs/`, copied by
// every install into `<project>/.claude/templates/handoffs/` and blind-overwritten on the next
// one. That directory is gone: a fallback the installer overwrites can never hold an opinion, and
// two copies of the same default is the drift the three-tier resolution exists to remove.
//
// A handoff id is `"<sender>/<receiver>"`, bare agent names on BOTH sides (`maestro:test` is
// `test` here), which maps straight onto `.claude/handoffs/<sender>/<receiver>.md`.
//
// `036` REWROTE EVERY BODY HERE. Before `036` a body was the shape of the `handoff_details` field
// of the sender's final-message JSON — the orchestrator read that field and forwarded it verbatim
// into the next `Task` prompt. Since `036` there is no `handoff_details` field: the sender writes
// this exact JSON shape, flat (no wrapper key), to its own channel file —
// `.claude/channels/<receiver>/<sender>.1.md` — and the receiving agent's `SubagentStart` hook
// inlines it. The hook composes the "write this to your channel file" sentence and the per-route
// file path dynamically (it already knows both ends of the route); a body here is only ever the
// JSON shape itself.

const BACKEND_TO_FRONTEND =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "api_contracts": ["<endpoint — request/response shape the UI consumes>"],\n' +
  '  "integration_notes": ["<how the frontend should wire it up, or \'none\'>"],\n' +
  '  "edge_cases": ["<edge case the UI must handle, or \'none\'>"]\n' +
  "}\n" +
  "```";

const BACKEND_TO_MOBILE =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "api_contracts": ["<endpoint — request/response shape the app consumes>"],\n' +
  '  "integration_notes": ["<how the mobile app should wire it up, or \'none\'>"],\n' +
  '  "edge_cases": ["<edge case the app must handle, or \'none\'>"]\n' +
  "}\n" +
  "```";

const BACKEND_TO_REVIEWER =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "what_changed": ["<file:area — summary of the change>"],\n' +
  '  "design_decisions": ["<decision and rationale, or \'none\'>"],\n' +
  '  "areas_of_concern": ["<spot the reviewer should scrutinize, or \'none\'>"]\n' +
  "}\n" +
  "```";

const BACKEND_TO_TEST =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "behaviors_to_test": ["<endpoint/function — expected behavior>"],\n' +
  '  "how_to_run": ["<command to exercise the new code, or \'none\'>"],\n' +
  '  "edge_cases": ["<edge case the implementation handles, or \'none\'>"]\n' +
  "}\n" +
  "```";

const FRONTEND_TO_MOBILE =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "component_or_screen": "<the web feature being ported>",\n' +
  '  "business_logic_to_reuse": ["<shared logic/hook/util the mobile version should reuse, or \'none\'>"],\n' +
  '  "platform_differences_to_handle": ["<web-only API, layout, or interaction that needs a native equivalent, or \'none\'>"]\n' +
  "}\n" +
  "```";

const FRONTEND_TO_REVIEWER =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "what_changed": ["<file:area — summary of the change>"],\n' +
  '  "design_decisions": ["<decision and rationale, or \'none\'>"],\n' +
  '  "areas_of_concern": ["<spot the reviewer should scrutinize, or \'none\'>"]\n' +
  "}\n" +
  "```";

const FRONTEND_TO_TEST =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "behaviors_to_test": ["<component/page — expected behavior>"],\n' +
  '  "how_to_run": ["<command to exercise the new UI, or \'none\'>"],\n' +
  '  "edge_cases": ["<edge case the implementation handles, or \'none\'>"]\n' +
  "}\n" +
  "```";

const MOBILE_TO_FRONTEND =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "component_or_screen": "<the mobile feature being ported>",\n' +
  '  "business_logic_to_reuse": ["<shared logic/hook/util the web version should reuse, or \'none\'>"],\n' +
  '  "platform_differences_to_handle": ["<native-only API, gesture, or interaction that needs a web equivalent, or \'none\'>"]\n' +
  "}\n" +
  "```";

const MOBILE_TO_REVIEWER =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "what_changed": ["<file:area — summary of the change>"],\n' +
  '  "design_decisions": ["<decision and rationale, or \'none\'>"],\n' +
  '  "areas_of_concern": ["<spot the reviewer should scrutinize, or \'none\'>"]\n' +
  "}\n" +
  "```";

const MOBILE_TO_TEST =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "behaviors_to_test": ["<screen/component — expected behavior>"],\n' +
  '  "how_to_run": ["<command to exercise the new UI, or \'none\'>"],\n' +
  '  "edge_cases": ["<edge case the implementation handles, or \'none\'>"]\n' +
  "}\n" +
  "```";

const REFACTOR_TO_BACKEND =
  "```json\n" + "{\n" + '  "issues": ["<file:line — description of the problem>"]\n' + "}\n" + "```";

const REFACTOR_TO_FRONTEND =
  "```json\n" + "{\n" + '  "issues": ["<file:line — description of the problem>"]\n' + "}\n" + "```";

const REFACTOR_TO_REVIEWER =
  "```json\n" + "{\n" + '  "summary": "<brief summary of what was delegated, for re-review>"\n' + "}\n" + "```";

const REFACTOR_TO_SCRIBE =
  "```json\n" +
  "{\n" +
  '  "new_code_patterns_or_rules": ["<pattern and which agent/rule file should receive it>"],\n' +
  '  "concept_skill_gaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell the agent>" }]\n' +
  "}\n" +
  "```";

const REFACTOR_TO_TEST =
  "```json\n" + "{\n" + '  "issues": ["<file:line — description of the problem>"]\n' + "}\n" + "```";

const REVIEWER_TO_BACKEND =
  "```json\n" + "{\n" + '  "issues": ["<file:line — description of the problem>"]\n' + "}\n" + "```";

const REVIEWER_TO_FRONTEND =
  "```json\n" + "{\n" + '  "issues": ["<file:line — description of the problem>"]\n' + "}\n" + "```";

const REVIEWER_TO_REFACTOR =
  "```json\n" +
  "{\n" +
  '  "violations": ["<file:line — pattern violation, DRY issue, or code redundancy>"]\n' +
  "}\n" +
  "```";

const REVIEWER_TO_SCRIBE =
  "```json\n" +
  "{\n" +
  '  "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
  '  "justfile_commands_changed": ["<old → new description, or \'none\'>"],\n' +
  '  "new_code_patterns_or_rules": ["<pattern and which agent/rule file should receive it, or \'none\'>"],\n' +
  '  "schema_changes": ["<new tables, columns, or constraints, or \'none\'>"],\n' +
  '  "workflow_or_process_changes": ["<changed agent handoff, new convention, or \'none\'>"],\n' +
  '  "concept_skill_gaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell the agent>" }]\n' +
  "}\n" +
  "```";

const REVIEWER_TO_TEST =
  "```json\n" +
  "{\n" +
  '  "failing_tests": ["<test name — failure reason>"],\n' +
  '  "missing_coverage": ["<endpoint or behavior that lacks a test>"]\n' +
  "}\n" +
  "```";

const TEST_TO_BACKEND =
  "```json\n" +
  "{\n" +
  '  "failing_tests": ["<test name — behavior it expects>"],\n' +
  '  "test_files_added": ["<list, or \'none\'>"],\n' +
  '  "implementation_targets": ["<endpoint/function the backend must implement>"],\n' +
  '  "how_to_run": ["<command to run the failing tests, or \'none\'>"]\n' +
  "}\n" +
  "```";

const TEST_TO_FRONTEND =
  "```json\n" +
  "{\n" +
  '  "failing_tests": ["<test name — behavior it expects>"],\n' +
  '  "test_files_added": ["<list, or \'none\'>"],\n' +
  '  "implementation_targets": ["<component/page the frontend must implement>"],\n' +
  '  "how_to_run": ["<command to run the failing tests, or \'none\'>"]\n' +
  "}\n" +
  "```";

const TEST_TO_REVIEWER =
  "```json\n" +
  "{\n" +
  '  "tests_added": ["<test name — what it verifies>"],\n' +
  '  "results": ["<pass/fail summary>"],\n' +
  '  "coverage_gaps": ["<behavior still untested, or \'none\'>"],\n' +
  '  "files_touched": ["<list, or \'none\'>"]\n' +
  "}\n" +
  "```";

/**
 * The 23 handoff protocols Maestro ships, keyed `"<sender>/<receiver>"` — the JSON shape a sender
 * writes VERBATIM to `.claude/channels/<receiver>/<sender>.1.md` (`036`).
 *
 * Written out one constant per pair, deliberately NOT factored through shared helpers even where
 * bodies are currently byte-identical (`backend|frontend|mobile -> reviewer`, and a five-way group
 * across `refactor|reviewer -> ...`). Those collisions are seed artifacts, not a shared contract:
 * a reviewer wants different evidence from a backend change than from a frontend one, and the
 * bodies are expected to diverge as the agents are refined. Factoring them would make diverging
 * one a refactor instead of an edit.
 *
 * EDITING A BODY HERE IS NOT ENOUGH ON ITS OWN — move its previous text into `PRIOR_SEEDS` below,
 * or the change reaches only machines that have never opened the global store.
 */
export const SEED_HANDOFFS: Record<string, string> = {
  "backend/frontend": BACKEND_TO_FRONTEND,
  "backend/mobile": BACKEND_TO_MOBILE,
  "backend/reviewer": BACKEND_TO_REVIEWER,
  "backend/test": BACKEND_TO_TEST,
  "frontend/mobile": FRONTEND_TO_MOBILE,
  "frontend/reviewer": FRONTEND_TO_REVIEWER,
  "frontend/test": FRONTEND_TO_TEST,
  "mobile/frontend": MOBILE_TO_FRONTEND,
  "mobile/reviewer": MOBILE_TO_REVIEWER,
  "mobile/test": MOBILE_TO_TEST,
  "refactor/backend": REFACTOR_TO_BACKEND,
  "refactor/frontend": REFACTOR_TO_FRONTEND,
  "refactor/reviewer": REFACTOR_TO_REVIEWER,
  "refactor/scribe": REFACTOR_TO_SCRIBE,
  "refactor/test": REFACTOR_TO_TEST,
  "reviewer/backend": REVIEWER_TO_BACKEND,
  "reviewer/frontend": REVIEWER_TO_FRONTEND,
  "reviewer/refactor": REVIEWER_TO_REFACTOR,
  "reviewer/scribe": REVIEWER_TO_SCRIBE,
  "reviewer/test": REVIEWER_TO_TEST,
  "test/backend": TEST_TO_BACKEND,
  "test/frontend": TEST_TO_FRONTEND,
  "test/reviewer": TEST_TO_REVIEWER,
};

/**
 * Every body this file has ever seeded, per handoff id, newest-superseded first.
 *
 * `seedIfEmpty` in `handoff-defaults.ts` only fires on a store that has never been written to, so
 * on any machine that has ever opened that db, editing `SEED_HANDOFFS` above does NOTHING — the
 * new field is in the source, the agents never see it, and nothing reports the discrepancy. That
 * is the failure this list exists to close; `report-defaults.ts`'s own `PRIOR_SEEDS` header
 * carries the longer argument.
 *
 * The rule: a row whose content matches a superseded seed VERBATIM was never touched by a human,
 * so it is safe to move forward; a row matching nothing here is either current or hand-edited, and
 * either way is left alone. Comparing against known-old content rather than a stored "did we
 * migrate yet" flag is what makes it safe to run on every open and safe to run twice.
 *
 * `036`: every one of the 23 bodies above was rewritten (the `{"handoff_details": {...}}` wrapper
 * dropped — a sender now writes the flat shape straight to its channel file), so every id below
 * carries its pre-`036` body.
 */
export const PRIOR_SEEDS: Record<string, string[]> = {
  "backend/frontend": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "api_contracts": ["<endpoint — request/response shape the UI consumes>"],\n' +
      '    "integration_notes": ["<how the frontend should wire it up, or \'none\'>"],\n' +
      '    "edge_cases": ["<edge case the UI must handle, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "backend/mobile": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "api_contracts": ["<endpoint — request/response shape the app consumes>"],\n' +
      '    "integration_notes": ["<how the mobile app should wire it up, or \'none\'>"],\n' +
      '    "edge_cases": ["<edge case the app must handle, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "backend/reviewer": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "what_changed": ["<file:area — summary of the change>"],\n' +
      '    "design_decisions": ["<decision and rationale, or \'none\'>"],\n' +
      '    "areas_of_concern": ["<spot the reviewer should scrutinize, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "backend/test": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "behaviors_to_test": ["<endpoint/function — expected behavior>"],\n' +
      '    "how_to_run": ["<command to exercise the new code, or \'none\'>"],\n' +
      '    "edge_cases": ["<edge case the implementation handles, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "frontend/mobile": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "component_or_screen": "<the web feature being ported>",\n' +
      '    "business_logic_to_reuse": ["<shared logic/hook/util the mobile version should reuse, or \'none\'>"],\n' +
      '    "platform_differences_to_handle": ["<web-only API, layout, or interaction that needs a native equivalent, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "frontend/reviewer": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "what_changed": ["<file:area — summary of the change>"],\n' +
      '    "design_decisions": ["<decision and rationale, or \'none\'>"],\n' +
      '    "areas_of_concern": ["<spot the reviewer should scrutinize, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "frontend/test": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "behaviors_to_test": ["<component/page — expected behavior>"],\n' +
      '    "how_to_run": ["<command to exercise the new UI, or \'none\'>"],\n' +
      '    "edge_cases": ["<edge case the implementation handles, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "mobile/frontend": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "component_or_screen": "<the mobile feature being ported>",\n' +
      '    "business_logic_to_reuse": ["<shared logic/hook/util the web version should reuse, or \'none\'>"],\n' +
      '    "platform_differences_to_handle": ["<native-only API, gesture, or interaction that needs a web equivalent, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "mobile/reviewer": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "what_changed": ["<file:area — summary of the change>"],\n' +
      '    "design_decisions": ["<decision and rationale, or \'none\'>"],\n' +
      '    "areas_of_concern": ["<spot the reviewer should scrutinize, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "mobile/test": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "behaviors_to_test": ["<screen/component — expected behavior>"],\n' +
      '    "how_to_run": ["<command to exercise the new UI, or \'none\'>"],\n' +
      '    "edge_cases": ["<edge case the implementation handles, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "refactor/backend": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "issues": ["<file:line — description of the problem>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "refactor/frontend": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "issues": ["<file:line — description of the problem>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "refactor/reviewer": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "summary": "<brief summary of what was delegated, for re-review>"\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "refactor/scribe": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "new_code_patterns_or_rules": ["<pattern and which agent/rule file should receive it>"],\n' +
      '    "concept_skill_gaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell the agent>" }]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "refactor/test": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "issues": ["<file:line — description of the problem>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "reviewer/backend": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "issues": ["<file:line — description of the problem>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "reviewer/frontend": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "issues": ["<file:line — description of the problem>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "reviewer/refactor": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "violations": ["<file:line — pattern violation, DRY issue, or code redundancy>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "reviewer/scribe": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "files_added_removed_renamed": ["<list, or \'none\'>"],\n' +
      '    "justfile_commands_changed": ["<old → new description, or \'none\'>"],\n' +
      '    "new_code_patterns_or_rules": ["<pattern and which agent/rule file should receive it, or \'none\'>"],\n' +
      '    "schema_changes": ["<new tables, columns, or constraints, or \'none\'>"],\n' +
      '    "workflow_or_process_changes": ["<changed agent handoff, new convention, or \'none\'>"],\n' +
      '    "concept_skill_gaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell the agent>" }]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "reviewer/test": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "failing_tests": ["<test name — failure reason>"],\n' +
      '    "missing_coverage": ["<endpoint or behavior that lacks a test>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "test/backend": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "failing_tests": ["<test name — behavior it expects>"],\n' +
      '    "test_files_added": ["<list, or \'none\'>"],\n' +
      '    "implementation_targets": ["<endpoint/function the backend must implement>"],\n' +
      '    "how_to_run": ["<command to run the failing tests, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "test/frontend": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "failing_tests": ["<test name — behavior it expects>"],\n' +
      '    "test_files_added": ["<list, or \'none\'>"],\n' +
      '    "implementation_targets": ["<component/page the frontend must implement>"],\n' +
      '    "how_to_run": ["<command to run the failing tests, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
  "test/reviewer": [
    "```json\n" +
      "{\n" +
      '  "handoff_details": {\n' +
      '    "tests_added": ["<test name — what it verifies>"],\n' +
      '    "results": ["<pass/fail summary>"],\n' +
      '    "coverage_gaps": ["<behavior still untested, or \'none\'>"],\n' +
      '    "files_touched": ["<list, or \'none\'>"]\n' +
      "  }\n" +
      "}\n" +
      "```",
  ],
};

/**
 * A handoff id Maestro itself ships a body for. `034`'s UI uses it to say "this is Maestro's
 * default" rather than "somebody put this here"; `handoff-resolution.ts` uses it as the floor.
 */
export function isSeededHandoff(handoffId: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEED_HANDOFFS, handoffId);
}

/**
 * A handoff id contains a `/` BY DESIGN and is joined straight into a filesystem path
 * (`.claude/handoffs/<sender>/<receiver>.md`), so it is the one id in this codebase that cannot be
 * guarded by "no separators". Validate it explicitly, before any `path.join`, in every module that
 * turns one into a path — the store, the sync, and the app-facing read/write in `handoffs.ts`.
 *
 * Exactly two segments, each of them bare agent-name characters: no `.`, no `..`, no absolute
 * path, no third segment, no empty side. `isValidDocSlug` in `docs.ts` guards the docs reader the
 * same way, for the same reason.
 */
export function isValidHandoffId(handoffId: unknown): handoffId is string {
  return typeof handoffId === "string" && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(handoffId);
}

/** Split a validated id into its two bare agent names. Throws on an id that isn't one. */
export function splitHandoffId(handoffId: string): { sender: string; receiver: string } {
  if (!isValidHandoffId(handoffId)) throw new Error(`Invalid handoff id: ${String(handoffId)}`);
  const [sender, receiver] = handoffId.split("/");
  return { sender, receiver };
}

/** The id for a route, from its two ends. Bare names on both sides — see this file's header. */
export function handoffId(sender: string, receiver: string): string {
  return `${sender}/${receiver}`;
}
