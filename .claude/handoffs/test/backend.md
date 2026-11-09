Fix the whole defect class in one round, not just the failing case. @test names the class and lists the other inputs of that class it checked or expects to fail; handle every one of them (and any further input of the same class you can think of) before you hand back. A fix that patches one rule and leaves the neighbouring case is the failure this payload exists to prevent.

```json
{
  "defectClass": "<short name for the kind of defect, e.g. 'prefix match accepts a longer token'; reuse the exact same name when a later round is the same kind of defect>",
  "sameClassProbes": ["<other input of this class @test checked or expects to fail, with its observed or expected result>"],
  "failing_tests": ["<test name — behavior it expects>"],
  "test_files_added": ["<list, or 'none'>"],
  "implementation_targets": ["<endpoint/function the backend must implement>"],
  "how_to_run": ["<command to run the failing tests, or 'none'>"]
}
```
