# test/fixtures

`code-graph-skill-gaps.example.json` and `code-graph-skill-gaps.schema.json` are verbatim copies of
code-graph's published skill-gap contract: `plugin/contracts/skill-gaps.example.json` and
`plugin/contracts/skill-gaps.schema.json`, as of code-graph **0.3.20**.

Maestro's tests read only these vendored copies, never a code-graph checkout or the plugin cache.
When code-graph changes the contract, re-copy both files here and update the version above.

Used by `test/core/skill-gaps-contract.test.ts` and the contract block in
`test/core/scribe-gap-retention.test.ts`.
