# Show context-window usage in the Session Log

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Session-log entries already carry ctx_pct (context-window fill %) and ctx_model, stamped by the hooks (core/session-usage.ts deriveUsage, written by session-runtime.ts), but nothing in the app's renderer, main, shared or preload code reads them, so the Session Log page never shows context usage. Surface it: in the 'Logs: <agent>' right panel show the agent's latest context usage (for example 'Backend · 62% of 200k'), and show a small badge on each node in the Workflow sidebar so it is visible which agent is filling up. The value is an estimate — under parallel subagents all agents share one transcript_path, so an entry can pick up another agent's usage line (documented in session-usage.ts) — so label it as approximate. Step-gate entries (maestro-step1-gates.cjs, maestro-step4-gate.cjs) carry no ctx_pct; the UI must render nothing for those, never 0%. The ctx_pct/ctx_model fields are already declared in core/contracts.ts, so the renderer needs them passed through the existing session-log read path.

## Acceptance criteria

- [ ] The 'Logs: <agent>' panel shows the agent's most recent context usage as a percentage with the model's window size, marked as approximate
- [ ] Each node in the Workflow sidebar shows a small context-usage badge when usage is known
- [ ] Entries or nodes with no ctx_pct render no usage indicator (not 0%)
- [ ] ctx_pct and ctx_model reach the renderer through the existing session-log data path with types from core/contracts.ts
- [ ] Verified against a real session log containing both stamped and unstamped entries

## Blocked by

None — can start immediately
