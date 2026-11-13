#!/usr/bin/env node
// Containerized Maestro workers (`175`): run an epic's /maestro worker sessions inside a
// per-project Docker container.
// The mechanics live in lib/maestro-worker-runtime.cjs (generated from
// apps/maestro/src/core/worker-runtime.ts); this script owns every process spawn and the output.
// Project root: $CLAUDE_PROJECT_DIR, then the cwd, resolved to the main checkout.
//
//   node maestro-worker-runtime.cjs image [--with-package <name@version>]... [--print-tag]
//       Builds the project's worker image, or reuses it when one with the same tag exists. The tag
//       is a hash of the plugins the project enables (pinned to the versions installed on this
//       host), the npm packages their hooks need, the Claude Code version, the host uid/gid and the
//       project path, so a plugin version bump builds a new image. --print-tag only prints the tag.
//       No secret is read, copied or baked.
//   node maestro-worker-runtime.cjs run --name <worker name> [--model <model>] <.claude/maestro-tasks/NNN-task.md>
//       Starts ONE worker: `docker run -it --rm` with the repo bind-mounted at its real path, the
//       settings/hook paths read-only over it, a hooks-less copy of settings.local.json, the task's
//       sibling worktree mounted at its own path, and CLAUDE_CODE_OAUTH_TOKEN read from
//       ~/.config/maestro/worker-token (passed through the environment, never printed or put in
//       argv). Stops with a setup message, before starting anything, when the token file is
//       missing. The herdr socket is never mounted.
//       `177`: with manager_approval true in maestro.json, ~/.config/maestro/approvals is also mounted
//       read-only (and named in MAESTRO_APPROVALS_DIR), so a worker can read approvals, never write one.
//       `176`: the image carries every plugin the host session has enabled, user scope included, and
//       `run` checks that (a shell probe in the image) and refuses an image missing one, naming it.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { mainCheckoutRoot } = require("./lib/maestro-session.cjs");
const rt = require("./lib/maestro-worker-runtime.cjs");

function fail(message) {
  process.stderr.write(`maestro-worker-runtime: ${message}\n`);
  process.exit(1);
}

function parse(args) {
  const positional = [];
  const flags = {};
  const packages = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--print-tag") flags["print-tag"] = true;
    else if (args[i] === "--with-package" && i + 1 < args.length) packages.push(args[(i += 1)]);
    else if (args[i].startsWith("--") && i + 1 < args.length) flags[args[i].slice(2)] = args[(i += 1)];
    else positional.push(args[i]);
  }
  return { positional, flags, packages };
}

function capture(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return r.error || r.status !== 0 ? null : String(r.stdout).trim();
}

// The git-tracked files of a directory that is itself a repo root, else null (the caller then
// copies with the exclusion filter alone).
function gitTrackedFiles(dir) {
  if (!fs.existsSync(path.join(dir, ".git"))) return null;
  const r = spawnSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout).split("\0").filter(Boolean);
}

function claudeVersion() {
  const out = capture("claude", ["--version"]);
  const m = out && /(\d+\.\d+\.\d+[^\s]*)/.exec(out);
  if (!m) fail("cannot read the Claude Code version: `claude --version` did not answer");
  return m[1];
}

function requireDocker() {
  const r = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (r.error || r.status !== 0) fail("docker is not available on this machine's PATH");
}

function imageExists(tag) {
  return spawnSync("docker", ["image", "inspect", tag], { stdio: "ignore" }).status === 0;
}

// `179`: the project's own verify command, so the image can carry what it needs.
function verifyCommandOf(root) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8")).verify_command;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function specFor(root, extraPackages) {
  const { spec, missing } = rt.gatherImageSpec(root, {
    verifyCommand: verifyCommandOf(root),
    home: os.homedir(),
    uid: process.getuid(),
    gid: process.getgid(),
    claudeVersion: claudeVersion(),
    extraPackages,
  });
  if (missing.length)
    fail(`these enabled plugins have no install on this host: ${missing.join(", ")}. Install them with /plugin first.`);
  return spec;
}

const argv = process.argv.slice(2);
const command = argv[0];
const { positional, flags, packages } = parse(argv.slice(1));
const root = mainCheckoutRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());

try {
  switch (command) {
    case "image": {
      let spec;
      try {
        spec = specFor(root, packages);
      } catch (err) {
        fail(err.message);
      }
      const tag = rt.imageTag(spec);
      if (flags["print-tag"]) {
        process.stdout.write(`${tag}\n`);
        break;
      }
      requireDocker();
      if (imageExists(tag)) {
        process.stdout.write(`maestro worker image ${tag} is up to date; reusing it\n`);
        break;
      }
      const ctx = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-worker-image-"));
      try {
        rt.writeBuildContext(ctx, spec, { trackedFiles: gitTrackedFiles });
        process.stdout.write(`building maestro worker image ${tag}\n`);
        const b = spawnSync("docker", ["build", "-t", tag, ctx], { stdio: "inherit" });
        if (b.status !== 0) fail(`docker build failed (exit ${b.status})`);
      } finally {
        fs.rmSync(ctx, { recursive: true, force: true });
      }
      process.stdout.write(`built ${tag}\n`);
      break;
    }
    case "run": {
      const name = flags.name;
      const taskArg = positional[0];
      if (!name || !taskArg)
        fail("usage: run --name <worker name> [--model <model>] <.claude/maestro-tasks/NNN-task.md>");
      // The token first: a missing file stops here, before docker is touched.
      const tokenPath = path.join(os.homedir(), rt.WORKER_TOKEN_REL);
      const token = rt.readWorkerToken(tokenPath);
      if (!token.ok) {
        process.stderr.write(`${token.message}\n`);
        process.exit(1);
      }
      const taskRel = path.posix.join(".claude", "maestro-tasks", path.basename(taskArg));
      if (!fs.existsSync(path.join(root, taskRel))) fail(`no such task file: ${taskRel}`);
      requireDocker();
      const spec = specFor(root, []);
      const tag = rt.imageTag(spec);
      if (!imageExists(tag))
        fail(
          `the worker image ${tag} does not exist. Build it first: node .claude/scripts/maestro-worker-runtime.cjs image`
        );

      // `176`: refuse an image that lacks a plugin the host session has enabled, instead of a worker
      // that stops mid-run on a missing agent. Shell-only: nothing of claude runs.
      const probe = spawnSync("docker", ["run", "--rm", "--entrypoint", "sh", tag, "-c", rt.imagePluginProbe(spec)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (probe.error || probe.status !== 0)
        fail(`cannot check the plugins in image ${tag}: ${String(probe.stderr || probe.error).trim()}`);
      const lacking = rt.parseProbeOutput(String(probe.stdout));
      if (lacking.length) fail(rt.missingPluginMessage(tag, lacking));

      const worktreePath = rt.worktreeMountPath(root, taskRel);
      if (worktreePath) fs.mkdirSync(worktreePath, { recursive: true });

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-worker-"));
      try {
        let filtered = null;
        const localPath = path.join(root, ".claude", "settings.local.json");
        if (fs.existsSync(localPath)) {
          filtered = path.join(tmp, "settings.local.json");
          try {
            fs.writeFileSync(filtered, rt.filterSettingsLocal(fs.readFileSync(localPath, "utf8")));
          } catch (err) {
            fail(`cannot prepare settings.local.json: ${err.message}`);
          }
        }
        // `177`: with manager_approval on, the approvals directory (outside the repo) is mounted
        // read-only, so a worker reads approval records and can never write one. Off: no mount.
        let approvals = null;
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));
          if (rt.resolveManagerApproval(cfg)) {
            approvals = rt.approvalsDir(os.homedir());
            fs.mkdirSync(approvals, { recursive: true });
          }
        } catch {
          approvals = null;
        }
        const mounts = rt.workerMounts({
          repoRoot: root,
          worktreePath,
          filteredSettingsLocal: filtered,
          exists: (p) => fs.existsSync(p),
          approvalsDir: approvals,
        });
        const args = rt.workerRunArgs({
          tag,
          name,
          taskRel,
          model: flags.model,
          repoRoot: root,
          mounts,
          gitIdentity: {
            name: capture("git", ["-C", root, "config", "user.name"]) || undefined,
            email: capture("git", ["-C", root, "config", "user.email"]) || undefined,
          },
        });
        const r = spawnSync("docker", args, {
          stdio: "inherit",
          env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token.token },
        });
        process.exitCode = r.status === null ? 1 : r.status;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      break;
    }
    default:
      fail("usage: image [--with-package <name@version>]... [--print-tag] | run --name <name> [--model <m>] <task.md>");
  }
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
