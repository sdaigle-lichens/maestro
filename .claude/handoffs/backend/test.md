If the change classifies free text (regexes, label parsing, prefix or keyword checks), write the grammar BEFORE coding and carry it in `grammar`: the accepted forms, the rejected forms, and one example of each. @test derives its edge sweep from this grammar, so a form missing from it is a form nobody tests. Use `"grammar": null` when nothing classifies free text.

```json
{
  "hintsOnly": "Implementer hints, not the test scope. Derive your test plan from the ticket's acceptance criteria and the code first, then check these hints against it. They never narrow what you test: this list is biased toward what the implementer already handled, and the gaps are what it did not think of.",
  "filesChanged": ["<added|removed|renamed|modified> <path>, or 'none'"],
  "grammar": {
    "classifies": "<what free text is classified, and by which function/regex>",
    "accepted": ["<accepted form, described as a rule>"],
    "rejected": ["<rejected form, described as a rule>"],
    "exampleAccepted": "<one concrete input that is accepted>",
    "exampleRejected": "<one concrete input that is rejected>"
  },
  "behaviors": [
    {
      "behavior": "<function/endpoint/store method — expected behavior, tested through the code that consumes it (a file merely existing on disk does not prove it is delivered or used)>",
      "failureModes": ["<empty/closed input | missing row | conflict | stale generated copy | edge input | ...>"],
      "files": ["<source files the behavior lives in>"]
    }
  ],
  "notHandled": ["<case the implementation deliberately does not handle or left as an open decision, or 'none'>"],
  "howToRun": ["<the project's own recipe or script that runs the relevant tests with their environment, never the raw tool under it; or 'none: no tests for this part yet' — never a test framework, runner or structure to create>"],
  "preHandoffChecks": [{ "command": "<exact command run>", "result": "pass | fail | n/a" }]
}
```
