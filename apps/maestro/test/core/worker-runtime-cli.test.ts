// `175` through the REAL installed launcher: maestro-worker-runtime.cjs (image, run), spawned against a
// temp project exactly as the spawn list's printed command would run it. `docker` and `claude` are
// stubs first on PATH that record what they were called with; nothing real is started. Harness rules
// as in epics-cli.test.ts: HOME pinned to a temp dir, CLAUDE_CODE_SESSION_ID deleted, and the child
// environment is built explicitly, never inherited, so a developer's real CLAUDE_CODE_OAUTH_TOKEN or
// real ~/.config/maestro/worker-token can never reach the test.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const TOKEN = "tok-TEST-ONLY-175-do-not-use";
const LAUNCHER = ".claude/scripts/maestro-worker-runtime.cjs";

let tmp: string;
let home: string;
let bin: string;
let root: string;
let dockerLog: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-175-"));
  home = path.join(tmp, "home");
  bin = path.join(tmp, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  dockerLog = path.join(tmp, "docker.log");
  writeStub("claude", `echo "2.1.322 (Claude Code)"`);
  writeStub(
    "docker",
    [
      `{ echo CALL; for a in "$@"; do printf '%s\\n' "$a"; done; } >> "$DOCKER_LOG"`,
      `case "$1" in`,
      `  --version) exit 0 ;;`,
      `  image) if [ "$3" = "$EXISTING_TAG" ]; then exit 0; else exit 1; fi ;;`,
      `  build) if [ -n "$CTX_OUT" ]; then cp -R "$4" "$CTX_OUT"; fi; exit 0 ;;`,
      `  run)`,
      `    printf '%s' "$CLAUDE_CODE_OAUTH_TOKEN" > "$TOKEN_ENV_OUT"`,
      `    for a in "$@"; do case "$a" in */.claude/settings.local.json:*) cp "\${a%%:*}" "$SETTINGS_OUT" ;; esac; done`,
      `    exit 0 ;;`,
      `esac`,
      `exit 0`,
    ].join("\n")
  );
  root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeStub(name: string, body: string): void {
  const p = path.join(bin, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
}

async function installed(): Promise<void> {
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", "175-x.md"), "# task\n");
}

function writeToken(): void {
  const dir = path.join(home, ".config", "maestro");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "worker-token"), `${TOKEN}\n`, { mode: 0o600 });
}

/** Only what the launcher needs; nothing inherited from the developer's environment. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: home,
    TMPDIR: tmp,
    CLAUDE_PROJECT_DIR: root,
    DOCKER_LOG: dockerLog,
    ...extra,
  };
}

function launcher(args: string[], extra: Record<string, string> = {}) {
  const res = spawnSync("node", [path.join(root, LAUNCHER), ...args], {
    encoding: "utf8",
    env: childEnv(extra),
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Each docker call the stub recorded, as its argv. */
function dockerCalls(): string[][] {
  if (!fs.existsSync(dockerLog)) return [];
  const calls: string[][] = [];
  for (const line of fs.readFileSync(dockerLog, "utf8").split("\n")) {
    if (line === "CALL") calls.push([]);
    else if (line !== "" && calls.length) calls[calls.length - 1]!.push(line);
  }
  return calls;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe("the launcher run command (175)", () => {
  it("with no token file it stops with the setup message and never touches docker", async () => {
    await installed();
    const r = launcher(["run", "--name", "e1-175", ".claude/maestro-tasks/175-x.md"], { EXISTING_TAG: "*" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("claude setup-token");
    expect(r.stderr).toContain(path.join(home, ".config", "maestro", "worker-token"));
    expect(fs.existsSync(dockerLog)).toBe(false);
    expect(fs.existsSync(`${root}-task-175`)).toBe(false);
  });

  it("with a token it passes the token by environment only, mounts the right paths, and never prints it", async () => {
    await installed();
    writeToken();
    fs.writeFileSync(
      path.join(root, ".claude", "settings.local.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(ls)"] },
        hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "guard" }] }] },
      })
    );
    const tokenEnv = path.join(tmp, "token-env.txt");
    const settingsOut = path.join(tmp, "settings-seen.json");
    const tag = launcher(["image", "--print-tag"]).stdout.trim();
    const r = launcher(["run", "--name", "e1-175", "--model", "sonnet", ".claude/maestro-tasks/175-x.md"], {
      EXISTING_TAG: tag,
      TOKEN_ENV_OUT: tokenEnv,
      SETTINGS_OUT: settingsOut,
    });

    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);

    // The recorded calls are --version, image inspect and run; only the run argv is checked here.
    const argv = dockerCalls().find((c) => c[0] === "run");
    expect(argv).toBeDefined();
    expect(argv.join("\n")).not.toContain(TOKEN);
    expect(argv).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(argv.some((a) => a.includes("herdr"))).toBe(false);
    expect(argv.some((a) => a.startsWith("--volume") || a.startsWith("--mount"))).toBe(false);

    // The token reached docker through its environment, and only there.
    expect(fs.readFileSync(tokenEnv, "utf8")).toBe(TOKEN);

    // The repo at its real path, the read-only paths over it, and the worktree at its own path.
    const mounts = argv.filter((_, i) => argv[i - 1] === "-v");
    expect(mounts).toContain(`${root}:${root}`);
    expect(mounts).toContain(`${root}/.claude/scripts:${root}/.claude/scripts:ro`);
    expect(mounts).toContain(`${root}/.git/config:${root}/.git/config:ro`);
    expect(mounts.some((m) => m.endsWith(`${root}/.claude/settings.local.json:ro`))).toBe(true);
    const worktree = `${root}-task-175`;
    expect(mounts).toContain(`${worktree}:${worktree}`);
    expect(fs.statSync(worktree).isDirectory()).toBe(true);

    // The mounted settings.local.json is the copy with hooks removed, everything else kept.
    const seen = JSON.parse(fs.readFileSync(settingsOut, "utf8"));
    expect(seen).toEqual({ permissions: { allow: ["Bash(ls)"] } });

    // The claude invocation is the host launch, verbatim, after the image tag.
    const tail = argv.slice(argv.indexOf(tag));
    expect(tail).toEqual([
      tag,
      "claude",
      "-n",
      "e1-175",
      "--model",
      "sonnet",
      "/maestro .claude/maestro-tasks/175-x.md",
    ]);
  });
});

describe("the launcher image command (175)", () => {
  it("reuses an existing image for unchanged inputs and rebuilds after a plugin version bump", async () => {
    await installed();
    const installedFile = path.join(home, ".claude", "plugins", "installed_plugins.json");
    const writeInstalled = (version: string) => {
      fs.mkdirSync(path.dirname(installedFile), { recursive: true });
      const dir = path.join(home, ".claude", "plugins", "cache", "m", "p", version);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "hook.cjs"), "module.exports = {};\n");
      fs.writeFileSync(
        installedFile,
        JSON.stringify({ version: 2, plugins: { "p@m": [{ scope: "user", installPath: dir, version }] } })
      );
    };
    writeInstalled("1.0.0");
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "p@m": true } }));

    const tag1 = launcher(["image", "--print-tag"]).stdout.trim();
    expect(tag1).toMatch(/^maestro-worker-/);

    const reuse = launcher(["image"], { EXISTING_TAG: tag1 });
    expect(reuse.code).toBe(0);
    expect(reuse.stdout).toContain("reusing");
    expect(dockerCalls().some((c) => c[0] === "build")).toBe(false);

    writeInstalled("1.0.1");
    const tag2 = launcher(["image", "--print-tag"]).stdout.trim();
    expect(tag2).not.toBe(tag1);
    const rebuild = launcher(["image"], { EXISTING_TAG: tag1 });
    expect(rebuild.code).toBe(0);
    const build = dockerCalls().find((c) => c[0] === "build");
    expect(build?.[2]).toBe(tag2);
  });

  it("the build context carries no token: no file in it contains the worker token", async () => {
    await installed();
    writeToken();
    const pluginDir = path.join(home, ".claude", "plugins", "cache", "m", "p", "1.0.0");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "hook.cjs"), "module.exports = {};\n");
    fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "p@m": [{ scope: "user", installPath: pluginDir, version: "1.0.0" }] } })
    );
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "p@m": true } }));

    const ctxOut = path.join(tmp, "ctx-copy");
    const r = launcher(["image"], { EXISTING_TAG: "", CTX_OUT: ctxOut });
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);

    const files = walk(ctxOut);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => path.basename(f) === "Dockerfile")).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("plugins", "m", "p", "1.0.0", "hook.cjs")))).toBe(true);
    for (const f of files) {
      expect(path.basename(f)).not.toMatch(/worker-token|credentials|\.env/);
      expect(fs.readFileSync(f, "utf8")).not.toContain(TOKEN);
    }
  });
});
