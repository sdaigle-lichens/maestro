---
name: confidence-check
description: Pre-execution confidence assessment with scoring rubric and go/no-go gates.
allowed-tools: Read, Grep, Glob
user-invocable: false
---

# Confidence-Check Protocol

Before starting any implementation, you must perform a self-assessment to calculate your **Confidence Score (0.0 - 1.0)**. Return the score following the "Mandatory Output Format" section bellow.

## Evaluation Criteria

Assess your readiness based on these four pillars (+0.25 each):

1.  **Context Discovery:** Have you verified the existing file structure and ensured you aren't duplicating logic?
2.  **Architecture Alignment:** Is the plan compliant with the project's tech stack and established patterns?
3.  **Root Cause / Intent:** For bugs, is the root cause identified? For features, is the user's intent 100% unambiguous?
4.  **Verification Plan:** Do you have a specific test or command ready to prove success?

> **Skills before source.** When assessing Context Discovery and Architecture Alignment, check the available skills list first: if a project skill documents the file or logic you are about to open, read that skill before diving into source. It usually confirms what already exists, how it is structured, and the established pattern without a file-by-file dive — don't rediscover from code what a skill already explains.

## Execution Gates

- **Score >= 0.9:** Proceed. Output a brief "Reasoning Chain" and the score, then start.
- **Score 0.7 to < 0.9:** Present the score and a "Risk List." Ask the user for one specific clarification before proceeding.
- **Score < 0.7:** **STOP.** List the specific unknowns and wait for user guidance.

## Mandatory Output Format

**Confidence Score:** [Score]  
**Reasoning:** [1-2 sentences on why this score was given]  
**Plan:** [Brief bullet points of the next steps]

---

For complex tasks, think through edge cases before finalizing the plan.
