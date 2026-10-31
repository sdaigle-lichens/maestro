#!/usr/bin/env node
// Lets the Maestro commands that write where Claude Code's Bash sandbox always forbids run outside
// it, as narrowly as the sandbox allows.
//
//   node maestro-sandbox-allow.cjs [projectDir]                      # dry run: report, write nothing
//   node maestro-sandbox-allow.cjs [projectDir] --apply              # merge the entries into settings.local.json
//   node maestro-sandbox-allow.cjs [projectDir] --remove             # take them back out
//   node maestro-sandbox-allow.cjs [projectDir] --remove --dry-run   # what --remove would take out
//   add --herdr to any of these for the herdr opt-in (below); `--remove --herdr` takes out only that
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
// --herdr (an explicit opt-in, never part of the default list) lets /maestro-manager drive herdr:
//   - sandbox.filesystem.allowWrite: herdr's socket, $HOME/.config/herdr/herdr.sock (connecting to
//     a Unix socket needs write access to it).
//   - sandbox.filesystem.allowRead: the herdr binary PATH resolves to, only when it is under $HOME
//     (the Linux sandbox hides the home directory otherwise); the binary, never its directory.
//   - sandbox.network.allowUnixSockets: the socket, only when the effective settings do not already
//     set sandbox.network.allowAllUnixSockets: true. Claude Code honours this list on macOS only.
//   It is a sandbox escape: `herdr pane run` runs any command outside the sandbox. Paths are
//   written absolute; the herdr CLI's socket-API commands touch nothing under ~/.config/herdr but
//   the socket (checked with strace on herdr 0.9.5).
//
// Entries are recognised as ours by their exact text (plus any older plugin path for the installer,
// which changes with every plugin version), so --apply replaces stale ones and --remove never
// touches an entry the user wrote. A plain --apply leaves earlier herdr entries alone; a plain
// --remove takes them out along with the rest.
//
// Prints one JSON object:
//   { ok, mode, dryRun, settingsPath, sandboxEnabled, upToDate, added, removed, entries, broadEntries,
//     herdr: { optIn, present, binary, socket, socketExists, herdrEnv, settingsEntries, inUse,
//              allowAllUnixSockets, unparseableSettings },
//     applyCommand, removeCommand }
//   herdr.present: every herdr entry is already in settings.local.json, `~/...` or absolute alike.
//   herdr.socketExists / herdrEnv (HERDR_ENV=1) / settingsEntries (herdr entries already in the
//   project's settings files) are the evidence this sandboxed process can see; inUse is true when
//   any holds. `binary: null` alone never means herdr is not installed: the sandbox hides it.
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
  return { mode, dryRun, projectDir, herdr: flags.has("--herdr") };
}

function readJson(file) {
  if (!fs.existsSync(file)) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// The boolean at `keys` in the highest-precedence settings file that sets one, or null when none we
// could read does (local, then project, then user; managed settings are not consulted).
// A file that exists but does not parse is skipped (never guessed at) and pushed onto `problems`.
function effectiveBool(projectDir, keys, problems) {
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
    if (!r.ok && problems) problems.push({ file, error: r.error });
    let v = r.ok ? r.value : null;
    for (const k of keys) v = v && typeof v === "object" ? v[k] : undefined;
    if (typeof v === "boolean") return v;
  }
  return null;
}

// The first executable `herdr` on PATH, like `command -v herdr`, or null.
function findOnPath(name) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return path.resolve(file);
    } catch {
      // not here
    }
  }
  return null;
}

const underHome = (file) => {
  const rel = path.relative(os.homedir(), file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

// The herdr entries already in the project's settings files (local, then shared), as
// `{ file, kind, value }`. An entry is herdr's when it is the socket or a path ending in `/herdr`
// (`~` forms included). A file that cannot be read or parsed contributes nothing.
function herdrSettingsEntries(projectDir, socket) {
  const found = [];
  for (const name of ["settings.local.json", "settings.json"]) {
    const file = path.join(projectDir, ".claude", name);
    let value = null;
    try {
      const r = readJson(file);
      value = r.ok ? r.value : null;
    } catch {
      continue; // unreadable from inside the sandbox
    }
    for (const kind of ["allowWrite", "allowRead", "allowUnixSockets"]) {
      const parent = value && typeof value === "object" ? slot(value, kind, false) : null;
      for (const v of parent ? list(parent, kind) : []) {
        const abs = expandHome(v);
        if (typeof abs === "string" && (abs === socket || path.basename(abs) === "herdr")) {
          found.push({ file, kind, value: v });
        }
      }
    }
  }
  return found;
}

function herdrInfo(projectDir) {
  const binary = findOnPath("herdr");
  const unparseableSettings = [];
  const allowAll = effectiveBool(projectDir, ["sandbox", "network", "allowAllUnixSockets"], unparseableSettings);
  const socket = path.join(os.homedir(), ".config", "herdr", "herdr.sock");
  let socketExists = false;
  try {
    socketExists = fs.existsSync(socket);
  } catch {
    // hidden from the sandbox
  }
  return {
    unparseableSettings,
    socket,
    socketExists,
    herdrEnv: process.env.HERDR_ENV === "1",
    settingsEntries: herdrSettingsEntries(projectDir, socket),
    binary,
    readBinary: binary && underHome(binary) ? binary : null,
    allowAllUnixSockets: allowAll === true,
  };
}

const ESCAPE = "a sandbox escape: any sandboxed command can then run anything unsandboxed through `herdr pane run`";

// Every herdr entry the opt-in can write, by kind. `all` adds the allowUnixSockets entry even when
// allowAllUnixSockets makes it unnecessary, so --remove still recognises one an earlier run wrote.
function herdrEntries(h, all) {
  const out = {
    allowWrite: [{ value: h.socket, why: `lets herdr's CLI connect to its socket; ${ESCAPE}` }],
    allowRead: h.readBinary
      ? [{ value: h.readBinary, why: "the herdr binary, which the Linux sandbox hides under your home directory" }]
      : [],
    allowUnixSockets:
      all || !h.allowAllUnixSockets
        ? [{ value: h.socket, why: "lets sandboxed commands open herdr's socket (honoured on macOS)" }]
        : [],
  };
  return out;
}

function baseEntries(projectDir) {
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

// `want`: the entries this run should leave present (empty for --remove). `known`: the entries this
// run recognises as its own, so it may take them out.
function decide(projectDir, mode, herdr, h) {
  const base = baseEntries(projectDir);
  const empty = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, []]));
  if (mode === "remove") {
    const known = herdr ? herdrEntries(h, true) : { ...base, ...herdrEntries(h, true) };
    return { want: empty(known), known };
  }
  const want = herdr ? { ...base, ...herdrEntries(h, false) } : base;
  return { want, known: want };
}

// `~` and `~/x` as the absolute path under HOME; anything else (and non-strings) unchanged.
function expandHome(v) {
  if (typeof v !== "string") return v;
  if (v === "~") return os.homedir();
  if (v.startsWith("~/")) return path.join(os.homedir(), v.slice(2));
  return v;
}

const list = (obj, key) => (Array.isArray(obj[key]) ? obj[key] : []);

function isOurs(kind, value, known) {
  if (known[kind].some((w) => w.value === value)) return true;
  return kind === "excludedCommands" && STALE_INSTALLER.test(value);
}

const CHAINS = {
  excludedCommands: ["sandbox"],
  denyWrite: ["sandbox", "filesystem"],
  allowWrite: ["sandbox", "filesystem"],
  allowRead: ["sandbox", "filesystem"],
  allowUnixSockets: ["sandbox", "network"],
  deny: ["permissions"],
};

// The (parent object, key) each kind lives under, created on demand when `create` is set.
function slot(settings, kind, create) {
  const chain = CHAINS[kind];
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

function plan(settings, { want, known }) {
  const added = [];
  const removed = [];
  for (const kind of Object.keys(known)) {
    const parent = slot(settings, kind, false);
    const current = parent ? list(parent, kind) : [];
    const targets = want[kind].map((w) => w.value);
    for (const v of current) {
      if (isOurs(kind, v, known) && !targets.includes(v)) removed.push({ kind, value: v });
    }
    // A hand-written `~/x` and the absolute `$HOME/x` are one entry: never add the second.
    const have = current.map(expandHome);
    for (const v of targets) {
      if (!have.includes(expandHome(v))) added.push({ kind, value: v });
    }
  }
  return { added, removed };
}

// Drop the containers a removal emptied, deepest first, so --remove leaves no `{}` behind.
function pruneEmpty(settings) {
  const empty = (o) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 0;
  for (const k of ["filesystem", "network"]) {
    if (settings.sandbox && empty(settings.sandbox[k])) delete settings.sandbox[k];
  }
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
  const { mode, dryRun, projectDir, herdr } = parseArgs(process.argv.slice(2));
  const settingsPath = path.join(projectDir, ".claude", "settings.local.json");
  const read = readJson(settingsPath);
  if (!read.ok) {
    process.stdout.write(
      JSON.stringify({ ok: false, settingsPath, reason: `settings.local.json does not parse: ${read.error}` }) + "\n"
    );
    process.exit(1);
  }
  const settings = read.value && typeof read.value === "object" ? read.value : {};
  const h = herdrInfo(projectDir);
  const { want, known } = decide(projectDir, mode, herdr, h);
  const changes = plan(settings, { want, known });
  const upToDate = changes.added.length === 0 && changes.removed.length === 0;
  // Whether the herdr entries alone are all in place (in either `~` or absolute form), judged before
  // this run writes anything. The skills decide the opt-in question from this, not from upToDate,
  // which a plugin update makes false through the versioned installer entry.
  const herdrWant = herdrEntries(h, false);
  const herdrPresent = plan(settings, { want: herdrWant, known: herdrWant }).added.length === 0;

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
      sandboxEnabled: effectiveBool(projectDir, ["sandbox", "enabled"]),
      upToDate,
      added: changes.added,
      removed: changes.removed,
      entries: Object.entries(mode === "remove" ? known : want).flatMap(([kind, ws]) =>
        ws.map((w) => ({ kind, ...w }))
      ),
      broadEntries: exclusions.filter((v) => BROAD.test(v)),
      herdr: {
        optIn: herdr,
        present: herdrPresent,
        binary: h.binary,
        socket: h.socket,
        // The evidence this process can see. A hidden binary (`binary: null`) is not proof herdr is
        // missing: the sandbox hides it unless allowRead lists it. `inUse` is any of the three.
        socketExists: h.socketExists,
        herdrEnv: h.herdrEnv,
        settingsEntries: h.settingsEntries,
        inUse: h.herdrEnv || h.socketExists || h.settingsEntries.length > 0,
        allowAllUnixSockets: h.allowAllUnixSockets,
        // Settings files that exist but do not parse; allowAllUnixSockets is read as unset from them.
        unparseableSettings: h.unparseableSettings,
      },
      applyCommand: `node ${SELF} ${projectDir} --apply${herdr ? " --herdr" : ""}`,
      removeCommand: `node ${SELF} ${projectDir} --remove${herdr ? " --herdr" : ""}`,
    }) + "\n"
  );
}

main();
