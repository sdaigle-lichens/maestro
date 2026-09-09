# Add infra as an eighth bundled agent

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Introduce `infra` as a bundled Maestro agent: the developer for declarative infrastructure repositories (Terraform, Pulumi, CDK, Ansible, Helm, Kubernetes manifests).

Two halves.

**The agent definition.** `plugins/maestro/agents/infra.md`, written to the same shape as the existing bundled agents — frontmatter `name`/`description`, the skill-triage paragraph, a Boundaries section — with its report body stripped out and seeded in `report-defaults.ts` the way the other implementation agents' bodies are. What makes it different from the other implementation agents: the seeded IaC workflow (slice 3) has no separate testing step, so verification is part of this agent's own job. Its definition must own the declarative-infra verification loop — format, validate, lint, and a plan/diff whose output it reports rather than acts on — and its Boundaries must be explicit that it never applies, destroys, or otherwise mutates live infrastructure; a human approves before anything reaches a real environment. That boundary is the reason the workflow puts a human review step between it and the reviewer.

**Registering it everywhere the bundled seven are enumerated.** Six machine-wide stores under `~/.claude` each carry their own list, and an agent missing from any one of them is silently half-registered:

- `agent-types.ts` — classified `developer`, alongside the three application stacks.
- `agent-project-tags.ts` — its own project tag, the pattern the three stacks already follow.
- `project-tags.ts` — the seeded tag catalog, which today holds exactly the three categories detection looks for.
- `report-defaults.ts` — the report body stripped from the agent file above, seeded as its version-1 default.
- `skill-tags.ts` — the tag vocabulary, so a project skill can be routed to this agent.
- `handoff-seeds.ts` — the `handoff_details` payload shapes for the routes the seeded IaC workflow will actually walk (slice 3 fixes which those are: the implementation agent's handoff onward to review, and the reviewer's handoff to the documentation step).

Each of these stores seeds on first read and has an existing per-agent pattern to copy; none should grow a new mechanism.

At the end of this slice nothing detects an IaC repository yet and no workflow references the new agent — it is registered and selectable, and that is the whole of it.

Note: an agent carries exactly ONE project tag — that is deliberate, not a limitation to work
around. Seed the new agent with its own category as a single value, not `"global"`.

Note: this slice changes published plugin surface (`plugins/maestro/agents/`), so it carries a `plugin.json` version bump per the repo's rule. A new agent is the published surface growing, so the bump is minor.

## Skills to use

Load these before you start — they carry what this task needs, and reading them beats
rediscovering the same thing from source:

- `global-stores` — the six machine-wide stores this registers the agent in, and why each is global rather than per-project
- `create-subagent` — authoring the agent file itself — frontmatter, body, and where it lives
- `plugin-libs-parity` — the generated bundle behind those stores, and why it must never be hand-edited
- `updating-maestro` — which version component to bump, and why nothing reads its magnitude

## When you're done

End by handing off to the **@scribe** agent with the `scribe` skill loaded. It is the routing rule
for what belongs in a concept skill versus in `docs/`, and it has to be in context before anything
is written. This slice changes behaviour that the concept skills already describe, so updating them
is part of the change rather than a follow-up.

## Acceptance criteria

- [ ] `plugins/maestro/agents/infra.md` exists and matches the structural shape of the other bundled agent files — frontmatter, skill-triage paragraph, Boundaries — with no report body inline
- [ ] The agent's definition covers the declarative-infra verification loop (format, validate, lint, plan/diff) and its Boundaries state plainly that it never applies or destroys live infrastructure
- [ ] A fresh store file seeds the new agent in all six places: agent types (as a developer), agent project tags, the project-tag catalog, report defaults, the skill-tag vocabulary, and the handoff seeds
- [ ] The stripped report body seeded in report defaults matches what was removed from the agent file
- [ ] Existing assertions about the bundled seven still pass, updated only where a count or an exhaustive list genuinely had to grow
- [ ] `plugin.json` version is bumped minor, and the bump is the only version change in the slice
- [ ] Handed off to the @scribe agent with the `scribe` skill loaded, and the concept skills this change affects are updated

## Blocked by

None — can start immediately
