# Keep the review file path visible in every approval summary

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When a task stops for approval (a human review, including the human review that a manager-review fallback or escalation runs), the user sees a digest in the Approve option's preview of the question dialog. That preview is capped, and the review file's path is currently the last line of the digest, so it is the line that gets cut off ("1 lines hidden"): the link to the full review text is the one thing the user cannot see. Make the path impossible to cut off: it must be the FIRST line of the digest, and also the first line of the full summary printed as text above the question. When the digest had to be shortened to fit, its last line must say so (for example that the rest is in the review file) so the user knows to open it. Apply this everywhere the human-review stop is described or enforced: the orchestrator skill template, the gate's denial and instruction message in source code, the manager-review fallback and escalate wording that reuses the human review, and any other prompt or message that tells an agent how to build or place an approval summary or the review file path. This is prompt text and message strings in source code, plus tests, the regeneration of the plugin's generated libraries from their TypeScript sources, a plugin version bump, the repo's runtime refresh (the user runs it with a ! command if the sandbox forbids it) so the rendered orchestrator picks up the new text, and updating the concept skill text that documents the gate if it states where the path goes. Do not change what a review file contains or how it is named.

## Acceptance criteria

- [ ] The orchestrator template tells the agent to put the review file's path on the first line of the Approve preview digest and on the first line of the printed summary, and no longer says it goes last.
- [ ] The gate's message (the one the hook returns when the review file is missing or the question is asked) gives the same instruction, in the same words as the template.
- [ ] The manager-review fallback and escalate paths, which run a human review, inherit the same placement with no separate contradicting wording anywhere in the template, skills or scripts.
- [ ] The template says that when the digest is shortened to fit, its last line states that the full text is in the review file.
- [ ] A repo-wide search for the old wording (path as the last line of the digest) finds nothing left, including in the rendered orchestrator under .claude/skills and in the concept skill text.
- [ ] Tests cover the gate message wording, and the generated plugin libraries are rebuilt with the parity test passing.
- [ ] The maestro plugin version is bumped, and pnpm verify passes.
- [ ] The rendered orchestrator in this repo is refreshed with pnpm refresh:runtime (handed to the user as a ! command if the sandbox blocks it), and the parity test confirms it.

## Blocked by

None — can start immediately
