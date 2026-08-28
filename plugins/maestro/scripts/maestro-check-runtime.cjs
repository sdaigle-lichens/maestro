#!/usr/bin/env node
// Step 0's cheap staleness check — see templates/maestro/SKILL.md and task 027.
//
// A bare terminal session has no access to the app's checkout of plugins/maestro (it may not even
// be on this machine), so it can't read a plugin.json the way apps/maestro/src/core/install.ts's
// shippedRuntimeVersion() does. What it CAN read is the same thing the app's pluginHooksActive
// check reads: ~/.claude/plugins/installed_plugins.json, which names the version and installPath
// of whatever the marketplace last pulled — the version that would actually apply if the runtime
// were refreshed right now.
//
// Compares that against this project's stamped .claude/maestro.json `runtimeVersion` and prints
// ONE line of JSON. Never throws, never writes anything itself — it only ANSWERS the question;
// Step 0 runs the refresh (maestro-install.js + maestro-render-orchestrator.cjs, the same two
// commands /maestro-update runs) when `stale` comes back true.
//
// Degrades to `{ ok: false }` — a no-op, matching every other hook script's "no-op when
// maestro.json is absent" rule — whenever it can't answer: no maestro.json, an unreadable
// installed_plugins.json, or the maestro plugin not installed via a marketplace on this machine at
// all (a project-local-only setup, or the app-only delivery path, has nothing here to compare
// against — that project's runtime is refreshed by the app instead).

const fs = require("fs");
const path = require("path");

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function report(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const configPath = path.join(projectDir, ".claude", "maestro.json");
const config = readJsonSafe(configPath);
if (!config || config.version !== 3) {
  report({ ok: false, stale: false, reason: "no maestro.json" });
  process.exit(0);
}

const installedPluginsPath = path.join(process.env.HOME || "", ".claude", "plugins", "installed_plugins.json");
const installedPlugins = readJsonSafe(installedPluginsPath);
const entries = installedPlugins && installedPlugins.plugins ? installedPlugins.plugins : {};

// Keys are "<pluginName>@<marketplace>". Prefer an install scoped to THIS project over a global
// one, mirroring apps/maestro/src/core/install.ts's pluginHooksActive — but any match is enough to
// answer the question, since every install of the plugin ships the same runtime files.
let match = null;
for (const [key, installs] of Object.entries(entries)) {
  const pluginName = key.includes("@") ? key.slice(0, key.lastIndexOf("@")) : key;
  if (pluginName !== "maestro" || !Array.isArray(installs)) continue;
  for (const install of installs) {
    if (!install || !install.installPath || !install.version) continue;
    const scoped = install.projectPath && path.resolve(install.projectPath) === path.resolve(projectDir);
    if (!match || scoped) match = install;
  }
}

if (!match) {
  report({ ok: false, stale: false, reason: "maestro plugin not installed on this machine" });
  process.exit(0);
}

report({
  ok: true,
  stale: config.runtimeVersion !== match.version,
  installedVersion: config.runtimeVersion || null,
  runtimeVersion: match.version,
  pluginRoot: match.installPath,
});
