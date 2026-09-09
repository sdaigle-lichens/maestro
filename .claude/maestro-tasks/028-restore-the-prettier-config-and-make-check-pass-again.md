# Restore the prettier config and make `pnpm verify` pass again

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`pnpm verify` (`turbo run check typecheck test`) fails at `check`, and has failed since the repo was
imported. `011-make-prettier-check-pass.md` is marked done and its work is visible — `.prettierignore`
exists at the root, with the root-anchored patterns and the comment explaining why they are anchored.
What did **not** survive the import at `98b9582 feat: import Maestro app + plugin from ai-dev-tools`
is the `.prettierrc` beside it. `find . -name ".prettierrc*"` returns nothing, and it appears nowhere
in this repo's history.

That single missing file is most of the failure. With no config, prettier falls back to its own
defaults — `printWidth: 80` above all — and this codebase is authored at ~115–120 columns. Every
workspace that defines `check` therefore reports nearly every file, and the report is almost entirely
"this line is longer than 80 characters" about code that was never meant to be 80 columns.

Measured, counting only files reported (not the summary line):

| workspace | offenders at the 80-col default | offenders at `printWidth: 120` |
| --- | --- | --- |
| `apps/maestro` | 208 | 52 |
| `packages/ui` | 13 | 1 |
| `packages/styles` | 5 | 0 |
| `packages/claude-fs` | 5 | 0 |

The source repo's config is still readable at `/home/superadmin/gits/ai-dev-tools/.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "printWidth": 120,
  "trailingComma": "es5",
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

So this is two changes, and keeping them apart is the whole point:

**First, restore the config.** Two of the four workspaces go green on that alone, and it drops
`apps/maestro` from 208 files to 52. Do this as its own commit with no reformatting in it, so the
decision — *this repo is a 120-column codebase* — is reviewable without a five-thousand-line diff
under it. Confirm the restored values against `/home/superadmin/gits/ai-dev-tools/.prettierrc` rather
than inventing them; a different `printWidth` or `trailingComma` reformats the whole repo differently.

**Then reformat what genuinely differs** — the ~53 remaining files, which are real drift, not a
config artifact. This is mechanical, so the risk is not the diff but what the diff buries: land it on
a quiet tree, and do not mix it with behaviour.

Finish by making the failure impossible to ignore again. `check` is already in the `verify` task, and
that is exactly how this went unnoticed: `verify` has never passed here, so nobody reads its output,
which is the same failure mode `011` was written to prevent. A check that fails on day one is not a
check. Whatever you do — a CI gate, a pre-commit hook, or `format:check` on the files a commit
touches — the test is that a *newly* unformatted file fails loudly and a pre-existing one does not
drown the signal.

While you are here: the ignore scope is now slightly wrong in one direction. `.prettierignore`
deliberately root-anchors `/plugins/` so that `apps/maestro/.claude/skills/` stays in the enforced
set — but those `SKILL.md` bodies are hand-formatted prose for the same reason the plugin ones are,
and prettier reflows their tables and line breaks. Decide whether concept-skill markdown belongs in
the enforced set at all, and record the answer in the ignore file's comment either way.

## Acceptance criteria

- [ ] A root `.prettierrc` exists, its values match the imported repo's, and a short comment or
      commit message records that it was lost in the import rather than chosen now
- [ ] `pnpm verify` passes from a clean checkout — `check`, `typecheck` and `test` all green
- [ ] The config restoration and the bulk reformat are separate commits, so the mechanical diff does
      not hide the decision
- [ ] A fresh `pnpm build` followed by `pnpm verify` still passes — build output stays excluded
- [ ] No behavioural change: every existing test suite passes unchanged, and the app still builds and
      launches
- [ ] A newly unformatted file fails the check loudly enough that it is noticed before merge
- [ ] Whether concept-skill markdown under `.claude/skills/` is formatted or ignored is a recorded
      decision in `.prettierignore`, not an accident of pattern anchoring

## Notes for whoever picks this up

Do not run `prettier --write` across the repo before restoring the config. Reformatting at the
80-column default rewrites essentially every file in the codebase and is very hard to undo once it is
mixed with real work — it was tried during the `/agents` redesign and had to be reverted from a
backup.
