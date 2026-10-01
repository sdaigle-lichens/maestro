# Let read-only agents write their handoff channel files, and only those

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The reviewer and refactor agents are defined as unable to write files, yet their instructions require them to write a channel payload for every HANDOFF route. In practice the reviewer could not write the scribe's input file, so the scribe received no structured payload from it. Let these two agents write files under the project's .claude/channels/ directory and nowhere else, enforced by a hook at tool-call time rather than by prompt wording, so they still cannot modify application code, docs, config or anything outside the channel lanes. A write outside .claude/channels/ (including path tricks such as .. segments or symlinks) must be refused with a clear message. Other agents keep their current permissions. Also address a related finding from the post-mortem of task 076: handoffs delivered through a SendMessage hand-back rather than a final message are recorded as `unknown` in the post-mortem digest; make the digest recognise them or record why that is acceptable.

## Acceptance criteria

- [ ] The reviewer and refactor agents can write a channel file under .claude/channels/ when handing off
- [ ] A write by either agent to any path outside .claude/channels/ is refused with a clear message, including via .. segments and symlinks
- [ ] Other agents' write permissions are unchanged
- [ ] Verified against a real reviewer subagent run: its handoff payload lands in the receiver's channel lane and the receiver gets it
- [ ] Negative case verified end to end: a real reviewer or refactor attempt to edit a file outside .claude/channels/ is blocked
- [ ] Hand-back handoffs no longer show as `unknown` in the post-mortem digest, or the task records why that is acceptable
- [ ] The plugin version is bumped as required by the publishing rules (minor if a new hook event is added, otherwise patch)

## Blocked by

None — can start immediately

## Status notes

- UNMET: plugin version bump (AC 7) — the user explicitly overrode the publishing rule; `plugins/maestro/.claude-plugin/plugin.json` is intentionally unchanged.
- UNMET: live-subagent acceptance (AC 4 and AC 5) — not verified against a real reviewer/refactor run; only unit tests cover the guard.
- Hand-back `unknown` (AC 6): met by recovering the label from the agent transcript's last `SendMessage` call (`handoff-label.ts`).
