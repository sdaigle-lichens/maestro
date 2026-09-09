---
name: use-code-architecture-design-check
description: Pre-design gate. Evaluates whether the current task requires running the code-architecture-design skill before implementation.
allowed-tools: Read, Grep, Glob
user-invocable: false
---

# Design Confidence Check

Before starting any implementation, run this check to decide whether `code-architecture-design` must run first. Create a task per step below with `TaskCreate` before you start, so the sequence survives a long session.

## 1. Concept-skill list

Run the `load-concept-skills` skill.

If it reports **NO LIST**, this project has no concept-skill list — reason about concepts directly from the codebase instead, checking the available skills list first (a project skill may already document the relevant pattern) before opening source files.

## 2. Evaluate

Answer each question YES or NO:

1. **New or removed concept?** Does the task add a capability that is not an instance of any existing concept (concept skill, or an established pattern if there's no list) — or remove one that is?
2. **Concept-changing?** If the task touches an existing concept, does it change that concept's shape or contract, rather than following it as an inline instance?
3. **Ambiguous architecture?** Are there multiple valid approaches whose choice meaningfully affects codebase structure?

## Decision Gate

| New/removed concept | Concept-changing | Ambiguous architecture | Decision                        |
| ------------------- | ---------------- | ---------------------- | ------------------------------- |
| YES                 | any              | any                    | **RUN code-architecture-design**  |
| NO                  | YES              | any                    | **RUN code-architecture-design**  |
| NO                  | NO               | YES                    | **RUN code-architecture-design**  |
| NO                  | NO               | NO                     | **SKIP code-architecture-design** |

**Always SKIP `code-architecture-design` when:**

- The change is a straightforward instance of an existing concept (another route on an existing resource, another screen following an existing navigation pattern, another component following an existing design pattern, etc.)
- A sibling file or an existing concept skill is a direct template for the change

`code-architecture-design` is this plugin's architecture pass — invoke it with the Skill tool. It is **not** `/design`, the Claude Design canvas skill, which produces visual mockups and is not what this gate decides about.

## Mandatory Output Format

**Decision:** RUN code-architecture-design | SKIP code-architecture-design
**Reasoning:** [1–2 sentences explaining which criteria were met or not]
