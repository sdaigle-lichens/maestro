#!/usr/bin/env node
// Reports skill references in .claude/maestro.json that no longer resolve.
//
//   node maestro-stale-refs.cjs [projectDir]
//
// Run by /maestro-update. A config can name a skill by id (an instance's loaded/referenced skills,
// skills_available, the start / end skill lists, a workflow's skill node), and an id can stop
// resolving without anything telling the user: a plugin that supplied it is uninstalled or not
// enabled for this project, or the skill was deleted. This lists those ids and says what to do.
//
// Prints one JSON object and exits 0 under every input — it is advice, and a missing or corrupt
// maestro.json is reported as "nothing to check", never as a failure:
//   { "checked": true,  "dangling": [{ "id", "reason", "where": [...] }], "suggestions": ["..."] }
//   { "checked": false, "dangling": [], "suggestions": [] }
//
// The logic is lib/maestro-skill-availability.cjs, generated from
// apps/maestro/src/core/skill-availability.ts — the same function the installers use to decide
// which optional skills to seed, so the two cannot disagree about what is available.

const fs = require("fs");
const path = require("path");
const { findStaleSkillRefs } = require("./lib/maestro-skill-availability.cjs");

function main() {
  const projectDir = path.resolve(process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "maestro.json"), "utf8"));
  } catch {
    // No maestro.json, or one that does not parse: nothing to check against.
  }
  if (!cfg || typeof cfg !== "object") {
    // Still worth the plugin suggestion for a project that keeps a concept-skill list.
    const { suggestions } = findStaleSkillRefs(projectDir, {});
    process.stdout.write(JSON.stringify({ checked: false, dangling: [], suggestions }) + "\n");
    return;
  }
  const report = findStaleSkillRefs(projectDir, cfg);
  process.stdout.write(JSON.stringify({ checked: true, ...report }) + "\n");
}

try {
  main();
} catch {
  process.stdout.write(JSON.stringify({ checked: false, dangling: [], suggestions: [] }) + "\n");
}
process.exit(0);
