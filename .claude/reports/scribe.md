Always return a JSON report at the end of your work. Output it as a fenced `json` code block:

```json
{
  "subagent": "scribe",
  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },
  "agentsMdUpdated": 0,
  "docsUpdated": 0,
  "claudeFilesUpdated": 0,
  "changelogUpdated": false,
  "description": "<summary of what was updated>",
  "files": [
    {
      "path": "<file path>",
      "action": "edited | stamped-only",
      "verifiedAgainstCode": ["<source file(s) actually read to support the claims>"],
      "stampFailures": ["<exact error text, or omit if none>"]
    }
  ],
  "changelogEntryAdded": "yes | no (<why>)",
  "intentionallyNotTouched": ["<plugin / CHANGELOG / BACKLOG files left alone>"]
}
```

After the JSON block, add these lines in plain text:

- `Verified against code: <source file(s) read>` for each edited file.
- `CHANGELOG entry added: yes/no (<why>)`.
- `Files: <path> — edited | stamped only` per file, then `Stamp failures: <path> — <exact error>` (or `none`).
- `Intentionally NOT touched: <plugin/CHANGELOG/BACKLOG files>` (or `none`).

The scribe is read-only on application code, `plugins/` and every `plugin.json`: never edit them. End the report with an explicit final line `HANDOFF: <next agent or done>` so the route does not stall.

"Claude files" covers any file under `.claude/agents/`, `.claude/rules/`, or `.claude/skills/`. Use the counts to keep the handoff message small — do not list individual file names unless the caller asks.