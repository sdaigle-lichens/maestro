# The pane in the renderer

Main keeps one live session per `webContents.id`. Two renderer-side decisions are what make that
survive a real window, and both fail silently rather than loudly.

## Where the provider lives, and why it is not negotiable

**`SessionProvider` sits in `__root.tsx`, above the route `Outlet` and a sibling of the route column
— not inside `TopNav`, and not owned by any one route.** The reason is structural: `TopNav` remounts
on every navigation (each route mounts its own copy), so a transcript or a live session id held there
would be discarded the instant the user clicked to another page — and losing the session id mid-turn
leaves Claude running with no Stop button left to press. Placing the provider at the root, inside
`ProjectProvider` (so a project switch ends the session) and beside the `Outlet` rather than under
it, is what lets the pane survive navigation and shift the layout instead of disappearing with the
page that opened it.

`utils/session-context.tsx` is the **only** module in the renderer allowed to touch
`window.maestro.session` — single-owner, exactly like `SessionLogProvider` and the log tail, and for
the same reason: main keeps one session per `webContents.id`, so a second subscriber would steal it.

## Clear the transcript BEFORE a resume round trip, never after

Main pushes the resumed session's notice **during** the `session:resume` call, so `setEntries([])`
after the `await` deletes the one thing saying what was picked up, what it cost, and that it forked —
and the pane looks as though it started a session silently. Nothing errors, no test catches it, and
it's only visible in a real window. `session-context.tsx` clears at line ~496, before the `callMain`,
with a comment saying so.

The same ordering applies to **any** channel where main streams an event while the handler is still
resolving.

Files: `src/renderer/src/routes/__root.tsx`, `src/renderer/src/utils/session-context.tsx`.
