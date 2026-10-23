# Report r017: 123-make-pnpm-verify-pass-in-the-sandbox-and-stop-the-test-temp-home-leak.md

- Task: 123-make-pnpm-verify-pass-in-the-sandbox-and-stop-the-test-temp-home-leak.md
- Written: 2026-10-23T16:15:05.071Z
- From session: maestro-2e1cb206

Outcome: done, uncommitted in the main checkout (default workflow, all steps passed first time).

1. turbo.json: added globalPassThroughEnv ["TMPDIR"] (no prior passthrough entries). pnpm verify exits 0 in the sandbox with no env-mode override (113 files, 2144 tests). Caveat: the test agent's last verify run was a turbo cache hit, so that output was replayed; the backend agent's earlier uncached run did execute all tests.
2. apps/maestro/test/setup-isolation.ts: temp-HOME cleanup moved from process.on("exit") to afterAll. maestro-test-home-* count in /tmp/claude-1000 stayed 231 -> 231 across two test files and the full suite. Not demonstrated: the old exit hook leaking against the reverted file.
3. Leaked dirs found: 231 (the task estimated ~849). None deleted; user decides.
4. Comments naming the channel write guard (task 122) as the stand-down exception added to hook-arbitration.ts (header) and install.ts (header and hasHook doc, reflowed). build:plugin-libs produced no change under plugins/ (comments are stripped), so no mirror refresh and no version bump; plugin stays 0.12.5. Parity test passes (43).
5. Docs: the concept skills already record the exemption; nothing else needed updating.

Findings: the SubagentStop hook reported "NO HANDOFF line" for every subagent here, because each ended with a SubagentHandback tool call whose report did contain HANDOFF: success. Routed on the report text each time. Possible hook gap worth a ticket.
Suggested ticket changes: none to this task; optional follow-up for the handoff-issues false positive.
