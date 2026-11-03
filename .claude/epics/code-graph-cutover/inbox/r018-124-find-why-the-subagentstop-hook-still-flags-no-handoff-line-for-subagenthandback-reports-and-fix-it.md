# Report r018: 124-find-why-the-subagentstop-hook-still-flags-no-handoff-line-for-subagenthandback-reports-and-fix-it.md

- Task: 124-find-why-the-subagentstop-hook-still-flags-no-handoff-line-for-subagenthandback-reports-and-fix-it.md
- Written: 2026-10-23T19:31:50.994Z
- From session: maestro-8dcd3767

Outcome: done, user-approved at human review. Uncommitted in the main checkout.

Cause (task 123 r017 false positive): a race. Claude Code fires SubagentStop before it has flushed the agent's final SubagentHandback tool_use line to agent_transcript_path. The hook read the transcript once, found no hand-back, and recorded `missing`. Ruled out by measurement: wrong transcript (payload's agent_transcript_path is the agent's own file), changed tool name or input key (real 123 transcript has name SubagentHandback, report in input.message), block shape (message.content[] tool_use). handbackHandoff itself is correct. Real shape: assistant line, message.content[0] = {type:tool_use, name:SubagentHandback, input:{message:"...HANDOFF: success"}}.

Fix: awaitHandback in apps/maestro/src/core/handoff-label.ts re-reads every 100 ms for up to 3 s until a hand-back call is present (stops early on unreadable file or a labelless call); maestro-subagent-log.js uses it. Libs rebuilt, mirrors refreshed, parity passes, plugin 0.12.5 -> 0.12.6, maestro-architecture stamped 1.28 and extracted/applied (0 unextracted).

Tests: backend added 7 (incl. an end-to-end real-hook case that fails with the exact `missing` symptom when forced back to a single read); @test added 7 more failure-mode tests. Full suite 2158 passed. Reviewer: PASS.

Findings: a hand-back later than the 3 s cap is still flagged missing, so the false positive can persist if the flush is slower than that. Other projects get the fix only after installing plugin 0.12.6. The test fixture is rebuilt from the real 123 transcript shape, not a copy. installing-maestro, updating-maestro and plugin-libs-parity show 2 changed unextracted each, from earlier commits, not edited here. Backend's probe subagents left stray handoff entries in the session log; ignore them.

Suggested ticket changes: none.
