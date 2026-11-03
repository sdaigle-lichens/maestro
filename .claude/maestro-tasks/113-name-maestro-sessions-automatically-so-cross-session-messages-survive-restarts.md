# Name Maestro sessions automatically so cross-session messages survive restarts

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Maestro manager and worker sessions find each other by session name (ListAgents / SendMessage), and the epic and task claims record those names. Auto-generated names change when a session is stopped and restarted, so recorded names go stale and the user has to redirect messages by hand. Give every Maestro session a deterministic name derived from its session id, and have hooks apply it with the hook output field `sessionTitle` (same effect as /rename).

Design (from an approved architecture pass): one new core module `session-name` (shipped through the maestro-session plugin lib) with: `sessionNameFor(sessionId, role)` -> `maestro-<id8>` for a worker, `maestro-mgr-<id8>` for a manager (id8 = first 8 chars of the session id; no epic slug, because it isn't known at entry and renaming later would re-stale recorded names); `noteEntrance(claudeDir, sessionId, role)` stores it in the session's `session.json` (first entrance wins, never overwritten); `titleFor(claudeDir, payload)` decides the hook's `sessionTitle` (a custom `session_title` in the payload is respected and recorded as the name instead; UserPromptSubmit applies the stored name once; SessionStart re-applies it every time, and when the session directory was swept re-derives it from the epic / claim that records `maestro[-mgr]-<id8>`); `storedName(claudeDir, sessionId)` which the epic and claim CLIs prefer over a caller-passed name. Invalid/no session id or no maestro.json -> silent exit 0.

One new hand-written hook script under the plugin's scripts covers five registrations: UserPromptExpansion for `maestro`, UserPromptExpansion for `maestro-manager`, PreToolUse matcher Skill (filtered to those two skills — Claude invoking them), UserPromptSubmit, SessionStart. Register them in both the plugin's hooks.json and the app's install HOOK_REGISTRATIONS. Both skills stay model-invocable.

Also a small app change in source code: the desktop app's task Run prompt and the /maestro-tasks Copy prompt start with the command, `/maestro Complete the task described in file <path>`, so the typed path is taken.

The work includes code, tests (unit tests of the module in a temp project, plus a hook-level test feeding real JSON payloads to the script), rebuilding the generated plugin libs, refreshing the tracked .claude/scripts mirrors and running the parity test, a minor version bump of the maestro plugin (new hook events), and doc/skill updates: the maestro-manager skill, the orchestrator template's claim step, and the maestro-architecture and task-queue developer skills, which currently say a restarted session loses its name or tell the session to read its own name from ListAgents.

Verify first, before building: a name set by a hook's `sessionTitle` survives a plain `claude --resume` (same session id; --fork-session gets a new one) and is the name ListAgents shows and SendMessage addresses. If it is not, stop and report.

## Acceptance criteria

- [ ] Verified and recorded in the task notes: a hook-set sessionTitle survives `claude --resume` with the same session_id, and ListAgents / SendMessage address the session by it
- [ ] Starting /maestro or /maestro-manager, typed or model-invoked, records `maestro-<id8>` / `maestro-mgr-<id8>` in session.json; the first entrance wins; a user-set custom name is kept and recorded instead
- [ ] UserPromptSubmit applies the stored name once; SessionStart re-applies it on restart and re-derives it from epic/claim records when the session directory was swept
- [ ] `claim`, `set-manager`, `create --manager`, `add-worker` and `report --from` record the stored name in preference to a passed-in one
- [ ] The app's task Run prompt and Copy prompt read `/maestro Complete the task described in file <path>`
- [ ] Hooks registered in both hooks.json and HOOK_REGISTRATIONS; plugin libs rebuilt; .claude/scripts mirrors refreshed; parity test passes; maestro plugin.json minor version bumped
- [ ] maestro-manager skill, orchestrator template claim step, maestro-architecture and task-queue docs no longer say a restarted session loses its name, and say the CLI fills in the session name
- [ ] `pnpm verify` passes

## Blocked by

None — can start immediately

## Notes

Verification (before building), confirmed from the Claude Code documentation and the installed
Agent SDK typings; a live `claude --resume` experiment was not possible from the sandbox (the
`claude` binary under `~/.local/bin` is unreadable and `~/.claude/projects` is write-denied).

- Hooks reference, SessionStart output: `sessionTitle` sets the session title "with the same effect
  as `/rename`", and applies when `source` is `startup`, `resume` or `fork`. UserPromptSubmit output
  has the same field, documented for naming sessions automatically from the prompt.
- Hooks reference, SessionStart input: `session_title` is the session's custom title, present when
  one is set with `--name`, `/rename`, a hook's `sessionTitle` output or the SDK's
  `renameSession()`. So a hook-set title is a persisted custom title, the same kind `/rename`
  writes; the SDK typings describe `renameSession` as appending a custom-title entry to the
  session's JSONL file, which `claude --resume` (same session id) reads back.
- Cross-session messaging docs: a session answers to the name set with `/rename` or `--name`;
  `/list-agents` shows this session's own name, the one other sessions use to message it; SendMessage
  delivers on the name alone when one session answers to it.
- Sessions docs: `--fork-session` and `/branch` get a new session id, hence a new `<id8>`.
- `@anthropic-ai/claude-agent-sdk` 0.3.241 `sdk.d.ts`: `sessionTitle?: string` exists only on
  `SessionStartHookSpecificOutput` and `UserPromptSubmitHookSpecificOutput`. UserPromptExpansion and
  PreToolUse cannot set a title, so those entrances only record the name; the next UserPromptSubmit
  or SessionStart applies it.
- Belt and braces: SessionStart re-applies the stored name on every startup/resume/fork anyway.

Not verified: a live end-to-end run, and the exact `command_name` a plugin-namespaced skill reports
on UserPromptExpansion (the hook accepts both `maestro-manager` and `maestro:maestro-manager`).
