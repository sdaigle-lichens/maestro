#!/usr/bin/env node
// Lets the Maestro commands that write where Claude Code's Bash sandbox always forbids run outside
// it, as narrowly as the sandbox allows.
//
//   node maestro-sandbox-allow.cjs [projectDir]                      # dry run: report, write nothing
//   node maestro-sandbox-allow.cjs [projectDir] --apply              # merge the entries into settings.local.json
//   node maestro-sandbox-allow.cjs [projectDir] --remove             # take them back out
//   node maestro-sandbox-allow.cjs [projectDir] --remove --dry-run   # what --remove would take out
//
// Run by /maestro-install and /maestro-update (dry run) and /maestro-uninstall (--remove). --apply
// and --remove write .claude/settings.local.json, which a sandboxed command can never write, so the
// skills ask the user to run those with `!`. The dry run only reads.
//
// What it writes, all in the project's .claude/settings.local.json (personal, never committed —
// the plugin path below is per machine):
//   - sandbox.excludedCommands: the exact command texts listed in EXCLUDED below. Entries use
//     Bash-rule syntax: no wildcard is an exact match, a trailing ` *` allows any arguments.
//   - sandbox.filesystem.denyWrite + permissions.deny Edit: the project's .claude/scripts/. An
//     excluded command is only as safe as the file it runs; without these a sandboxed agent could
//     rewrite maestro-render-orchestrator.cjs and then run its own code through the exclusion.
//     Install and update still refresh the scripts, because they run excluded themselves.
//
// Entries are recognised as ours by their exact text (plus any older plugin path for the installer,
// which changes with every plugin version), so --apply replaces stale ones and --remove never
// touches an entry the user wrote.
//
// Prints one JSON object:
//   { ok, mode, dryRun, settingsPath, sandboxEnabled, upToDate, added, removed, entries, broadEntries,
//     applyCommand, removeCommand }
// Exit 0, except 1 when settings.local.json exists but does not parse (nothing is written then).

const fs = require("fs");
const os = require("os");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SELF = path.join(PLUGIN_ROOT, "scripts", "maestro-sandbox-allow.cjs");

// Every command a Maestro skill runs that the sandbox blocks, with the reason shown to the user.
const EXCLUDED = [
  {
    value: "node .claude/scripts/maestro-render-orchestrator.cjs",
    why: "re-renders the orchestrator's handoff table in .claude/skills/maestro/SKILL.md (sandbox-protected)",
  },
  {
    value: "node .claude/scripts/maestro-render-orchestrator.cjs .",
    why: "same, as /create-workflow and /update-workflow print it",
  },
  {
    value: "node .claude/scripts/maestro-task-status.cjs worktree *",
    why: "creates a task's worktree beside the project (<repo>-task-N), outside the sandbox's writable area",
  },
  {
    value: "node .claude/scripts/maestro-task-status.cjs freeform-check *",
    why: "same, for a freeform run while another session is live (freeform-<id>)",
  },
  {
    value: "node .claude/scripts/maestro-task-status.cjs merge *",
    why: "merges a finished worktree back, which can touch .claude/skills and other protected paths",
  },
  {
    value: `node ${path.join(PLUGIN_ROOT, "scripts", "maestro-install.js")} *`,
    why: "/maestro-install and /maestro-update: writes .claude/settings.json hooks and .claude/skills/maestro/ (rewritten after each plugin update, since the path carries the version)",
  },
];

const STALE_INSTALLER = /^node \S+\/scripts\/maestro-install\.js \*$/;
// A broad entry someone wrote by hand, e.g. the `node *maestro-install.js*` an older
// /maestro-update suggested. Reported so the user can drop it; never touched.
const BROAD = /^node \*.*maestro-/;

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const mode = flags.has("--remove") ? "remove" : "apply";
  // Without --apply / --remove nothing is written; `--remove --dry-run` previews a removal.
  const dryRun = flags.has("--dry-run") || !(flags.has("--apply") || flags.has("--remove"));
  const projectDir = path.resolve(positional[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  return { mode, dryRun, projectDir };
}

function readJson(file) {
  if (!fs.existsSync(file)) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// true / false when some settings file says so, null when none we could read does.
function sandboxEnabled(projectDir) {
  const files = [
    path.join(projectDir, ".claude", "settings.local.json"),
    path.join(projectDir, ".claude", "settings.json"),
    path.join(os.homedir(), ".claude", "settings.json"),
  ];
  for (const file of files) {
    let r;
    try {
      r = readJson(file);
    } catch {
      continue; // unreadable from inside the sandbox
    }
    const enabled = r.ok && r.value && r.value.sandbox && r.value.sandbox.enabled;
    if (typeof enabled === "boolean") return enabled;
  }
  return null;
}

function wanted(projectDir) {
  const scriptsDir = path.join(projectDir, ".claude", "scripts");
  return {
    excludedCommands: EXCLUDED,
    denyWrite: [{ value: scriptsDir, why: "keeps sandboxed commands from rewriting the scripts excluded above" }],
    deny: [
      {
        value: "Edit(/.claude/scripts/**)",
        why: "same, for Claude's Edit and Write tools, which the sandbox does not cover",
      },
    ],
  };
}

const list = (obj, key) => (Array.isArray(obj[key]) ? obj[key] : []);

function isOurs(kind, value, want) {
  if (want[kind].some((w) => w.value === value)) return true;
  return kind === "excludedCommands" && STALE_INSTALLER.test(value);
}

// The (parent object, key) each kind lives under, created on demand when `create` is set.
function slot(settings, kind, create) {
  const chain =
    kind === "excludedCommands" ? ["sandbox"] : kind === "denyWrite" ? ["sandbox", "filesystem"] : ["permissions"];
  let obj = settings;
  for (const k of chain) {
    if (!obj[k] || typeof obj[k] !== "object") {
      if (!create) return null;
      obj[k] = {};
    }
    obj = obj[k];
  }
  return obj;
}

function plan(settings, mode, want) {
  const added = [];
  const removed = [];
  for (const kind of Object.keys(want)) {
    const parent = slot(settings, kind, false);
    const current = parent ? list(parent, kind) : [];
    const targets = mode === "remove" ? [] : want[kind].map((w) => w.value);
    for (const v of current) {
      if (isOurs(kind, v, want) && !targets.includes(v)) removed.push({ kind, value: v });
    }
    for (const v of targets) {
      if (!current.includes(v)) added.push({ kind, value: v });
    }
  }
  return { added, removed };
}

// Drop the containers a removal emptied, deepest first, so --remove leaves no `{}` behind.
function pruneEmpty(settings) {
  const empty = (o) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 0;
  if (settings.sandbox && empty(settings.sandbox.filesystem)) delete settings.sandbox.filesystem;
  for (const k of ["sandbox", "permissions"]) if (empty(settings[k])) delete settings[k];
}

function applyPlan(settings, { added, removed }) {
  for (const { kind, value } of removed) {
    const parent = slot(settings, kind, false);
    parent[kind] = list(parent, kind).filter((v) => v !== value);
    if (parent[kind].length === 0) delete parent[kind];
  }
  if (removed.length > 0) pruneEmpty(settings);
  for (const { kind, value } of added) {
    const parent = slot(settings, kind, true);
    parent[kind] = [...list(parent, kind), value];
  }
}

function main() {
  const { mode, dryRun, projectDir } = parseArgs(process.argv.slice(2));
  const settingsPath = path.join(projectDir, ".claude", "settings.local.json");
  const read = readJson(settingsPath);
  if (!read.ok) {
    process.stdout.write(
      JSON.stringify({ ok: false, settingsPath, reason: `settings.local.json does not parse: ${read.error}` }) + "\n"
    );
    process.exit(1);
  }
  const settings = read.value && typeof read.value === "object" ? read.value : {};
  const want = wanted(projectDir);
  const changes = plan(settings, mode, want);
  const upToDate = changes.added.length === 0 && changes.removed.length === 0;

  if (!dryRun && !upToDate) {
    applyPlan(settings, changes);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }

  const exclusions = (slot(settings, "excludedCommands", false) || {}).excludedCommands || [];
  process.stdout.write(
    JSON.stringify({
      ok: true,
      mode,
      dryRun,
      settingsPath,
      sandboxEnabled: sandboxEnabled(projectDir),
      upToDate,
      added: changes.added,
      removed: changes.removed,
      entries: Object.entries(want).flatMap(([kind, ws]) => ws.map((w) => ({ kind, ...w }))),
      broadEntries: exclusions.filter((v) => BROAD.test(v)),
      applyCommand: `node ${SELF} ${projectDir} --apply`,
      removeCommand: `node ${SELF} ${projectDir} --remove`,
    }) + "\n"
  );
}

main();
