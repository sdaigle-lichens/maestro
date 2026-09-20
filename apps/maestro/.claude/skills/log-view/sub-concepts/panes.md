# The three panes

All three render the same `instances` array and `activeInstance` for whichever tab is selected; none of
them knows a tab bar exists above them. Clicking a step in any pane selects it in all three.

## Left pane — step list (`session-log-cards.tsx`)

A thin (180px) vertical list of step names with status icons. Each row:

- **Status icon** (from `lucide-react`):
  - `"success"` → `CircleCheck` in `text-(--green)`
  - `"condition"` → `CircleX` in `text-(--red)`
  - `"unknown"` → `AlertTriangle` in `text-(--yellow)`
  - `"transition"` → hollow `Circle` in `text-(--ink-3)` (neutral — a non-workflow boundary, not an error)
  - Main Session (`status: null`) → `CircleCheck` in `text-(--green)` (default)
- **Click** → `onSelect(id)` → `setActiveId(id)` + `scrollIntoView` on the matching center-pane section.
- **Active step** → `font-medium` + a `border-b-2` underline colored by status (green/red/yellow).
- **Skills badge** (right-aligned, only when `inst.skillsTriage` is set) → compact `<loaded>` in
  `--green`, `/<skipped>` in `--yellow`, and `/<unaccounted>` in `--red`. Lets you scan which steps
  skipped or silently dropped skills without opening each detail panel.
- **Delivery count** (`037`) → an `Inbox` icon + `inst.delivered.length` when non-zero, the same
  at-a-glance class of signal as the skills badge. Omitted when `delivered` is empty.

## Center pane — framed log (`session-log-view.tsx`)

A header row ("Agents Flow" + `● live` indicator) above a scrollable body of per-instance sections. Each
section is wrapped in a **rounded bordered frame** (`border rounded-lg p-4`):

- **Click** anywhere in the frame → `onSelect(id)` → selects the step across all panes.
- **Selected frame** → `border-2` colored by status: `border-[var(--green)]` / `border-[var(--red)]` /
  `border-[var(--yellow)]` / `border-[var(--line-2)]` (transition, neutral).
- **Default frame** → `border border-(--line)`.
- Content: humanized log lines via `humanizeLog(entry)`.
- **Section header** shows the `displayName` and, when `inst.skillsTriage` is set, a
  `<N> loaded · <N> skipped · <N> unaccounted` badge (green / yellow / red — each segment shown only
  when non-zero). It also shows a delivery count (`037`), the same value as the left pane's badge.

## Right pane — detail panel (`session-log-detail.tsx`)

Shows the selected instance's data in sections:

- **Header:** "Logs: {displayName}"
- **Input:** the instance's `input` field — the full spawning message sent by the main session —
  followed by each entry in `inst.delivered` (`037`), rendered as "Delivered from @`<sender>`" plus a
  "channel" badge and the content verbatim in a `<pre>` block, in log order. Renders nothing extra when
  `delivered` is empty; shows "No input captured" for main_session instances or when there is neither a
  dispatch entry nor a delivery.
- **Process:** the humanized log lines (same content as the center pane section for this step).
- **Skills Triage:** (only when `instance.skillsTriage` is set) **Loaded** render as green chips;
  **Unaccounted** (`unaccountedSkills(instance)`) render as red chips; **Skipped** render as
  `id — reason`, with a hollow reason (`< 8` chars) flagged in `--yellow`. Hollow reasons surface lazy
  _explicit_ skips; red unaccounted chips surface skills the agent dropped _silently_. See
  `log-entry-schema.md` for how the two sides of that diff are produced.
- **Output:** the instance's `output` field — the agent's full final message including the HANDOFF line.
  Shows "No output captured" for main_session or when no handoff entry exists.
- When no step is selected, shows "Select a step to view details".

## Things that bite

- **Large messages in `input`/`output`.** A spawning message that includes injected skills + handoff
  templates can be several kilobytes. The right detail panel sections are scrollable. The JSONL file
  stores the full messages; that's intentional for debugging fidelity.
- **`--yellow` color token.** Added in `packages/styles/scss/abstracts/_tokens.scss` alongside
  `--green`/`--red`. Used for "unknown" status (subagent with no parseable HANDOFF line). Both light and
  dark mode variants exist.
