# First-install seed and chain detection

When no `maestro.json` exists yet, the canvas does **not** open empty. Main returns
`defaultV3Config(implAgents)`, which seeds the bundled agents as `workflow_instances` plus positioned
workflow nodes, and the payload carries `seeded: true` and the `RepoDetection` evidence together.
A corrupt or wrong-version file falls back instead to the empty `blankV3Config()`.

`implAgents` is the **repo-detected** implementation chain (`detectImplAgents()` in `src/core`) —
`["backend"]`, `["frontend"]`, `["backend","frontend"]`, and so on. `defaultV3Config` seeds one of
**two profiles**, decided by the private `isInfraOnlyChain(impl)` — read by both it and
`seededAgentNames`, so the agent list and the workflow set can never disagree about which agents a
seed has instances for:

| Chain | Agents seeded | Workflows seeded |
| --- | --- | --- |
| Anything other than exactly `["infra"]` (including infra + an application agent) | impl agent(s) + `test`, `reviewer`, `refactor`, `scribe` | six: `default`, `tdd`, `Refactor`, `Documentation`, `Review`, `Tests` |
| Exactly `["infra"]` | `infra` + `reviewer`, `scribe` — no `test`, no `refactor` | three: `default` (main-session → infra → human review → reviewer → scribe, both the reviewer code-issue route and the human-review correction route looping back to infra), `Review`, `Documentation` |

For the non-infra-only profile, `implAgents` sets the happy-path implementation step and, for
fullstack, splits the reviewer/refactor code-FAIL conditions per agent.

## The detected-chain banner

The detection evidence rides on the same payload and renders as `DetectedChain`
(`src/renderer/src/components/detected-chain.tsx`), with chips to correct it — `data:reseed` rebuilds
the seed around the corrected chain, in main, using the same `defaultV3Config`.

**`DetectedChain` renders only while `seeded`.** Once `maestro.json` exists the chain is the user's
saved answer, and re-proposing one would be offering to overwrite their graph.

## `infra` is a category, and the one exclusive one

`detectImplAgents` also recognises an infrastructure-as-code repository — a directory named
`terraform`/`infrastructure`/`iac`/`infra`, root-level `.tf`/`.tfvars` files, or a manifest unique to
one IaC tool (`Pulumi.yaml`, `cdk.json`, `serverless.yaml`, `Chart.yaml`, `ansible.cfg`).
`CONVENTIONAL_GLOBS` was widened with those same bare directory names so a repo that keeps its
Terraform one level down (not declared as a workspace member) still gets that subdirectory opened,
inside the existing `MAX_DIRS` cap — the directory name alone was already visible from the root
listing, but a `main.tf` inside it was not.

Unlike `backend`/`frontend`/`mobile`, `infra` is **not additive**: any infra signal makes
`implAgents` collapse to `["infra"]` alone, suppressing every application category detected in the
same repo, because an IaC repo's Python or JavaScript is almost always its own tooling rather than
the product. The evidence says so on two lines — one naming the infra markers matched, one naming
each application signal that was set aside and why (`… would suggest backend — set aside:
infrastructure takes precedence.`) — so a Python repo detected as infrastructure shows the Python was
noticed and overruled, not missed. `DetectedChain`'s correction chips are the same one-click fix here
as for any other detected chain. Because that suppression makes `["infra"]` the whole chain, an
infra-detected repo also switches which seed profile it gets (see the infra-only row above).

## Parity with the terminal path

`/maestro-install` seeds the identical config from the identical function, via the generated
`lib/maestro-seed.cjs` bundle — so a project seeded in a session and one seeded in the app are
byte-for-byte the same.
