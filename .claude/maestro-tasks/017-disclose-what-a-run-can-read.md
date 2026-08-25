# Disclose what a run can read before it runs

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The confirmation dialog already tells the user what a run may **write**. It says nothing about what
the run can **read**, and reads are the larger surface: file reads and searches are auto-approved by
the permission system and never raise a prompt, so the directory list handed over at spawn is the
only thing bounding what Claude can see.

Add the read scope to that disclosure, next to the write targets. It is fully known before anything
starts, so this costs nothing structurally — leaving it implicit means the app silently grants read
access to whatever it happened to pass.

Make the disclosure **true**, not merely plausible. The effective configuration of a session is a
merge of what the app passes with settings files on disk, and those files can contribute permission
rules and extra readable directories that the app never chose. Resolve the effective settings and
report where each value came from, rather than echoing the app's intent and hoping nothing else
applied. The SDK exposes this resolution without spawning anything.

This also fixes a real asymmetry: a create run's working directory is the *target* — a marketplace
repo — not the open project. Correct for writing, backwards for exploring. Say so plainly, so the
user can see that a run may read one tree and write into another.

Worth doing before the run path changes underneath it: the dialog should be honest about the current
behaviour first, so the next slice's change is visible as a narrowing rather than arriving with it.

One thing the target may already be: `016` moved repository setup into the deterministic scaffold, so
a create-marketplace prompt now carries a line stating the repository state — created here, already
inside one, or no `git` on this machine — derived from disk rather than from the payload. The
directory this dialog is describing may therefore already be a git repository with the scaffold
committed, before anything runs.

## Acceptance criteria

- [x] The confirmation dialog lists the directories a run can read, alongside what it may write
- [x] Read and write scope are visibly distinct, including the case where a run reads the open project and writes into a marketplace
- [x] The disclosure reflects the *effective* configuration, including anything contributed by settings files, not just what the app passed
- [x] Where a value came from is available to the user rather than being flattened into one list
- [x] The disclosure is derived in the main process; no directory is nominated by the renderer
- [x] Cancelling still leaves the scaffolded artifact untouched on disk, including the git repository the scaffold made for it

## Blocked by

- `015-externalize-the-agent-sdk.md`

## What landed

Done. The disclosure is `ClaudeReadScope`, derived by `src/core/read-scope.ts` (`buildReadScope`,
`withinDirectory`, `RULE_DISPLAY_CAP`) from a settings snapshot the main process resolves, and
rendered by **one** component, `src/renderer/src/components/read-scope.tsx`.

Three things diverged from the plan above:

- **It was not only the create-flow dialog.** The help chat's inline `ConfirmCard` had the same
  omission in a sharper form — it said the run "is not given permission to edit files", true about
  writes and silent about reads. Both confirmations now render the same `ReadScope`; its `compact`
  prop changes the type scale, never the content. The chat's sentence gained "— but it can read
  everything listed below."
- **`previewClaudeRun` became `async`**, and takes `PreviewOptions extends ResolveOptions
  { settings?: SettingsPort }`. Every caller must `await` it, including `src/main/ipc.ts`.
- **`ClaudeRunDialog` was restructured into one scroll region**, in scope by necessity. Per-section
  shrink-to-fit broke the moment a fourth section arrived: flex squeezed the prompt `<pre>` to a
  sliver and the read section rendered over the top. A rect-overlap assertion in the window probe
  pins it now.

Rules this slice established, in the order they matter:

- **The settings resolution is a PORT, not an import** — `SettingsPort` in `contracts.ts`,
  `nodeSettings()` in `src/core/agent-sdk.ts`, injected at `src/main/ipc.ts`. `claude-preview.ts`
  must import nothing that can start a process, and the SDK can shell out to `plutil`/`reg.exe` for
  MDM policy. `agent-sdk.ts` is still the only module that imports the SDK.
- **Never reimplement the cascade.** The SDK's `resolveSettings` is the merge engine.
  `settingSources` is deliberately left **unset** in `resolveEffectiveSettings()` (loads every tier)
  because that is what a `claude -p` run gets; the smoke query passes `[]` for the opposite reason.
  `defaultMode` goes through `filterEscalatingDefaultMode`, since the raw cascade reports an
  escalating mode from a repo-committed file as though it applied.
- **Provenance is never flattened.** Every directory and every rule carries its tier and its file.
- **Unresolved ≠ empty.** A cascade that cannot be read still yields a scope naming the cwd, with
  `unresolved` set — a scope that quietly reported only the cwd would read as a complete answer.
- **Resolved against the RUN's cwd, not the open project.** Verified in the window: a
  marketplace-targeted create run picks up the *marketplace's* `.claude/settings.json`.

The reviewed lists in `test/isolation.test.ts` did **not** widen — no new spawner, no new
`resolveClaudeCli` caller; the port is what kept them unchanged. Two assertions were added there:
the settings-port wiring at the composition root (it fails *silently* if dropped — the dialog just
starts saying the settings were not consulted), and that the renderer nominates no directory of its
own. `test/core/read-scope.test.ts` covers the derivation.
