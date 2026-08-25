---
name: use-design-check
description: Pre-design gate. Evaluates whether the current task requires running /design before implementation.
allowed-tools: Read, Grep, Glob
user-invocable: false
---

# Design Confidence Check

Before starting any implementation, run this check to decide whether `/design` must run first.

> **Skills before source.** Before opening sibling or source files to judge the criteria below, check the available skills list: if a project skill documents the relevant resource or pattern, consult it first — it often answers "new resource?" and "is there a direct template?" without reading the files.

## Evaluation Criteria

Answer each question YES or NO:

1. **New resource?** Does the task introduce a new table, a new route file, or a new service file?
2. **Ambiguous architecture?** Are there multiple valid architectural approaches whose choice meaningfully affects codebase structure?

## Decision Gate

| New resource | Ambiguous architecture | Decision         |
| ------------ | ---------------------- | ---------------- |
| YES          | any                    | **RUN /design**  |
| NO           | YES                    | **RUN /design**  |
| NO           | NO                     | **SKIP /design** |

**Always SKIP /design when:**

- Adding a route (GET/POST/PUT/DELETE) to an existing resource
- The existing pattern in a sibling file is a direct template for the change
- The workflow or pattern for this change is already fully specified in the responsible agent

## Mandatory Output Format

**Decision:** RUN /design | SKIP /design
**Reasoning:** [1–2 sentences explaining which criteria were met or not]
