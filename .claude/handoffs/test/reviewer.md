```json
{
  "tests_added": ["<test name — what it verifies>"],
  "test_origin": {
    "from_hints": ["<test name>"],
    "independent": ["<test name> - <source: acceptance criterion | file:line code path | failure mode not in hints>"]
  },
  "acceptance_coverage": ["<acceptance criterion> => <test names, or 'untested: <reason>'>"],
  "hints_skipped": ["<implementer hint> - <reason>, or 'none'"],
  "results": ["<pass/fail summary>"],
  "commands_run": ["<exact command> => <exit code, N passed / N failed>"],
  "negative_control": ["<new test> - <how it was shown to fail without the fix or against the broken behaviour, or 'not demonstrated'>"],
  "real_path_exercised": ["<what ran for real: process, window, filesystem, CLI; or 'unit only'>"],
  "coverage_gaps": ["<behavior still untested, or 'none'>"],
  "known_gaps": ["<issue> - <owner: a later step such as @scribe, or 'after commit'> - <why it is not a failure now>, or 'none'"],
  "files_touched": ["<list, or 'none'>"]
}
```