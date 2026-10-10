# Evaluation: an MCP server and a channel between a Claude session and the Maestro app

**Recommendation: defer both.** The terminal CLIs added in `081` (`maestro-agent-fork.cjs`,
`maestro-rules.cjs`) already give a session every app action it was missing, over the same files the
app reads. The channel half is a research preview whose constraints (below) make it unusable for the
app's own sessions and awkward for everyone else. Revisit when channels leave research preview or an
org allowlist is a given. If it is ever built, the first slice is in the last section.

Reference for the channel facts: https://code.claude.com/docs/en/channels-reference. The channel
constraints below are as stated in the `081` task from that page; re-read the page before building
anything, since a research preview moves.

## What the two halves would be

| | MCP tools (Claude to app) | Channel (app to session) |
|---|---|---|
| Direction | a session calls the app | the app pushes an event into a running session |
| Carrier | a stdio MCP server registered with the project | a custom channel server, also a stdio subprocess |
| Example | "move this rule", "fork this agent", "open /workflows on this node" | "the user approved row 3", "the user saved the config" |
| Status | stable | research preview |

Neither server can be the app. Claude Code spawns it as a stdio subprocess of the session, so it is a
**bridge**: a small process that talks to the running desktop app over localhost and relays.

## MCP tools for Claude-to-app actions

What an app-side action needs that a CLI does not give: the app's **live in-memory state** (an
unsaved canvas, the selected node) and a way to make the **window** do something (navigate, focus).
Everything that is a write to project files already has a CLI that runs the app's own core code
(`saveConfig`, `applyRules`, `forkAgent`) with no app running:

| Action | Today | With an MCP tool |
|---|---|---|
| Fork an agent | `maestro-agent-fork.cjs` | same code path, no gain |
| Move or unassign a rule | `maestro-rules.cjs` | same code path, no gain |
| Apply a placement, a handoff edit | `maestro-team-meeting.cjs apply-placement` | no gain |
| Read the unsaved canvas | not possible | needs the app |
| Navigate the window / reveal a node | not possible | needs the app |

So the MCP value is the last two rows only: both are conveniences, neither blocks a workflow.

Costs and risks:

- **A second front door to the app.** The app's security design is preview, then token, then run:
  the prompt the user saw is the object that executes (`claude-preview.ts`, `claude-tokens.ts`). A
  tool that lets a session cause an app action skips the preview unless it is built to go through it.
  Any tool that writes would have to return a preview and wait for the user in the window, which
  makes it slower than the CLI it replaces.
- **Authentication.** A localhost listener in the app is reachable by every local process. It would
  need a per-launch secret handed to the bridge (an env var or a file readable only by the user),
  and the app must refuse any request without it. The existing token model is one-time and issued
  per previewed run; it is not a standing credential and should not be stretched into one.
- **Two versions.** The bridge ships with the plugin and the app ships separately. They would need a
  protocol version check, which is a new compatibility surface to keep.

## A channel for app-to-session events

What it would carry: "the user approved a proposal in the app", "the config changed under you".

Constraints, each of which is a reason to wait:

1. **Research preview.** The API and the flag can change or disappear.
2. **Opt-in every session.** A custom channel needs `--dangerously-load-development-channels` on each
   launch unless an org allowlists it. A feature that silently does nothing when the user forgot a
   flag is worse than not having it; the install flow cannot make it stick.
3. **It is a subprocess of the session.** The channel server is spawned by Claude Code over stdio, so
   the app cannot push to it directly. The bridge has to connect to the app (or the app to it) over
   localhost, with the authentication and version problems above.
4. **Sender gating.** A channel delivers events into the session as if they came from outside, so it
   needs a way to say who may send. The bridge would have to accept only the app, which loops back to
   the shared-secret question. Compare the app's own model: nothing reaches a run except through a
   token the app issued for a prompt the user was shown. A channel event is the opposite, an
   unsolicited message into a live conversation.
5. **Not in the app's own sessions.** The flag is ignored in non-interactive and Agent SDK sessions.
   The app's right-hand pane and its one-shot runs are Agent SDK sessions, so **the app can never
   receive its own channel events**. The channel could only serve a separate terminal session, which
   is the case where the user is least likely to be looking at the app.
6. **No delivery acknowledgement.** The app cannot know the event arrived or was acted on. Anything
   that matters (an approval) must therefore still be written to a file the session reads, which is
   the mechanism that works today.

Maestro's runtime already has an app-to-session path that avoids all six: the files in `.claude/`
(`maestro.json`, `maestro_sessions/<id>/session.json`, `.claude/channels/` for handoff payloads), read
by hooks at the next event. It is pull, not push, and has no acknowledgement either, but it needs no
flag, no listener and no secret.

## Recommendation

**Defer.**

- MCP: the only things it adds over the `081` CLIs are reading unsaved app state and driving the
  window. Not worth a listener and a secret yet.
- Channel: do not build while it is a research preview that needs a per-session flag and cannot reach
  the app's own sessions.
- Drop is not recommended: if channels become stable and allowlistable, "tell the running session
  what the user just decided in the app" is a real gap.

Triggers to revisit: channels leave research preview; or a plugin-delivered channel can be
allowlisted without a per-session flag; or a concrete workflow needs the unsaved canvas state.

## First slice, if it is built later

Smallest thing worth shipping, and nothing else:

1. A **read-only** stdio MCP server in the plugin with one tool, `maestro_app_state`, that asks the app
   over localhost for the active project, the selected workflow and whether the canvas has unsaved
   edits. No writes, so no preview bypass.
2. A per-launch secret: the app writes it to a user-only file under its own data directory and the bridge reads
   it; the app rejects requests without it and binds to loopback only.
3. A protocol version field, rejected on mismatch with a message telling the user to update.
4. No channel. Revisit it only after the read-only tool is in use and the triggers above hold.
