// `175`: the containerized worker runtime — launch command for both runtimes, the mount list, the
// settings.local.json hooks filter, the image-tag inputs and the token handling.

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { launchCommandFor } from "../../src/core/epics.js";
import { blankConfig } from "../../src/core/config.js";
import {
  READONLY_PATHS,
  claudeJsonFor,
  trustedPaths,
  isExcludedPath,
  knownMarketplacesJsonFor,
  containerNameFor,
  dockerLaunchCommandFor,
  dockerfileFor,
  enabledPluginIds,
  filterSettingsLocal,
  gatherImageSpec,
  hookPackagesFor,
  imageTag,
  imageTagInputs,
  installedPluginsJsonFor,
  parsePackageSpecs,
  pinPlugins,
  readWorkerToken,
  resolveWorkerRuntime,
  tokenSetupMessage,
  workerMounts,
  workerRunArgs,
  worktreeMountPath,
  writeBuildContext,
  type ImageSpec,
} from "../../src/core/worker-runtime.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const tmps: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "worker-runtime-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const spec = (over: Partial<ImageSpec> = {}): ImageSpec => ({
  projectRoot: "/home/u/gits/proj",
  uid: 1000,
  gid: 1000,
  claudeVersion: "2.1.322",
  plugins: [{ id: "code-graph@code-graph", version: "1.2.3", installPath: "/x" }],
  npmPackages: { "ts-morph": "28.0.0" },
  ...over,
});

describe("launch command per runtime (175)", () => {
  it("host is byte-identical to the pre-175 command, with or without a model", () => {
    expect(launchCommandFor("e-001", "001-a.md")).toBe("claude -n 'e-001' '/maestro .claude/maestro-tasks/001-a.md'");
    expect(launchCommandFor("e-001", "001-a.md", "sonnet", "host")).toBe(
      "claude -n 'e-001' --model 'sonnet' '/maestro .claude/maestro-tasks/001-a.md'"
    );
  });

  it("docker calls the launcher script from the main checkout, quoting every value", () => {
    expect(launchCommandFor("e-001", "dir/001-a.md", undefined, "docker")).toBe(
      "node .claude/scripts/maestro-worker-runtime.cjs run --name 'e-001' '.claude/maestro-tasks/001-a.md'"
    );
    expect(dockerLaunchCommandFor("e-001", "001-a.md", "x'y")).toBe(
      "node .claude/scripts/maestro-worker-runtime.cjs run --name 'e-001' --model 'x'\\''y' '.claude/maestro-tasks/001-a.md'"
    );
  });

  it("resolveWorkerRuntime is docker only for the string docker", () => {
    const cfg = (v: unknown) => ({ ...blankConfig(), worker_runtime: v }) as MaestroConfigV3;
    expect(resolveWorkerRuntime(cfg("docker"))).toBe("docker");
    expect(resolveWorkerRuntime(cfg(" Docker "))).toBe("docker");
    for (const v of ["host", "", "podman", 1, null, undefined]) expect(resolveWorkerRuntime(cfg(v))).toBe("host");
    expect(resolveWorkerRuntime(null)).toBe("host");
  });
});

describe("filterSettingsLocal (175)", () => {
  it("removes hooks and keeps everything else", () => {
    const out = JSON.parse(
      filterSettingsLocal(
        JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { PreToolUse: [] }, env: { A: "1" } })
      )
    );
    expect(out).toEqual({ permissions: { allow: ["Bash(ls)"] }, env: { A: "1" } });
  });

  it("keeps a file with no hooks as it is and refuses non-objects", () => {
    expect(JSON.parse(filterSettingsLocal('{"a":1}'))).toEqual({ a: 1 });
    expect(() => filterSettingsLocal("[]")).toThrow();
    expect(() => filterSettingsLocal("not json")).toThrow();
  });
});

describe("workerMounts and workerRunArgs (175)", () => {
  const repo = "/home/u/gits/proj";
  const wt = "/home/u/gits/proj-task-175";

  it("mounts the repo, the existing read-only paths, the filtered settings.local and the worktree", () => {
    const existing = new Set(READONLY_PATHS.map((p) => path.join(repo, p)));
    const m = workerMounts({
      repoRoot: repo,
      worktreePath: wt,
      filteredSettingsLocal: "/tmp/f/settings.local.json",
      exists: (p) => existing.has(p),
    });
    expect(m[0]).toEqual({ source: repo, target: repo, readonly: false });
    expect(m.filter((x) => x.readonly).map((x) => x.target)).toEqual(READONLY_PATHS.map((p) => path.join(repo, p)));
    expect(m.find((x) => x.target === `${repo}/.claude/settings.local.json`)?.source).toBe(
      "/tmp/f/settings.local.json"
    );
    expect(m[m.length - 1]).toEqual({ source: wt, target: wt, readonly: false });
  });

  it("skips read-only paths that do not exist, and settings.local when there is no copy", () => {
    const m = workerMounts({ repoRoot: repo, worktreePath: null, filteredSettingsLocal: null, exists: () => false });
    expect(m).toEqual([{ source: repo, target: repo, readonly: false }]);
  });

  it("the worktree path is the sibling <repo>-task-N", () => {
    expect(worktreeMountPath(repo, "175-x.md")).toBe(wt);
    expect(worktreeMountPath(repo, "x.md")).toBeNull();
  });

  it("builds docker run with the token by name only, the marker env, no herdr socket, and the host claude launch", () => {
    const mounts = workerMounts({ repoRoot: repo, worktreePath: wt, filteredSettingsLocal: null, exists: () => true });
    const args = workerRunArgs({
      tag: "img:1",
      name: "e1-175",
      taskRel: ".claude/maestro-tasks/175-x.md",
      model: "sonnet",
      repoRoot: repo,
      mounts,
      gitIdentity: { name: "A B", email: "a@b.c" },
    });
    expect(args.slice(0, 5)).toEqual(["run", "-it", "--rm", "--name", "maestro-worker-e1-175"]);
    expect(args).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(args.join(" ")).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN=/);
    expect(args).toContain("MAESTRO_WORKER_RUNTIME=docker");
    expect(args).toContain("GIT_AUTHOR_EMAIL=a@b.c");
    expect(args.join(" ")).not.toMatch(/herdr/i);
    expect(args).toContain(`${repo}:${repo}`);
    expect(args).toContain(`${repo}/.git/config:${repo}/.git/config:ro`);
    expect(args.slice(args.indexOf("img:1"))).toEqual([
      "img:1",
      "claude",
      "-n",
      "e1-175",
      "--model",
      "sonnet",
      "/maestro .claude/maestro-tasks/175-x.md",
    ]);
    expect(args[args.indexOf("-w") + 1]).toBe(repo);
  });

  it("omits --model when none is set and sanitises the container name", () => {
    const args = workerRunArgs({ tag: "t", name: "a b/c", taskRel: "r", repoRoot: "/r", mounts: [] });
    expect(args).not.toContain("--model");
    expect(containerNameFor("a b/c")).toBe("maestro-worker-a-b-c");
  });
});

describe("worker token (175)", () => {
  it("a missing or blank file gives the setup message and never a token", () => {
    const dir = tmp();
    const p = path.join(dir, "worker-token");
    const missing = readWorkerToken(p);
    expect(missing).toEqual({ ok: false, message: tokenSetupMessage(p) });
    expect(missing.ok === false && missing.message).toContain("claude setup-token");
    fs.writeFileSync(p, "  \n");
    expect(readWorkerToken(p).ok).toBe(false);
  });

  it("returns the trimmed token when present", () => {
    const p = path.join(tmp(), "worker-token");
    fs.writeFileSync(p, "tok-123\n");
    expect(readWorkerToken(p)).toEqual({ ok: true, token: "tok-123" });
  });
});

describe("image tag inputs (175)", () => {
  it("is stable for unchanged inputs and independent of plugin order", () => {
    const a = spec({
      plugins: [
        { id: "b@m", version: "1", installPath: "/b" },
        { id: "a@m", version: "2", installPath: "/a" },
      ],
    });
    const b = spec({ plugins: [...a.plugins].reverse() });
    expect(imageTag(a)).toBe(imageTag(b));
    expect(imageTag(spec())).toBe(imageTag(spec()));
    expect(imageTag(spec())).toMatch(/^maestro-worker-proj:[0-9a-f]{12}$/);
  });

  it("changes with a plugin version, a hook dependency, the Claude Code version, the uid and the project path", () => {
    const base = imageTag(spec());
    const bumped = spec({ plugins: [{ id: "code-graph@code-graph", version: "1.2.4", installPath: "/x" }] });
    expect(imageTag(bumped)).not.toBe(base);
    expect(imageTag(spec({ npmPackages: {} }))).not.toBe(base);
    expect(imageTag(spec({ claudeVersion: "2.2.0" }))).not.toBe(base);
    expect(imageTag(spec({ uid: 1001 }))).not.toBe(base);
    expect(imageTag(spec({ projectRoot: "/home/u/gits/other" }))).not.toBe(base);
  });

  it("the tag inputs name plugins at pinned versions and the hook packages, and nothing secret", () => {
    const inputs = imageTagInputs(spec());
    expect(inputs.plugins).toEqual(["code-graph@code-graph@1.2.3"]);
    expect(inputs.npm).toEqual(["ts-morph@28.0.0"]);
    expect(JSON.stringify(inputs)).not.toMatch(/token|secret/i);
  });

  it("pins enabled plugins to the installed version and reports ones with no install", () => {
    const installed = {
      plugins: {
        "a@m": [{ scope: "user", installPath: "/cache/a/1", version: "1" }],
        "b@m": [{ scope: "project", installPath: "/cache/b/2", version: "2" }],
      },
    };
    expect(enabledPluginIds({ enabledPlugins: { "a@m": true, "b@m": true, "c@m": true, "d@m": false } })).toEqual([
      "a@m",
      "b@m",
      "c@m",
    ]);
    expect(pinPlugins(["b@m", "a@m", "c@m"], installed)).toEqual({
      pins: [
        { id: "a@m", version: "1", installPath: "/cache/a/1" },
        { id: "b@m", version: "2", installPath: "/cache/b/2" },
      ],
      missing: ["c@m"],
    });
  });

  it("hook packages: a hook script naming ts-morph gets it; extras are merged and must carry a version", () => {
    const withHook = tmp();
    fs.mkdirSync(path.join(withHook, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(withHook, "stop.cjs"), 'const m = requireFromProject("ts-morph");');
    fs.writeFileSync(path.join(withHook, "node_modules", "dep", "i.js"), 'require("ts-morph")');
    const without = tmp();
    fs.writeFileSync(path.join(without, "a.cjs"), "// mentions ts-morph in a comment only\nrequire('fs');");
    const own = tmp();
    fs.writeFileSync(path.join(own, "lib.cjs"), 'const KNOWN_HOOK_PACKAGES = {"ts-morph":"1"};');
    expect(hookPackagesFor([withHook])).toEqual({ "ts-morph": "28.0.0" });
    expect(hookPackagesFor([without, own, path.join(without, "missing")])).toEqual({});
    expect(hookPackagesFor([without], parsePackageSpecs(["@scope/p@1.0.0", "q@2"]))).toEqual({
      "@scope/p": "1.0.0",
      q: "2",
    });
    expect(() => parsePackageSpecs(["nover"])).toThrow();
    expect(() => parsePackageSpecs(["trailing@"])).toThrow();
  });

  it("gatherImageSpec reads the project's settings and the host's installed plugins", () => {
    const home = tmp();
    const proj = tmp();
    fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "code-graph@code-graph": [{ scope: "user", installPath: "/c", version: "9" }] } })
    );
    fs.mkdirSync(path.join(proj, ".claude"));
    fs.mkdirSync(path.join(proj, ".claude", "hooks"));
    fs.writeFileSync(path.join(proj, ".claude", "hooks", "h.mjs"), 'await import("ts-morph");');
    fs.writeFileSync(
      path.join(proj, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "code-graph@code-graph": true } })
    );
    const { spec: s, missing } = gatherImageSpec(proj, { home, uid: 5, gid: 6, claudeVersion: "2.0.0" });
    expect(missing).toEqual([]);
    expect(s.plugins).toEqual([{ id: "code-graph@code-graph", version: "9", installPath: "/c" }]);
    expect(s.npmPackages).toEqual({ "ts-morph": "28.0.0" });
    expect([s.uid, s.gid, s.claudeVersion]).toEqual([5, 6, "2.0.0"]);
    expect(s.marketplaces).toEqual([]);
  });

  it("gatherImageSpec bakes the marketplace metadata of the pinned plugins only", () => {
    const home = tmp();
    const proj = tmp();
    const mdir = path.join(home, ".claude", "plugins", "marketplaces", "code-graph");
    fs.mkdirSync(mdir, { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "p@code-graph": [{ scope: "user", installPath: "/c", version: "1" }] } })
    );
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "known_marketplaces.json"),
      JSON.stringify({
        "code-graph": { source: { source: "github", repo: "o/r" }, installLocation: mdir },
        other: { source: { source: "github", repo: "o/x" }, installLocation: "/nope" },
      })
    );
    fs.mkdirSync(path.join(proj, ".claude"));
    fs.writeFileSync(
      path.join(proj, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "p@code-graph": true } })
    );
    const { spec: s } = gatherImageSpec(proj, { home, uid: 1, gid: 1, claudeVersion: "2" });
    expect(s.marketplaces?.map((m) => [m.name, m.dir])).toEqual([["code-graph", mdir]]);
  });
});

describe("image files (175)", () => {
  it("the pre-filled claude.json completes onboarding, sets the theme and trusts the real path", () => {
    const j = JSON.parse(claudeJsonFor("/home/u/gits/proj"));
    expect(j.hasCompletedOnboarding).toBe(true);
    expect(j.theme).toBe("dark");
    expect(j.projects["/home/u/gits/proj"]).toEqual({ hasTrustDialogAccepted: true });
  });

  it("the Dockerfile installs the pinned Claude Code and hook packages, uses the host uid, and copies no credential", () => {
    const d = dockerfileFor(spec({ uid: 1234, gid: 4321 }));
    expect(d).toContain("@anthropic-ai/claude-code@2.1.322 ts-morph@28.0.0");
    expect(d).toContain("useradd -m -u 1234 -g 4321");
    expect(d).toContain("USER 1234:4321");
    expect(d).not.toMatch(/OAUTH|worker-token|credentials|\.env/i);
  });

  it("installed_plugins.json points each plugin at its container path", () => {
    const j = JSON.parse(installedPluginsJsonFor(spec().plugins));
    expect(j.plugins["code-graph@code-graph"][0].installPath).toBe(
      "/home/worker/.claude/plugins/cache/code-graph/code-graph/1.2.3"
    );
  });

  it("writeBuildContext writes the files and copies each pinned plugin, nothing else", () => {
    const plugin = tmp();
    fs.writeFileSync(path.join(plugin, "hook.js"), "x");
    const ctx = path.join(tmp(), "ctx");
    writeBuildContext(ctx, spec({ plugins: [{ id: "p@m", version: "3", installPath: plugin }] }));
    expect(fs.readdirSync(ctx).sort()).toEqual([
      ".dockerignore",
      "Dockerfile",
      "claude.json",
      "installed_plugins.json",
      "known_marketplaces.json",
      "managed-settings.json",
      "marketplaces",
      "plugins",
    ]);
    expect(fs.existsSync(path.join(ctx, "plugins", "m", "p", "3", "hook.js"))).toBe(true);
  });

  function fakeMarketplace(): string {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "marketplace.json"), "{}");
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=1");
    fs.writeFileSync(path.join(dir, ".env.local"), "SECRET=2");
    fs.writeFileSync(path.join(dir, ".npmrc"), "//registry:_authToken=x");
    fs.writeFileSync(path.join(dir, ".credentials.json"), "{}");
    fs.writeFileSync(path.join(dir, "key.pem"), "k");
    fs.writeFileSync(path.join(dir, "id_rsa"), "k");
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "config"), "x");
    fs.mkdirSync(path.join(dir, "node_modules", "d"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "d", "i.js"), "x");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", ".env"), "SECRET=3");
    fs.writeFileSync(path.join(dir, "sub", "ok.md"), "ok");
    return dir;
  }

  function listAll(root: string, rel = ""): string[] {
    return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
      const r = path.join(rel, e.name);
      return e.isDirectory() ? listAll(root, r) : [r];
    });
  }

  it("no secret, .git or node_modules lands in the context, with or without git's file list", () => {
    for (const tracked of [
      null,
      [".env", ".npmrc", "marketplace.json", "sub/.env", "sub/ok.md", "gone.md", ".git/config"],
    ]) {
      const ctx = path.join(tmp(), "ctx");
      const dir = fakeMarketplace();
      writeBuildContext(ctx, spec({ plugins: [], marketplaces: [{ name: "m", entry: { source: {} }, dir }] }), {
        trackedFiles: () => tracked,
      });
      expect(listAll(path.join(ctx, "marketplaces", "m")).sort()).toEqual([
        "marketplace.json",
        path.join("sub", "ok.md"),
      ]);
      const all = listAll(ctx).join("\n");
      expect(all).not.toMatch(/\.env|\.npmrc|\.credentials|\.pem|id_rsa|node_modules|\.git[\\/]/);
    }
  });

  it("plugin cache copies get the same exclusions, and .dockerignore lists them", () => {
    const plugin = fakeMarketplace();
    const ctx = path.join(tmp(), "ctx");
    writeBuildContext(ctx, spec({ plugins: [{ id: "p@m", version: "1", installPath: plugin }] }));
    expect(listAll(path.join(ctx, "plugins", "m", "p", "1")).sort()).toEqual([
      "marketplace.json",
      path.join("sub", "ok.md"),
    ]);
    const ignore = fs.readFileSync(path.join(ctx, ".dockerignore"), "utf8");
    for (const n of [".git", "node_modules", ".env*", ".credentials.json", "*.pem", "id_rsa*", ".npmrc"])
      expect(ignore).toContain(`**/${n}`);
    expect(isExcludedPath("a/.env.production")).toBe(true);
    expect(isExcludedPath("a/b.md")).toBe(false);
  });

  it("the layout marker is part of the tag inputs", () => {
    expect(imageTagInputs(spec()).layout).toBe(3);
  });

  it("trusts the project and its parent, so a sibling <repo>-task-N worktree needs no prompt", () => {
    expect(trustedPaths("/home/u/gits/proj")).toEqual(["/home/u/gits/proj", "/home/u/gits"]);
    expect(trustedPaths("/proj")).toEqual(["/proj"]);
    const projects = JSON.parse(claudeJsonFor("/home/u/gits/proj")).projects;
    expect(Object.keys(projects).sort()).toEqual(["/home/u/gits", "/home/u/gits/proj"]);
    expect(imageTag(spec())).not.toBe(imageTag(spec({ projectRoot: "/home/u/other/proj" })));
  });

  it("known_marketplaces.json keeps the non-secret entry, retargets the install location, and refuses a credentialed URL", () => {
    const entry = { source: { source: "github", repo: "o/r" }, lastUpdated: "t", installLocation: "/host/m" };
    const j = JSON.parse(knownMarketplacesJsonFor([{ name: "m", entry, dir: null }]));
    expect(j.m.source).toEqual({ source: "github", repo: "o/r" });
    expect(j.m.installLocation).toBe("/home/worker/.claude/plugins/marketplaces/m");
    const bad = { source: { source: "git", url: "https://user:pw@host/r.git" } };
    expect(() => knownMarketplacesJsonFor([{ name: "x", entry: bad, dir: null }])).toThrow(/credentials/);
  });

  it("writeBuildContext copies a marketplace directory and the marketplace source feeds the tag", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "marketplace.json"), "{}");
    const ctx = path.join(tmp(), "ctx");
    const withM = spec({ plugins: [], marketplaces: [{ name: "m", entry: { source: { repo: "o/r" } }, dir }] });
    writeBuildContext(ctx, withM);
    expect(fs.existsSync(path.join(ctx, "marketplaces", "m", "marketplace.json"))).toBe(true);
    expect(imageTag(withM)).not.toBe(imageTag(spec()));
    expect(dockerfileFor(withM)).toContain("known_marketplaces.json");
  });
});
