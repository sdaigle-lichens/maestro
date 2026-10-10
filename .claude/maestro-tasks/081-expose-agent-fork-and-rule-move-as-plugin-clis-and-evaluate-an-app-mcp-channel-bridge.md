# Expose agent fork and rule move as plugin CLIs, and evaluate an app MCP + channel bridge

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Today, forking a plugin agent and moving or reassigning a project rule can only be done in the Maestro desktop app (/agents and /rules). As a result, the maestro-team-meeting skill has to send the user to the app instead of applying those approved changes itself.

Part 1 (the deliverable): expose agent forking and rule moves as plugin command-line tools, the same way other core logic already ships to the plugin as generated bundles. They must reuse the app's existing core logic: the fork provenance record, the sync decision, and the rules slice-merge with read-before-write on maestro.json. Never write a second implementation. Then update the team-meeting skill to apply approved fork and rule-move proposals with these CLIs, after the user has approved and the meeting has closed, instead of sending the user to the app. The app's views must show the result exactly as if the change had been made in the app.

Part 2 (a written evaluation, no implementation): assess an MCP server for the desktop app plus a Claude Code channel (see https://code.claude.com/docs/en/channels-reference). Cover:
- MCP tools for Claude to app actions, such as opening a pre-filled review of a meeting's decisions, or a pre-filled create-skill, agent or plugin form;
- a channel for app to session events, such as the user approving in the app and the terminal session continuing.

The evaluation must address:
- channels are a research preview, and a custom channel needs --dangerously-load-development-channels on every session unless an org allowlists it;
- the channel server is a stdio subprocess spawned by Claude Code, so it would be a bridge to the running app over localhost;
- sender gating and token auth, compared against the app's existing preview, token and run security model;
- the flag is ignored in non-interactive and Agent SDK sessions, so the app's own sessions can't receive channel events;
- there is no delivery acknowledgement.

End with a recommendation: build, defer, or drop. If build, give a proposed first slice.

Part 3 (owner-run routing fix): after a meeting closes, the team meeting's owner runs are dispatched with the plain Agent tool under the session's recorded workflow. As a result, the subagent-start hook probably gives each owner that workflow's HANDOFF routes and payload instructions. An owner that follows them writes channel payloads, the stop hook stamps them, and a later workflow step in the same session would receive them. Confirm this with a test first. If it holds, mark owner runs so the hook gives them no routing, no payload instructions and no channel delivery, and they write no channel payloads. They should otherwise run as normal agents: their own skills, tools and write rules, outside meeting mode. An owner run must still not be a resume target for a later workflow loop-back.

## Acceptance criteria

- [ ] Plugin CLIs can fork a plugin agent into the project and move or reassign a project rule. Both reuse the existing core logic (no duplicate implementation), and maestro.json writes are read-before-write and preserve other slices.
- [ ] A fork made by the CLI and one made in the app's /agents produce identical provenance and sync verdicts. A rule moved by the CLI shows correctly in /rules.
- [ ] maestro-team-meeting applies approved fork and rule-move proposals with the CLIs after approval and after the meeting has closed. It only sends the user to the app when a CLI refuses.
- [ ] Tests spawn the real CLIs against temp projects for fork, rule move, refusal cases and slice preservation. The existing team-meeting suites still pass.
- [ ] A written evaluation of the MCP + channel bridge covers the listed constraints and ends with a build, defer or drop recommendation (and a first slice if build). It lives in this repo's developer documentation, not under plugins/.
- [ ] A test proves whether an owner run currently receives workflow HANDOFF routing and leaves stamped channel payloads. After the fix, owner runs get no routing, no payload instructions and no channel delivery, leave no stamped payload for a later workflow step, and are never resume targets.
- [ ] The plugin version is bumped per the publishing rules, and the developer concept skills are updated.

## Blocked by

None — can start immediately
