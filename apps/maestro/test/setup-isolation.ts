// Runs in every vitest worker before any test module is imported.
//
// `src/core` computes its global-store paths (`~/.claude/maestro-*.sqlite`, the user skills and
// plugin caches) from `os.homedir()` at module load, so a test that does not pass an explicit
// db path reads and writes the developer's real `~/.claude` — and fails with "unable to open
// database file" in a sandbox that forbids it. Pointing HOME at a throwaway directory here, before
// the imports, keeps every such default inside the test run. Spawned scripts inherit it too.
// CLAUDE_CODE_SESSION_ID is deleted so a test never resolves the developer's own session.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.CLAUDE_CODE_SESSION_ID;

process.on("exit", () => {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
