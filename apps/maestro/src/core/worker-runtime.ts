// The containerized worker runtime (`175`): run an epic's /maestro worker sessions inside a
// per-project Docker container instead of on the host.
//
// This module is pure planning plus the few file writes a launch needs (a build context, a
// filtered copy of settings.local.json). It never spawns a process and never reads the worker
// token's VALUE into anything it returns that could be logged: the wrapper script
// `plugins/maestro/scripts/maestro-worker-runtime.cjs` owns every `docker`/`claude`/`git` spawn and
// passes the token to `docker run` through the environment (`-e CLAUDE_CODE_OAUTH_TOKEN`, no value
// in argv). `fs`/`path`/`os`/`crypto` only, so the bundle runs under bare node.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MaestroConfigV3 } from "./types.js";
import { worktreePathFor } from "./worktree.js";

export type WorkerRuntime = "host" | "docker";

export const WORKER_RUNTIME_ENV = "MAESTRO_WORKER_RUNTIME";
/** Where the launch command the spawn list prints finds the wrapper, relative to the main checkout. */
export const WORKER_RUNTIME_SCRIPT = ".claude/scripts/maestro-worker-runtime.cjs";
/** Relative to the host user's home: the `claude setup-token` token, mode 600. */
export const WORKER_TOKEN_REL = path.join(".config", "maestro", "worker-token");
export const CONTAINER_USER = "worker";
export const CONTAINER_HOME = "/home/worker";
export const BASE_IMAGE = "node:22-bookworm-slim";

/** Mounted read-only over the bind-mounted repo, relative to the repo root. */
export const READONLY_PATHS = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".claude/scripts",
  ".claude/hooks",
  ".git/hooks",
  ".git/config",
] as const;

/**
 * npm packages a hook can need at runtime that the container does not have, with the version the
 * image pins. A plugin or project hook that names one of them (`require("ts-morph")` in its
 * scripts) gets it installed globally; Node finds a global package through `NODE_PATH`. A Stop hook
 * failed in a probe because ts-morph was missing. Anything else is passed to `image` as
 * `--with-package name@version`.
 */
export const KNOWN_HOOK_PACKAGES: Readonly<Record<string, string>> = {
  "ts-morph": "28.0.0",
};

/** POSIX single-quote a value. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The one reader of `worker_runtime`: `docker` only for the exact string "docker" (trimmed,
 * case-insensitive); everything else, including absent, blank, unknown or a wrong-version config,
 * is `host`.
 */
export function resolveWorkerRuntime(cfg: MaestroConfigV3 | null): WorkerRuntime {
  if (!cfg || cfg.version !== 3) return "host";
  const v: unknown = cfg.worker_runtime;
  return typeof v === "string" && v.trim().toLowerCase() === "docker" ? "docker" : "host";
}

/**
 * The launch command the spawn list prints for the docker runtime. Run from the main checkout in a
 * herdr pane, like the host command it replaces; the wrapper turns it into the real `docker run`.
 */
export function dockerLaunchCommandFor(name: string, filename: string, model?: string): string {
  const rel = path.posix.join(".claude", "maestro-tasks", path.basename(filename));
  const flag = model?.trim() ? ` --model ${shellQuote(model.trim())}` : "";
  return `node ${WORKER_RUNTIME_SCRIPT} run --name ${shellQuote(name)}${flag} ${shellQuote(rel)}`;
}

// ---------------------------------------------------------------- settings.local.json filter

/**
 * `settings.local.json` with its `hooks` section removed and everything else kept. Throws on text
 * that is not a JSON object, so the launcher stops instead of mounting a broken file.
 */
export function filterSettingsLocal(text: string): string {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("settings.local.json is not a JSON object");
  const { hooks: _hooks, ...rest } = parsed as Record<string, unknown>;
  return `${JSON.stringify(rest, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------- mounts

export interface Mount {
  source: string;
  target: string;
  readonly: boolean;
}

export interface MountInput {
  repoRoot: string;
  /** The task's sibling worktree path, or null when the task number is unknown. */
  worktreePath: string | null;
  /** Host path of the hooks-less copy of settings.local.json, when the real file exists. */
  filteredSettingsLocal: string | null;
  /** Whether a path exists on the host: a missing source would be created root-owned by docker. */
  exists: (p: string) => boolean;
}

/**
 * Every bind mount of a worker, in order: the repo, the read-only paths over it (only those that
 * exist; `.claude/settings.local.json` comes from the filtered copy), then the task worktree at its
 * own path. The herdr socket is never mounted.
 */
export function workerMounts(input: MountInput): Mount[] {
  const { repoRoot } = input;
  const mounts: Mount[] = [{ source: repoRoot, target: repoRoot, readonly: false }];
  for (const rel of READONLY_PATHS) {
    const target = path.join(repoRoot, rel);
    if (rel === ".claude/settings.local.json") {
      if (input.filteredSettingsLocal) mounts.push({ source: input.filteredSettingsLocal, target, readonly: true });
      continue;
    }
    if (input.exists(target)) mounts.push({ source: target, target, readonly: true });
  }
  if (input.worktreePath) mounts.push({ source: input.worktreePath, target: input.worktreePath, readonly: false });
  return mounts;
}

export function mountArg(m: Mount): string {
  return `${m.source}:${m.target}${m.readonly ? ":ro" : ""}`;
}

export interface RunArgsInput {
  tag: string;
  name: string;
  /** `.claude/maestro-tasks/<file>.md`, relative to the repo. */
  taskRel: string;
  model?: string;
  repoRoot: string;
  mounts: Mount[];
  gitIdentity?: { name?: string; email?: string };
}

export function containerNameFor(name: string): string {
  return `maestro-worker-${name.replace(/[^A-Za-z0-9_.-]/g, "-")}`;
}

/**
 * The `docker run` argument list (without the leading `docker`). The token is passed as a bare
 * `-e CLAUDE_CODE_OAUTH_TOKEN`: docker takes the value from its own environment, so it is in no
 * argv, log or image. The `claude` invocation is the host launch verbatim.
 */
export function workerRunArgs(o: RunArgsInput): string[] {
  const args = ["run", "-it", "--rm", "--name", containerNameFor(o.name)];
  args.push("-e", "CLAUDE_CODE_OAUTH_TOKEN", "-e", `${WORKER_RUNTIME_ENV}=docker`);
  const id = o.gitIdentity;
  if (id?.name) args.push("-e", `GIT_AUTHOR_NAME=${id.name}`, "-e", `GIT_COMMITTER_NAME=${id.name}`);
  if (id?.email) args.push("-e", `GIT_AUTHOR_EMAIL=${id.email}`, "-e", `GIT_COMMITTER_EMAIL=${id.email}`);
  for (const m of o.mounts) args.push("-v", mountArg(m));
  args.push("-w", o.repoRoot, o.tag, "claude", "-n", o.name);
  if (o.model?.trim()) args.push("--model", o.model.trim());
  args.push(`/maestro ${o.taskRel}`);
  return args;
}

/** The worktree path for a task file name (`<repo>-task-NNN`), or null for a name with no number. */
export function worktreeMountPath(repoRoot: string, filename: string): string | null {
  return worktreePathFor(repoRoot, filename);
}

// ------------------------------------------------------------------------------- the token

export type TokenResult = { ok: true; token: string } | { ok: false; message: string };

export function tokenSetupMessage(tokenPath: string): string {
  return [
    `maestro worker: no worker token at ${tokenPath}.`,
    "Create it once, then run again:",
    "  1. In your own terminal run: claude setup-token",
    `  2. Save the token it prints to ${tokenPath} (mkdir -p its folder first)`,
    `  3. chmod 600 ${tokenPath}`,
    "The token is inference-only (no Remote Control), which is fine for workers. It is read at launch",
    "and never printed, logged or baked into an image.",
  ].join("\n");
}

/** Read the token file. The message never contains the token. */
export function readWorkerToken(tokenPath: string): TokenResult {
  let raw: string;
  try {
    raw = fs.readFileSync(tokenPath, "utf8");
  } catch {
    return { ok: false, message: tokenSetupMessage(tokenPath) };
  }
  const token = raw.trim();
  if (!token) return { ok: false, message: tokenSetupMessage(tokenPath) };
  return { ok: true, token };
}

// -------------------------------------------------------------------------- image inputs

export interface PluginPin {
  /** `name@marketplace`. */
  id: string;
  version: string;
  /** Host install path of that exact version. */
  installPath: string;
}

/** A marketplace a pinned plugin comes from: its `known_marketplaces.json` entry and, when present, its host directory. */
export interface MarketplacePin {
  name: string;
  /** The host's entry (source, lastUpdated, installLocation). Non-secret metadata only. */
  entry: Record<string, unknown>;
  /** Host directory to copy into the image, or null when the host has none. */
  dir: string | null;
}

export interface ImageSpec {
  projectRoot: string;
  uid: number;
  gid: number;
  claudeVersion: string;
  plugins: PluginPin[];
  /** Metadata for the marketplaces of `plugins`, so they load without an interactive step. */
  marketplaces?: MarketplacePin[];
  npmPackages: Record<string, string>;
  baseImage?: string;
}

/** Plugin ids a settings file enables. */
export function enabledPluginIds(settings: unknown): string[] {
  if (!settings || typeof settings !== "object") return [];
  const ep = (settings as { enabledPlugins?: unknown }).enabledPlugins;
  if (!ep || typeof ep !== "object") return [];
  return Object.entries(ep as Record<string, unknown>)
    .filter(([, on]) => on === true)
    .map(([id]) => id);
}

/** The pin for each plugin id from `installed_plugins.json`, and the ids it has no install for. */
export function pinPlugins(ids: string[], installed: unknown): { pins: PluginPin[]; missing: string[] } {
  const table = (installed as { plugins?: Record<string, unknown> } | null)?.plugins ?? {};
  const pins: PluginPin[] = [];
  const missing: string[] = [];
  for (const id of [...new Set(ids)].sort()) {
    const entries = Array.isArray(table[id]) ? (table[id] as Array<Record<string, unknown>>) : [];
    const e = entries.find((x) => x.scope === "user") ?? entries[0];
    if (e && typeof e.version === "string" && typeof e.installPath === "string")
      pins.push({ id, version: e.version, installPath: e.installPath });
    else missing.push(id);
  }
  return { pins, missing };
}

/** `name@version` strings into a map; throws on a form with no version. */
export function parsePackageSpecs(specs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of specs) {
    const at = s.lastIndexOf("@");
    if (at <= 0 || at === s.length - 1) throw new Error(`a package must be name@version, not "${s}"`);
    out[s.slice(0, at)] = s.slice(at + 1);
  }
  return out;
}

const SCAN_EXT = /\.(c|m)?js$/;
const SCAN_MAX_BYTES = 8 * 1024 * 1024;
const SCAN_MAX_DEPTH = 4;

function scanFiles(dir: string, depth: number, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < SCAN_MAX_DEPTH) scanFiles(p, depth + 1, out);
    } else if (SCAN_EXT.test(e.name)) out.push(p);
  }
}

/**
 * The known hook packages (`KNOWN_HOOK_PACKAGES`) that a hook script under any of `roots` names as a
 * quoted module id. Only `.js`/`.cjs`/`.mjs` files are read, and never this module's own bundle (it
 * names every package in the table).
 */
export function detectHookPackages(roots: string[]): Record<string, string> {
  const files: string[] = [];
  for (const r of roots) scanFiles(r, 0, files);
  const found: Record<string, string> = {};
  for (const f of files) {
    let text: string;
    try {
      if (fs.statSync(f).size > SCAN_MAX_BYTES) continue;
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (text.includes("KNOWN_HOOK_PACKAGES")) continue;
    for (const [name, version] of Object.entries(KNOWN_HOOK_PACKAGES)) {
      if (!found[name] && new RegExp(`["'\`]${name}["'\`]`).test(text)) found[name] = version;
    }
  }
  return found;
}

/** The npm packages the hooks need (`detectHookPackages`) plus any the caller names. */
export function hookPackagesFor(roots: string[], extra: Record<string, string> = {}): Record<string, string> {
  return { ...detectHookPackages(roots), ...extra };
}

/**
 * Everything the image depends on, in a canonical order. The tag is a hash of exactly this, so a
 * plugin version bump, a new hook dependency or a Claude Code upgrade changes the tag (rebuild),
 * and an unchanged set reuses the image. Nothing secret is an input.
 */
export function imageTagInputs(spec: ImageSpec): Record<string, unknown> {
  return {
    // Bump when the image's layout changes without any other input changing.
    layout: 2,
    base: spec.baseImage ?? BASE_IMAGE,
    claude: spec.claudeVersion,
    trusted: trustedPaths(spec.projectRoot),
    marketplaces: (spec.marketplaces ?? []).map((m) => `${m.name}=${JSON.stringify(m.entry.source ?? null)}`).sort(),
    uid: spec.uid,
    gid: spec.gid,
    projectRoot: spec.projectRoot,
    plugins: spec.plugins.map((p) => `${p.id}@${p.version}`).sort(),
    npm: Object.entries(spec.npmPackages)
      .map(([n, v]) => `${n}@${v}`)
      .sort(),
  };
}

export function imageTag(spec: ImageSpec): string {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(imageTagInputs(spec)))
    .digest("hex")
    .slice(0, 12);
  const slug =
    path
      .basename(spec.projectRoot)
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "-")
      .replace(/^[-.]+/, "") || "project";
  return `maestro-worker-${slug}:${hash}`;
}

/**
 * The paths the image trusts: the project's real path and its parent directory. A task's worktree
 * is the sibling `<repo>-task-N`, which the image (one per project, not per task) cannot name, and
 * Claude Code treats a trusted ancestor as trusting what is under it. The parent holds only what
 * the launcher mounts, so trusting it inside the container widens nothing.
 */
export function trustedPaths(projectRoot: string): string[] {
  const parent = path.dirname(projectRoot);
  return parent === projectRoot || parent === path.dirname(parent) ? [projectRoot] : [projectRoot, parent];
}

/** The pre-filled `~/.claude.json`: onboarding done, theme set, the project and its worktrees trusted. */
export function claudeJsonFor(projectRoot: string): string {
  const projects: Record<string, unknown> = {};
  for (const p of trustedPaths(projectRoot)) projects[p] = { hasTrustDialogAccepted: true };
  return `${JSON.stringify({ hasCompletedOnboarding: true, theme: "dark", projects }, null, 2)}\n`;
}

/**
 * `known_marketplaces.json` for the container: each marketplace's host entry with its install
 * location moved to the container path. Throws on a source carrying credentials in a URL.
 */
export function knownMarketplacesJsonFor(marketplaces: MarketplacePin[]): string {
  const out: Record<string, unknown> = {};
  for (const m of marketplaces) {
    if (/:\/\/[^/@\s]+@/.test(JSON.stringify(m.entry.source ?? null)))
      throw new Error(`marketplace "${m.name}" has credentials in its source URL; refusing to bake it into an image`);
    out[m.name] = { ...m.entry, installLocation: `${CONTAINER_HOME}/.claude/plugins/marketplaces/${m.name}` };
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Managed settings baked in: the container is the isolation, so Claude Code's own sandbox is off. */
export function managedSettingsJson(): string {
  return `${JSON.stringify({ sandbox: { enabled: false } }, null, 2)}\n`;
}

function pluginParts(id: string): { name: string; marketplace: string } {
  const at = id.indexOf("@");
  return at < 0 ? { name: id, marketplace: "local" } : { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

/** Where a pinned plugin lives inside the container. */
export function containerPluginPath(p: PluginPin): string {
  const { name, marketplace } = pluginParts(p.id);
  return `${CONTAINER_HOME}/.claude/plugins/cache/${marketplace}/${name}/${p.version}`;
}

/** `installed_plugins.json` for the container: the pinned plugins at their container paths. */
export function installedPluginsJsonFor(pins: PluginPin[]): string {
  const plugins: Record<string, unknown[]> = {};
  for (const p of pins) plugins[p.id] = [{ scope: "user", installPath: containerPluginPath(p), version: p.version }];
  return `${JSON.stringify({ version: 2, plugins }, null, 2)}\n`;
}

function readJsonFile(p: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export interface GatherInput {
  home: string;
  uid: number;
  gid: number;
  claudeVersion: string;
  /** `name@version` strings from the caller, merged over the known hook dependencies. */
  extraPackages?: string[];
}

/**
 * The image spec for a project: the plugins its `.claude/settings.json` / `settings.local.json`
 * enable, pinned to the versions the host has installed, plus the hook dependencies they need.
 * `missing` names enabled plugins with no host install, which the caller must refuse on.
 */
export function gatherImageSpec(projectRoot: string, g: GatherInput): { spec: ImageSpec; missing: string[] } {
  const ids = [
    ...enabledPluginIds(readJsonFile(path.join(projectRoot, ".claude", "settings.json"))),
    ...enabledPluginIds(readJsonFile(path.join(projectRoot, ".claude", "settings.local.json"))),
  ];
  const installed = readJsonFile(path.join(g.home, ".claude", "plugins", "installed_plugins.json"));
  const { pins, missing } = pinPlugins(ids, installed);
  const known = readJsonFile(path.join(g.home, ".claude", "plugins", "known_marketplaces.json"));
  const marketplaces: MarketplacePin[] = [];
  for (const name of [...new Set(pins.map((p) => pluginParts(p.id).marketplace))].sort()) {
    const entry = known && typeof known === "object" ? (known as Record<string, unknown>)[name] : undefined;
    if (!entry || typeof entry !== "object") continue;
    const loc = (entry as { installLocation?: unknown }).installLocation;
    marketplaces.push({
      name,
      entry: entry as Record<string, unknown>,
      dir: typeof loc === "string" && fs.existsSync(loc) && fs.statSync(loc).isDirectory() ? loc : null,
    });
  }
  return {
    spec: {
      projectRoot,
      uid: g.uid,
      gid: g.gid,
      claudeVersion: g.claudeVersion,
      plugins: pins,
      marketplaces,
      npmPackages: hookPackagesFor(
        [
          ...pins.flatMap((p) => [path.join(p.installPath, "hooks"), path.join(p.installPath, "scripts")]),
          path.join(projectRoot, ".claude", "hooks"),
          path.join(projectRoot, ".claude", "scripts"),
        ],
        parsePackageSpecs(g.extraPackages ?? [])
      ),
    },
    missing,
  };
}

export function dockerfileFor(spec: ImageSpec): string {
  const pkgs = Object.entries(spec.npmPackages)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, v]) => ` ${n}@${v}`)
    .join("");
  const own = `${spec.uid}:${spec.gid}`;
  return [
    `FROM ${spec.baseImage ?? BASE_IMAGE}`,
    "RUN apt-get update \\",
    " && apt-get install -y --no-install-recommends git ca-certificates bash \\",
    " && rm -rf /var/lib/apt/lists/* \\",
    ` && npm install -g @anthropic-ai/claude-code@${spec.claudeVersion}${pkgs} \\`,
    " && npm cache clean --force",
    "ENV NODE_PATH=/usr/local/lib/node_modules",
    "# The container user takes the host user's uid/gid so files written in the repo stay theirs.",
    `RUN (userdel -r node || true) \\`,
    ` && (getent group ${spec.gid} >/dev/null || groupadd -g ${spec.gid} ${CONTAINER_USER}) \\`,
    ` && useradd -m -u ${spec.uid} -g ${spec.gid} -d ${CONTAINER_HOME} -s /bin/bash ${CONTAINER_USER}`,
    "COPY managed-settings.json /etc/claude-code/managed-settings.json",
    `USER ${spec.uid}:${spec.gid}`,
    `ENV HOME=${CONTAINER_HOME}`,
    `WORKDIR ${CONTAINER_HOME}`,
    `COPY --chown=${own} claude.json ${CONTAINER_HOME}/.claude.json`,
    `COPY --chown=${own} installed_plugins.json ${CONTAINER_HOME}/.claude/plugins/installed_plugins.json`,
    `COPY --chown=${own} plugins/ ${CONTAINER_HOME}/.claude/plugins/cache/`,
    `COPY --chown=${own} known_marketplaces.json ${CONTAINER_HOME}/.claude/plugins/known_marketplaces.json`,
    `COPY --chown=${own} marketplaces/ ${CONTAINER_HOME}/.claude/plugins/marketplaces/`,
    "",
  ].join("\n");
}

export interface ContextIO {
  copyDir: (from: string, to: string) => void;
}

/**
 * Write the build context into `dir`: the Dockerfile, the pre-filled `.claude.json`, managed
 * settings, `installed_plugins.json` and a copy of each pinned plugin's installed files. Nothing in
 * it comes from a credential file.
 */
export function writeBuildContext(dir: string, spec: ImageSpec, io: ContextIO = defaultContextIO): void {
  fs.mkdirSync(dir, { recursive: true });
  const put = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text);
  put("Dockerfile", dockerfileFor(spec));
  put("claude.json", claudeJsonFor(spec.projectRoot));
  put("managed-settings.json", managedSettingsJson());
  put("installed_plugins.json", installedPluginsJsonFor(spec.plugins));
  const marketplaces = spec.marketplaces ?? [];
  put("known_marketplaces.json", knownMarketplacesJsonFor(marketplaces));
  fs.mkdirSync(path.join(dir, "plugins"), { recursive: true });
  fs.mkdirSync(path.join(dir, "marketplaces"), { recursive: true });
  for (const m of marketplaces) if (m.dir) io.copyDir(m.dir, path.join(dir, "marketplaces", m.name));
  for (const p of spec.plugins) {
    const { name, marketplace } = pluginParts(p.id);
    io.copyDir(p.installPath, path.join(dir, "plugins", marketplace, name, p.version));
  }
}

const defaultContextIO: ContextIO = {
  copyDir: (from, to) => fs.cpSync(from, to, { recursive: true, filter: (src) => !/(^|[\\/])\.git$/.test(src) }),
};
