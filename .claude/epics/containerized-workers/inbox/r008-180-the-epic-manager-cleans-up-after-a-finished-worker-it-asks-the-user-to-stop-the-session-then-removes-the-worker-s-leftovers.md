# Report r008: 180-the-epic-manager-cleans-up-after-a-finished-worker-it-asks-the-user-to-stop-the-session-then-removes-the-worker-s-leftovers.md

- Task: 180-the-epic-manager-cleans-up-after-a-finished-worker-it-asks-the-user-to-stop-the-session-then-removes-the-worker-s-leftovers.md
- Written: 2026-11-13T20:32:49.195Z
- From session: containerized-workers-180

## Outcome

Task 180 is done on branch `task-180`, commit e62f8fd (on top of f677e03 and 7ba38a4). This replaces r007. Nothing is merged or pushed.

## Verified

The full suite is green on the code tree of e62f8fd: 3480 tests in 178 files. The root `pnpm check` and `pnpm lint`, and the maestro check, typecheck and lint, are clean. Parity passes and the plugin scripts match their `.claude/scripts` mirrors. After e62f8fd I changed only epic records (state.json, inbox).

## Your live finding, fixed

You ran `prune --dry-run` on the real daemon and it failed on the pre-label images with `map has no entry for key "Labels"`. The stub tests did not model it. Cause: the inspect template read `.Config.Labels`. A real daemon errors on that for an image with no Labels map. It errors even for `{{json .Config.Labels}}` when other fields share the template. The launcher now inspects with `{{.Id}}|{{.Size}}|{{json .Config}}` and reads `.Labels` in JS. A missing or non-string label means unlabelled.

The docker stub now evaluates the `--format` template like docker does, so the old templates fail in it with the same error. A new launcher test uses pre-label images and asserts exit 0, a `docker rmi` line each, and no removal call, in both real and dry-run mode.

The review also found that an unreadable inspect line was silently treated as unlabelled. That is fixed. It is now named `could not inspect image <ref>: unreadable inspect output`, exits 1 and is never removed. A garbled current tag blocks every removal. Tests cover this in real and dry-run mode.

## Live `prune --dry-run` on this daemon (exit 0, nothing removed)

```
maestro worker prune: nothing was removed
skipped maestro-worker-maestro:a35a50566c04 (731.6 MB): not labelled for this project, so not proven to be its image; to remove it yourself run: docker rmi maestro-worker-maestro:a35a50566c04
skipped maestro-worker-maestro:bf3bc6f5215e (709.2 MB): not labelled for this project, so not proven to be its image; to remove it yourself run: docker rmi maestro-worker-maestro:bf3bc6f5215e
skipped maestro-worker-maestro:cf763d650e2e (281.0 MB): not labelled for this project, so not proven to be its image; to remove it yourself run: docker rmi maestro-worker-maestro:cf763d650e2e
```

The same command run with the previous template against this daemon exited 1 on all three images, which reproduces your output. The current tag, `maestro-worker-maestro:90d6fb2c5010`, is not built on this daemon, so no `kept` line appears.

## Not covered

- A labelled worker image, kept or removed, was never exercised live: none exists on this daemon, and creating one is a write. It is covered only by the stub.
- Three edge cases have no test and were judged safe in review. A Labels value that is not an object counts as unlabelled. An `id|size`-only line is reported unreadable. A non-numeric size counts as 0 bytes, which affects only the freed total.
- A stopped worker container on an untagged image is still never listed, as in r007.

## Suggested ticket changes

- A ticket for a command that parses an external tool's output should require one live run against the real tool in its acceptance criteria. Stubs alone missed this.
