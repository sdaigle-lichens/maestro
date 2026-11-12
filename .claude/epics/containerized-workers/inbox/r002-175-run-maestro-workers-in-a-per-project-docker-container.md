# Report r002: 175-run-maestro-workers-in-a-per-project-docker-container.md

- Task: 175-run-maestro-workers-in-a-per-project-docker-container.md
- Written: 2026-11-12T17:21:37.481Z
- From session: containerized-workers-175

# Report update: task 175, secret-in-image fix and real-Docker checks

Commit: 32a0a4b on task-175 (on top of 85463b7). Verified: `pnpm verify` green on 32a0a4b (173 test files; parity 44/44 after `pnpm refresh:runtime`). Plugin version stays 0.15.7.

## What the first Docker run found, and the fix
The first real image build copied whole marketplace dirs, which baked `/home/worker/.claude/plugins/marketplaces/code-graph/.env` into a layer (and made an 815 MB build context). I did not read that file. Fix (32a0a4b): marketplace dirs and plugin cache copies are copied git-tracked-files-only where the dir is a git repo, and in every case with `.git`, `node_modules`, `.env*` (any depth), `.npmrc`, `.credentials.json`, `*.pem` and `id_rsa*` excluded; a `.dockerignore` with the same names goes into the context; image layout marker 2 -> 3. New unit tests cover a fake marketplace holding each excluded file.

## Image cleanup
Removed `maestro-worker-maestro:e329e81c1b31` (the only image built from the context that held the `.env`). Pre-existing `maestro-worker-probe:latest` and two dangling images (created Apr 2026 and Sep 2025) are not from this task's builds and were left alone.

## Checks (all on the fresh build `maestro-worker-maestro:1ba1aab29bc6`, real daemon, shell containers only, never claude)
| Check | Result | Evidence |
|---|---|---|
| Image build | PASS | built; build context 8 MB (was 815 MB) |
| Reuse on unchanged inputs | PASS (first build) | the unchanged `image` run on e329e81c1b31 printed "up to date; reusing it"; tag for 1ba1aab29bc6 is stable across `--print-tag` runs |
| Rebuild on a changed plugin version | PASS (tag level) | scratch HOME with code-graph 0.3.44 -> 0.3.44-scratch gives tag 160bc136831f instead of 1ba1aab29bc6, and no image with that tag exists, so `image` would build. The full scratch build was not run (its plugin cache dir does not exist). |
| No secret in image history | PASS | `docker history --no-trunc`: 0 matches for oauth_token/sk-ant/secret |
| No dotenv, credential, key, .git or node_modules anywhere in the image fs | PASS | whole-fs `find`: only `/usr/lib/ssl/cert.pem` (the OS CA bundle) and npm's own `/usr/local/lib/node_modules/npm/.npmrc`; no `.git` or `node_modules` under /home/worker; no `sk-ant-` or `CLAUDE_CODE_OAUTH_TOKEN=` pattern |
| Six read-only paths unwritable (first run, unchanged by the fix) | PASS | all writes failed; `.claude/hooks` does not exist in this project |
| Hooks-free settings.local.json copy in place | PASS | no "hooks" key, every other key kept |
| Worktree dir at its host path; ownership | PASS | written in-container, owned `superadmin (1000)` on the host |
| Hook commands run, no missing module | PASS | 21 commands incl. code-graph Stop/SubagentStop, 0 missing-module errors (run on the first image; the ts-morph install layer is unchanged) |

## Caveats
- A marketplace whose needed files exist only untracked or git-ignored (e.g. untracked build output) is now missing them in the image.
- The code-graph hooks ran with `--hook`, which may exit before loading ts-morph.
- The read-only, ownership and hook checks were not repeated on 1ba1aab29bc6; only the image content layers changed (marketplace/cache copies).

## Still open (left to task 176's docker worker, as directed)
No prompts up to the first human review, plugin loading, worktree trust, TTY, the inbox-write prompt, sandbox-off.
