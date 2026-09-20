# The marketplace repository (create-marketplace only)

A new marketplace is a git repository, and the scaffold makes it one. This used to be a sentence in
the prompt — so whether the directory ended up a repository depended on whether a run happened and
did as it was told. It is a step in the same all-or-nothing list now:

```
dir → repo (git init -b main) → marketplace.json → README.md → plugins/ → commit
```

`init` is **first** and `commit` is **last**, and that ordering is load-bearing (see the rollback
rule below). A skill, a subagent or a plugin gets no repo steps at all: those are written _into_ a
repository somebody else already owns.

`planRepo()` decides up front which of **three states** applies, and reports it on the result as
`ScaffoldResult.repo` = `{ initialized, root, note }`:

| State                             | `initialized` | `root`     | What it means                                          |
| --------------------------------- | ------------- | ---------- | ------------------------------------------------------ |
| A repository was created here     | `true`        | the target | `git init` ran and the scaffold is committed           |
| The target was already inside one | `false`       | that repo  | do not nest; `enclosingRepo()` found a `.git` above it |
| No `git` on this machine          | `false`       | `null`     | the marketplace is complete; the user runs `git init`  |

**None of the three is a failure** — the marketplace on disk is complete and usable in all of them,
which is why this is a field on a successful result rather than a reason on a failed one.
`create-result.tsx` renders `repo.note`; `create-marketplace/SKILL.md` opens with a **"Do not run
git"** section and reads the reported state rather than probing for it. Remotes, private-repo
credentials and auto-update are deliberately **not** here: they need a host, an account and secrets
the app has not got, so they stay conversational and the skill offers them (never silently).

## Three rules hold it together

- **The capability is a port, not an import.** `claude-preview.ts` imports `scaffold.ts` for
  `resolveCreateTarget`, and `test/core/claude.test.ts` walks the preview's transitive import graph
  to prove it cannot start a process — one `child_process` anywhere in that graph costs the
  guarantee. So `GitPort` is an interface in `contracts.ts`, `nodeGit()` implements it in
  `src/core/git.ts`, and `src/main/ipc.ts` injects it. Omitting the port is not an error: it means
  "this caller does not do repositories". Which is exactly why the wiring is **pinned** in
  `test/isolation.test.ts` — the capability could otherwise go missing in a diff that still passes
  every test under `test/core/`.
- **A decision that must survive a missing tool is made with `fs`, not with the tool.**
  `enclosingRepo()` in `src/core/repo.ts` walks up looking for `.git` — never `git rev-parse`, which
  needs the binary and answers about the _process's_ cwd when the directory it was pointed at does
  not exist yet. That is this case exactly: the scaffold asks before it creates the marketplace.
- **Git steps roll back only themselves; every other step rolls back everything.** A `git commit`
  failure removes the half-made `.git` and is _reported_ — a marketplace without a repository is
  precisely what a machine with no git gets. But a failure of any _other_ step after `git init` does
  take the repository with it. Hence `init` first, `commit` last.

## Things that bite

- **`src/core/git.ts` is a _sixth_ entry on the reviewed spawner list in `test/isolation.test.ts`,
  and the list got wider on purpose.** What moved out of the prompt was the shell in the **session**,
  not in the app: the app runs `git` itself, `execFileSync` with an argument vector and no shell
  interpretation, so a marketplace name with a quote in it cannot become syntax. One more module
  that can spawn, in exchange for taking `Bash` out of the create-marketplace conversation. It is
  **not** a path to Claude — the neighbouring note about the `resolveClaudeCli` caller list is a
  different list.
