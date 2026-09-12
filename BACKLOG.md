# Backlog

The `/update-single-concept-skill` should run the `cleanup-skill` skill after its done. This skill would make sure that the content is short enough, move to referenced files what is becoming a sub-concept (or something of it's own if it's not a concept skill)

Make subagents auto-compact at around 100-125k of context

In the project settings page in the app, add the parameter "Auto compact threshold" to control the autoCompactWindow

```
"autoCompactWindow": 125000
```
