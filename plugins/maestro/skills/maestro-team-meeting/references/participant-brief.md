# Participant prompts

Fill in `<…>` with the values from `TM start` and `TM brief`. Keep the prompts short: the brief
files carry the content, and the hook injects the meeting rules on every turn.

## Round 1

```
Maestro team meeting, round 1 (<mode>).

Read <brief path> and then <your slice path>. From your role's point of view, propose changes to the
Maestro setup that would make workflows cheaper (fewer calls, smaller contexts), more fluid (fewer
loop-backs and human stops) or more reliable. Back every proposal with evidence.

Write your proposals to <meeting dir>/round-1/<agent>.json using the schema in the brief. Zero
proposals is fine — write the file with an empty list. Do not change anything else.
End with one line: how many proposals you wrote.
```

In post-mortem mode, add: `You ran in this session's workflow — use what you saw in that run as
your main evidence.`

## Round 2 (conflicting agents only)

```
Maestro team meeting, round 2. Other agents proposed different changes to targets you also
proposed on:

<for each conflict: target, then each agent's id and change>

Reconsider. Write <meeting dir>/round-2/<agent>.json with the FULL list of proposals you still
stand behind (it replaces your round-1 file): keep, amend, or adopt another agent's change
(same kind and change text counts as agreement), and list ids you drop in "withdrawn".
End with one line.
```
