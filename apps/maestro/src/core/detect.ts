// Repo detection — which bundled implementation agent(s) actually build this project's code.
//
// This replaces the `["backend"]` constant the desktop app seeded every unconfigured project
// with. A frontend repo got a backend agent, and the first thing the user saw on the canvas was
// a workflow that was wrong about their own codebase.
//
// Two properties are load-bearing:
//
//   • **It stands alone.** No model, no network, no shelling out. This runs on the first open of
//     every project, so it is plain `readdirSync`/`JSON.parse` over a BOUNDED set of directories
//     — the root plus its workspace members — never a walk of the tree. A large repo opens at the
//     same speed as a small one because the work is proportional to the number of packages, not
//     the number of files. An optional LLM refinement belongs to the confirmation modal in a
//     later milestone; nothing here may wait on one.
//
//   • **It returns its reasons.** `evidence` names the dependencies and files it matched, so the
//     UI can say "detected `react` and `express` in package.json" instead of asking the user to
//     trust an unexplained choice. A heuristic that is occasionally wrong but shows its work is
//     correctable; one that is occasionally wrong and silent is not. The user amends the chain on
//     the canvas before anything is written.

import fs from "node:fs";
import path from "node:path";
import { IGNORE_DIRS } from "./fs-scan.js";

import type { RepoDetection } from "./contracts.js";
export type { RepoDetection };

/** The bundled agents that can implement application code. `plugins/ai-tools-manager/agents/`. */
type ImplAgent = "backend" | "frontend" | "mobile";

/**
 * The order agents take in the seeded happy path when a repo matches more than one: server work
 * lands first, then the UI that calls it. Matches what `/maestro-install` produced by hand
 * ("backend,frontend"), so a re-install of a project detected the old way doesn't reorder its chain.
 */
const AGENT_ORDER: ImplAgent[] = ["backend", "frontend", "mobile"];

/** Package names that identify what a manifest builds. Exact matches — no prefix guessing. */
const DEPENDENCY_SIGNALS: Record<ImplAgent, readonly string[]> = {
  backend: [
    "express",
    "fastify",
    "koa",
    "hono",
    "elysia",
    "restify",
    "@hapi/hapi",
    "@nestjs/core",
    "@nestjs/common",
    "@trpc/server",
    "@apollo/server",
    "apollo-server",
    "graphql-yoga",
    "prisma",
    "@prisma/client",
    "drizzle-orm",
    "typeorm",
    "mongoose",
    "sequelize",
    "knex",
    "kysely",
    "pg",
    "mysql2",
    "mongodb",
    "ioredis",
    "bullmq",
    "kafkajs",
    "amqplib",
    "socket.io",
    "@grpc/grpc-js",
  ],
  frontend: [
    "react-dom",
    "next",
    "nuxt",
    "vue",
    "svelte",
    "@sveltejs/kit",
    "@angular/core",
    "solid-js",
    "astro",
    "gatsby",
    "@remix-run/react",
    "preact",
    "@tanstack/react-router",
    "@tanstack/react-start",
    "tailwindcss",
    "@mui/material",
    "@chakra-ui/react",
  ],
  mobile: ["expo", "expo-router", "react-native", "@ionic/react", "@ionic/angular", "@ionic/vue", "nativescript"],
};

/**
 * Files whose mere presence classifies the directory holding them.
 *
 * The non-JavaScript manifests are the reason this list exists at all: a Python or Go service has
 * no `package.json`, and keying only on npm dependencies would fall through to the default and
 * ignore a repo that is unambiguous about what it is.
 */
const FILE_SIGNALS: ReadonlyArray<{ match: RegExp; agent: ImplAgent }> = [
  // Non-JS language manifests → the code they build is server/CLI work, which is @backend's half.
  { match: /^(pyproject\.toml|requirements\.txt|Pipfile|setup\.py|manage\.py)$/, agent: "backend" },
  { match: /^go\.mod$/, agent: "backend" },
  { match: /^Cargo\.toml$/, agent: "backend" },
  { match: /^(pom\.xml|build\.gradle|build\.gradle\.kts)$/, agent: "backend" },
  { match: /^Gemfile$/, agent: "backend" },
  { match: /^composer\.json$/, agent: "backend" },
  { match: /^mix\.exs$/, agent: "backend" },
  { match: /\.(csproj|fsproj|sln)$/, agent: "backend" },
  // Web framework configs, for repos that keep the framework in a lockfile-only dependency graph.
  { match: /^(next|nuxt|svelte|astro|remix|vite|tailwind)\.config\.[cm]?[jt]s$/, agent: "frontend" },
  { match: /^angular\.json$/, agent: "frontend" },
  // Native app scaffolding.
  { match: /^(metro|app)\.config\.[cm]?[jt]s$/, agent: "mobile" },
  { match: /^Podfile$/, agent: "mobile" },
];

/** Directory globs searched for packages even when nothing declares a workspace. */
const CONVENTIONAL_GLOBS = ["apps/*", "packages/*", "services/*"];

/**
 * How many directories are inspected, at most. A monorepo with hundreds of packages is detected
 * from its first few dozen; reading all of them would trade a slower first open for an answer the
 * user is about to confirm anyway.
 */
const MAX_DIRS = 48;

/** Evidence is for reading, not for auditing: cap the lines and the markers named on each. */
const MAX_EVIDENCE_LINES = 6;
const MAX_MARKERS_PER_LINE = 4;

/** One thing that matched: a dependency name or a filename, and where it was found. */
interface Hit {
  agent: ImplAgent;
  marker: string;
  /** Project-relative directory the marker was found in; "" is the repo root. */
  dir: string;
  /** The file the marker came from, relative to `dir` — "package.json", or the marker itself. */
  file: string;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readDirNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function subdirsOf(root: string, rel: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || IGNORE_DIRS.includes(entry.name)) continue;
    out.push(path.posix.join(rel, entry.name));
  }
  return out;
}

/**
 * Expand a workspace glob to project-relative directories, one level only.
 *
 * Deliberately not a glob library: `apps/*`, `packages/**`, and a bare `tools/api` cover what
 * workspace declarations actually contain, and a dependency here would be paid by the plugin's
 * bundled hook scripts too.
 */
function expandGlob(root: string, glob: string): string[] {
  const clean = glob.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!clean || clean.startsWith("!")) return [];
  const star = clean.indexOf("*");
  if (star === -1) {
    return fs.existsSync(path.join(root, clean)) ? [clean] : [];
  }
  const parent = clean.slice(0, star).replace(/\/+$/, "");
  return subdirsOf(root, parent);
}

/** Workspace member globs declared by npm/yarn/bun (`package.json`) or pnpm. */
function declaredGlobs(root: string, rootManifest: Record<string, unknown> | null): string[] {
  const globs: string[] = [];

  const ws = rootManifest?.workspaces;
  if (Array.isArray(ws)) globs.push(...ws.filter((g): g is string => typeof g === "string"));
  else if (ws && typeof ws === "object" && Array.isArray((ws as { packages?: unknown }).packages)) {
    globs.push(...((ws as { packages: unknown[] }).packages.filter((g) => typeof g === "string") as string[]));
  }

  // pnpm-workspace.yaml, read with a line matcher rather than a YAML parser — the file is a
  // single `packages:` list, and adding a dependency to this package would reach the plugin's
  // standalone hook bundles as well.
  try {
    const yaml = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    let inPackages = false;
    for (const line of yaml.split("\n")) {
      if (/^packages:/.test(line)) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        const item = /^\s+-\s*["']?([^"'#\s]+)["']?/.exec(line);
        if (item) globs.push(item[1]);
        else if (/^\S/.test(line)) inPackages = false;
      }
    }
  } catch {
    /* no pnpm workspace */
  }

  return globs;
}

/** The bounded set of directories detection reads: the root, then its packages. */
function candidateDirs(root: string, rootManifest: Record<string, unknown> | null): string[] {
  const dirs: string[] = [""];
  const seen = new Set(dirs);
  for (const glob of [...declaredGlobs(root, rootManifest), ...CONVENTIONAL_GLOBS]) {
    for (const dir of expandGlob(root, glob)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      dirs.push(dir);
      if (dirs.length >= MAX_DIRS) return dirs;
    }
  }
  return dirs;
}

/** Every dependency name declared by a manifest, across the three fields that carry frameworks. */
function dependencyNames(manifest: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const block = manifest[field];
    if (block && typeof block === "object") for (const name of Object.keys(block)) names.add(name);
  }
  return names;
}

/** Classify one manifest's dependencies. */
function manifestHits(dir: string, manifest: Record<string, unknown>): Hit[] {
  const deps = dependencyNames(manifest);
  const hits: Hit[] = [];
  for (const agent of AGENT_ORDER) {
    for (const marker of DEPENDENCY_SIGNALS[agent]) {
      if (deps.has(marker)) hits.push({ agent, marker, dir, file: "package.json" });
    }
  }
  // `react` alone is ambiguous: React Native and Expo apps depend on it too, and calling them
  // "frontend" would put a web agent on a mobile repo. `react-dom` (above) is the web tell, so
  // bare `react` only counts when nothing in the same manifest says native.
  if (deps.has("react") && !deps.has("react-dom") && !hits.some((h) => h.agent === "mobile")) {
    hits.push({ agent: "frontend", marker: "react", dir, file: "package.json" });
  }
  return hits;
}

function fileHits(root: string, dir: string, names: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const name of names) {
    for (const signal of FILE_SIGNALS) {
      if (signal.match.test(name)) hits.push({ agent: signal.agent, marker: name, dir, file: name });
    }
  }
  // `app.json` is Expo's manifest only when it actually carries an `expo` key — plenty of other
  // tools write an app.json, and claiming a mobile agent off the filename alone would be a guess.
  if (names.includes("app.json")) {
    const appJson = readJson(path.join(root, dir, "app.json"));
    if (appJson && typeof appJson.expo === "object" && appJson.expo !== null) {
      hits.push({ agent: "mobile", marker: "app.json (expo)", dir, file: "app.json" });
    }
  }
  return hits;
}

function inDirPhrase(dir: string): string {
  return dir === "" ? "the repo root" : `${dir}/`;
}

/** "`react-dom`, `next` in package.json → frontend", one line per file that matched. */
function toEvidence(hits: Hit[]): string[] {
  const groups = new Map<string, { agent: ImplAgent; dir: string; file: string; markers: string[] }>();
  for (const hit of hits) {
    const key = `${hit.dir} ${hit.file} ${hit.agent}`;
    const group = groups.get(key) ?? { agent: hit.agent, dir: hit.dir, file: hit.file, markers: [] };
    if (!group.markers.includes(hit.marker)) group.markers.push(hit.marker);
    groups.set(key, group);
  }

  const lines: string[] = [];
  for (const group of groups.values()) {
    const shown = group.markers.slice(0, MAX_MARKERS_PER_LINE).map((m) => `\`${m}\``);
    const extra = group.markers.length - shown.length;
    const markers = shown.join(", ") + (extra > 0 ? ` and ${extra} more` : "");
    lines.push(
      group.file === "package.json"
        ? `${markers} in ${path.posix.join(group.dir, "package.json")} → ${group.agent}`
        : `${markers} in ${inDirPhrase(group.dir)} → ${group.agent}`
    );
  }

  if (lines.length <= MAX_EVIDENCE_LINES) return lines;
  const kept = lines.slice(0, MAX_EVIDENCE_LINES);
  kept.push(
    `…and ${lines.length - MAX_EVIDENCE_LINES} more matching file${lines.length - MAX_EVIDENCE_LINES === 1 ? "" : "s"}`
  );
  return kept;
}

/**
 * Which implementation agent(s) should lead the seeded happy path in `root`, and why.
 *
 * Never returns an empty chain: an unrecognised repo falls back to `["backend"]` with `fallback:
 * true` and evidence saying so, because a workflow whose implementation step is missing is worse
 * than one whose implementation step is a guess the user can change.
 */
export function detectImplAgents(root: string): RepoDetection {
  const rootManifest = readJson(path.join(root, "package.json"));
  const hits: Hit[] = [];

  for (const dir of candidateDirs(root, rootManifest)) {
    const absolute = path.join(root, dir);
    const names = readDirNames(absolute);
    if (names.length === 0) continue;
    if (names.includes("package.json")) {
      const manifest = dir === "" ? rootManifest : readJson(path.join(absolute, "package.json"));
      if (manifest) hits.push(...manifestHits(dir, manifest));
    }
    hits.push(...fileHits(root, dir, names));
  }

  const found = AGENT_ORDER.filter((agent) => hits.some((h) => h.agent === agent));
  if (found.length === 0) {
    return {
      implAgents: ["backend"],
      evidence: ["No framework dependencies or language manifests matched — defaulting to `backend`."],
      fallback: true,
    };
  }

  // Evidence is ordered the way the chain is, so the line explaining the first agent reads first.
  const ordered = found.flatMap((agent) => hits.filter((h) => h.agent === agent));
  return { implAgents: found, evidence: toEvidence(ordered), fallback: false };
}
