// The `claude` bridge.
//
// Most of this file is about one property: *the only executable prompts are ones the user was
// shown*. That is not visible in any single function — it comes from preview being unable to spawn
// and run being unable to accept anything but a token — so both halves are asserted directly,
// including the structural half that no behavioural test can reach.
//
// A run is an **Agent SDK session** since `018`, not a `claude -p` spawn, and the tests moved with
// it. Two levels, because the old shell-script fake could serve both and a fake cannot speak the
// SDK's private stdio protocol:
//
//   • The **session is injected** (`ClaudeRunDeps`), so the outcome mapping, the streaming, the
//     token contract and the write scope that rides on the token are checked without an SDK, a real
//     `claude`, or money.
//   • The **spawn function is tested directly** (`spawnClaudeChild`), because "the process group
//     really dies" is the one property no fake can demonstrate and the one Stop depends on.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { previewClaudeRun, CLAUDE_BASE_FLAGS } from "../../src/core/claude-preview.js";
import { resolveClaudeCli, claudeSearchDirs, cliNotFoundMessage } from "../../src/core/claude-cli.js";
import {
  runPreviewedClaude,
  cancelClaudeRun,
  spawnClaudeChild,
  TokenRefused,
  type ClaudeRunDeps,
} from "../../src/core/claude-run.js";
import { clearInvocations, TOKEN_TTL_MS } from "../../src/core/claude-tokens.js";
import type { AgentSessionRequest, AgentSessionResult, SpawnOptions } from "../../src/core/agent-sdk.js";
import type { ClaudeOutputChunk } from "../../src/core/contracts.js";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "core");

let tmp: string;

/** A project with one task file — the request kind the bridge ships with. */
function makeProject(): { root: string; task: string } {
  const root = fs.mkdtempSync(path.join(tmp, "project-"));
  const tasksDir = path.join(root, ".claude", "maestro-tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "001-do-a-thing.md"), "# Do a thing\n\nSome task.\n");
  return { root, task: "001-do-a-thing.md" };
}

/** A directory containing an executable named `claude` that runs `body`. */
function fakeCli(body: string): { dir: string; bin: string } {
  const dir = fs.mkdtempSync(path.join(tmp, "bin-"));
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
}

/** A home directory with nothing installed, so fallback lookups can't find the developer's own CLI. */
function emptyHome(): string {
  return fs.mkdtempSync(path.join(tmp, "home-"));
}

/** Resolver options that see exactly one directory and no real machine. */
const only = (dir: string, home: string) => ({ env: { PATH: dir }, home, platform: "linux" as const });

const waitFor = async (cond: () => boolean, label: string, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
};

/**
 * Resolves once a child has reported that it could not be started.
 *
 * The run module's own `error` listener is registered first (inside the spawn function it hands the
 * SDK), and node emits in registration order — so by the time this resolves, the run has already
 * recorded the reason it will report as a crash.
 */
const spawnFailure = (child: import("node:child_process").ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.pid === undefined) child.once("error", () => resolve());
    else resolve();
  });

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A session the test drives by hand, in place of the SDK's.
 *
 * The run module's job is to map what a session did onto a `ClaudeRunResult` and to keep the token
 * contract while doing it. None of that is about the SDK, and testing it through the SDK would mean
 * a real `claude`, real latency and real tokens for assertions about whether a `failed` is
 * distinguishable from a `crashed`.
 */
class FakeSession {
  /** What the run asked for — the prompt, cwd, bin and write scope it took off the invocation. */
  request!: AgentSessionRequest;
  closed = false;
  private settle!: (result: AgentSessionResult) => void;
  readonly result = new Promise<AgentSessionResult>((resolve) => {
    this.settle = resolve;
  });

  say(stream: "stdout" | "stderr", chunk: string): void {
    this.request.output({ stream, chunk });
  }

  /** Start the CLI the way the SDK would, so the spawn function under test really runs. */
  spawn(command: string, args: string[] = [], cwd?: string) {
    const options: SpawnOptions = {
      command,
      args,
      cwd: cwd ?? this.request.cwd,
      env: { PATH: process.env.PATH },
      signal: new AbortController().signal,
    };
    return this.request.spawn(options);
  }

  end(patch: Partial<AgentSessionResult> = {}): void {
    this.settle({
      ok: true,
      subtype: "success",
      text: null,
      error: null,
      costUsd: null,
      numTurns: null,
      sessionId: null,
      billing: "subscription",
      denied: [],
      ...patch,
    });
  }
}

/** The deps a run is given, plus the handle to drive the session it was handed. */
function fakeRunner(): { fake: FakeSession; deps: ClaudeRunDeps } {
  const fake = new FakeSession();
  return {
    fake,
    deps: {
      start(request) {
        fake.request = request;
        return { result: fake.result, close: () => (fake.closed = true) };
      },
    },
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-bridge-"));
  clearInvocations();
});

afterEach(() => {
  clearInvocations();
  vi.useRealTimers();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("preview", () => {
  it("returns the prompt, the argv, the cwd and what would be written", async () => {
    const { root, task } = makeProject();
    const { dir } = fakeCli("true");

    const preview = await previewClaudeRun(root, { kind: "maestro-task", filename: task }, only(dir, emptyHome()));

    expect(preview.prompt).toBe(
      "Use /maestro to complete the task described in file .claude/maestro-tasks/001-do-a-thing.md"
    );
    expect(preview.cwd).toBe(root);
    expect(preview.argv.slice(1)).toEqual([...CLAUDE_BASE_FLAGS, preview.prompt]);
    expect(preview.argv[0]).toBe(path.join(dir, "claude"));
    // What may be written is stated, and stated honestly: a task decides its own edits.
    expect(preview.targets).toHaveLength(1);
    expect(preview.targets[0].path).toBe(root);
    expect(preview.targets[0].action).toBe("unknown");
    expect(preview.targets[0].note).toMatch(/write anywhere in this project/);
  });

  it("spawns nothing — no module it imports can start a process", () => {
    // The behavioural version of this test cannot exist: "did anything spawn?" is unobservable
    // from inside the process without instrumenting spawn itself, and instrumenting it would test
    // the instrument. So assert the property at the level it is actually guaranteed — the import
    // graph. If someone adds `child_process` to preview, or to anything preview reaches, this
    // fails at the file that introduced it rather than months later in a security review.
    const seen = new Set<string>();
    const offenders: string[] = [];
    // Comments are stripped first: this file's own prose says "child_process" repeatedly, and a
    // test that fails on documentation is a test people delete.
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = stripComments(fs.readFileSync(file, "utf8"));
      if (/(?:from|require\(|import\()\s*["'`](?:node:)?child_process["'`]/.test(src)) {
        offenders.push(path.basename(file));
      }
      for (const m of src.matchAll(/from\s*["'`](\.[^"'`]+)["'`]/g)) {
        const resolved = path.resolve(path.dirname(file), m[1].replace(/\.js$/, ".ts"));
        if (fs.existsSync(resolved)) walk(resolved);
      }
    };

    walk(path.join(srcDir, "claude-preview.ts"));
    expect(seen.size).toBeGreaterThan(2); // it really did walk the graph
    expect(offenders).toEqual([]);
  });

  it("issues a distinct single-use token per preview", async () => {
    const { root, task } = makeProject();
    const { dir } = fakeCli("true");
    const home = emptyHome();
    const a = await previewClaudeRun(root, { kind: "maestro-task", filename: task }, only(dir, home));
    const b = await previewClaudeRun(root, { kind: "maestro-task", filename: task }, only(dir, home));
    expect(a.token).toBeTruthy();
    expect(b.token).toBeTruthy();
    expect(a.token).not.toBe(b.token);
    expect(a.expiresAt).toBeGreaterThan(Date.now());
  });

  it("refuses a task that does not exist, and one that tries to escape the tasks directory", async () => {
    const { root } = makeProject();
    const opts = only(fakeCli("true").dir, emptyHome());
    await expect(previewClaudeRun(root, { kind: "maestro-task", filename: "nope.md" }, opts)).rejects.toThrow(
      /No such task/
    );
    // `..` segments are stripped to a basename before the lookup, so this resolves inside the
    // tasks directory and simply isn't there — it cannot name a file elsewhere on disk.
    await expect(
      previewClaudeRun(root, { kind: "maestro-task", filename: "../../../../etc/passwd" }, opts)
    ).rejects.toThrow(/No such task/);
  });

  it("rejects a request kind it does not know how to build a prompt for", async () => {
    const { root } = makeProject();
    await expect(
      // The renderer cannot smuggle prompt text through: there is no member of ClaudeRequest that
      // carries one, and an unknown kind is refused rather than passed along.
      previewClaudeRun(root, { kind: "run-this", prompt: "rm -rf /" } as never, only(fakeCli("true").dir, emptyHome()))
    ).rejects.toThrow(/Unsupported Claude request/);
  });
});

// The help chat's request kind was tested here — `{ kind: "help-chat", message, history }`, whose
// prompt this module built by re-sending a capped copy of the transcript on every question. `019`
// deleted it: the session pane holds ONE live conversation instead, and a turn there is user-typed
// text on `session:say` rather than a request a prompt is built from. There is nothing left in this
// module to test about it, and the properties that replaced it are pinned elsewhere —
// `test/core/session-scope.test.ts` for the read boundary, and `test/isolation.test.ts` for the
// wiring the renderer could undo.

describe("a missing CLI", () => {
  it("is reported by preview, with the prompt still in hand and no token", async () => {
    const { root, task } = makeProject();
    const empty = fs.mkdtempSync(path.join(tmp, "nothing-"));

    const preview = await previewClaudeRun(root, { kind: "maestro-task", filename: task }, only(empty, emptyHome()));

    expect(preview.available).toBe(false);
    expect(preview.token).toBeNull(); // nothing to authorise, so nothing is authorised
    expect(preview.bin).toBeNull();
    // The prompt survives: copying it into a session by hand is the documented fallback.
    expect(preview.prompt).toMatch(/Use \/maestro to complete the task/);
    expect(preview.unavailable).toMatch(/was not found/);
    expect(preview.unavailable).toMatch(/directories/);
    expect(preview.searched).toContain(empty);
  });

  it("names what was looked for rather than leaving a spawn to fail", () => {
    const message = cliNotFoundMessage({ available: false, bin: null, searched: ["/a", "/b", "/c", "/d"] });
    expect(message).toContain("`claude`");
    expect(message).toContain("/a, /b, /c");
    expect(message).not.toMatch(/ENOENT|spawn/);
  });
});

describe("CLI resolution", () => {
  it("finds an install PATH knows nothing about", () => {
    // The GUI-launch failure in one assertion: PATH is empty, exactly as a desktop launcher hands
    // it to us, and the CLI is where the official installer puts it.
    const home = emptyHome();
    const localBin = path.join(home, ".local", "bin");
    fs.mkdirSync(localBin, { recursive: true });
    fs.writeFileSync(path.join(localBin, "claude"), "#!/bin/sh\ntrue\n");
    fs.chmodSync(path.join(localBin, "claude"), 0o755);

    const cli = resolveClaudeCli({ env: { PATH: "" }, home, platform: "linux" });
    expect(cli.available).toBe(true);
    expect(cli.bin).toBe(path.join(localBin, "claude"));
  });

  it("does not report a non-executable file as available", () => {
    const home = emptyHome();
    const dir = fs.mkdtempSync(path.join(tmp, "bad-"));
    fs.writeFileSync(path.join(dir, "claude"), "#!/bin/sh\ntrue\n"); // no +x
    expect(resolveClaudeCli(only(dir, home)).available).toBe(false);
  });

  it("searches PATH first, then the known install locations, without duplicates", () => {
    const home = emptyHome();
    const dirs = claudeSearchDirs({ env: { PATH: "/usr/bin:/usr/bin:/opt/x" }, home, platform: "linux" });
    expect(dirs[0]).toBe("/usr/bin");
    expect(dirs[1]).toBe("/opt/x");
    expect(dirs).toContain(path.join(home, ".local", "bin"));
    expect(new Set(dirs).size).toBe(dirs.length);
  });
});

describe("the token contract", () => {
  const sink = { output: () => {} };

  /** A previewed task run, ready to be executed against a session the test drives. */
  const previewTask = async () => {
    const { root, task } = makeProject();
    const { dir, bin } = fakeCli("true");
    return {
      bin,
      root,
      preview: await previewClaudeRun(root, { kind: "maestro-task", filename: task }, only(dir, emptyHome())),
    };
  };

  it("refuses a forged token", async () => {
    await expect(runPreviewedClaude("not-a-token-anyone-issued", sink)).rejects.toThrow(TokenRefused);
    await expect(runPreviewedClaude("not-a-token-anyone-issued", sink)).rejects.toThrow(/no preview matches/i);
  });

  it("refuses a run that carries no token at all", async () => {
    for (const bad of [undefined, null, "", 42, { token: "x" }]) {
      await expect(runPreviewedClaude(bad, sink)).rejects.toThrow(TokenRefused);
    }
  });

  it("refuses a replayed token — a preview authorises exactly one run", async () => {
    const { preview } = await previewTask();
    const { fake, deps } = fakeRunner();

    const run = runPreviewedClaude(preview.token, sink, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");
    fake.end();
    expect((await run).outcome).toBe("ok");

    await expect(runPreviewedClaude(preview.token, sink, fakeRunner().deps)).rejects.toThrow(TokenRefused);
  });

  it("refuses an expired token, and consumes it", async () => {
    const { preview } = await previewTask();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + TOKEN_TTL_MS + 1000);
    await expect(runPreviewedClaude(preview.token, sink)).rejects.toThrow(/expired/i);
    vi.useRealTimers();

    // And it is gone, not merely stale — an expired token cannot be revived by waiting for a clock.
    await expect(runPreviewedClaude(preview.token, sink)).rejects.toThrow(/no preview matches/i);
  });

  it("runs exactly the invocation the preview named — a token cannot describe another", async () => {
    // The argv the modal shows is now the EQUIVALENT command line (the SDK adds its own protocol
    // flags), so what a token pins is the prompt, the binary and the working directory. A run has
    // no argument by which any of the three could be replaced.
    const { preview, bin, root } = await previewTask();
    const { fake, deps } = fakeRunner();

    const run = runPreviewedClaude(preview.token, sink, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");

    expect(fake.request.prompt).toBe(preview.prompt);
    expect(fake.request.bin).toBe(bin);
    expect(fake.request.cwd).toBe(preview.cwd);
    expect(preview.cwd).toBe(root);
    fake.end();
    await run;
  });

  it("hands the session exactly the write scope the confirmation displayed", async () => {
    // The permission callback reads this and can therefore never be wider than what the user saw.
    // A task run may write anywhere in the project, and says so; that has not changed — what
    // changed is that it is now a bound rather than a description.
    const { preview, root } = await previewTask();
    const { fake, deps } = fakeRunner();

    const run = runPreviewedClaude(preview.token, sink, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");

    expect(fake.request.writable).toEqual(preview.targets.map((t) => t.path));
    expect(fake.request.writable).toEqual([root]);
    fake.end();
    await run;
  });
});

describe("running", () => {
  const previewTask = async () => {
    const { root, task } = makeProject();
    const { dir, bin } = fakeCli("true");
    return {
      bin,
      preview: await previewClaudeRun(root, { kind: "maestro-task", filename: task }, only(dir, emptyHome())),
    };
  };

  it("streams output as it arrives rather than on completion", async () => {
    const { preview } = await previewTask();
    const { fake, deps } = fakeRunner();
    const chunks: ClaudeOutputChunk[] = [];

    const run = runPreviewedClaude(preview.token, { output: (c) => chunks.push(c) }, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");

    // The point of the test: output is observable while the session is still going.
    fake.say("stdout", "first\n");
    await waitFor(() => chunks.some((c) => /first/.test(c.chunk)), "the first chunk, before the end");
    fake.say("stdout", "second\n");
    fake.end();

    const result = await run;
    expect(result.outcome).toBe("ok");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(result.stdout).toContain("first");
    expect(result.stdout).toContain("second");
  });

  it("separates stdout from stderr", async () => {
    const { preview } = await previewTask();
    const { fake, deps } = fakeRunner();
    const streams: string[] = [];

    const run = runPreviewedClaude(preview.token, { output: (c) => streams.push(c.stream) }, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");
    fake.say("stdout", "out\n");
    fake.say("stderr", "oops\n");
    fake.end();

    const result = await run;
    expect(result.stdout).toContain("out");
    expect(result.stderr).toContain("oops");
    expect(new Set(streams)).toEqual(new Set(["stdout", "stderr"]));
  });

  it("reports a session that ended badly as a failure, with its output and the reason", async () => {
    const { preview } = await previewTask();
    const { fake, deps } = fakeRunner();

    const run = runPreviewedClaude(preview.token, { output: () => {} }, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");
    fake.say("stdout", "partial work\n");
    fake.say("stderr", "it went wrong\n");
    fake.end({ ok: false, subtype: "error_max_turns", error: "The session ended as error_max_turns." });

    const result = await run;
    expect(result.outcome).toBe("failed");
    // There is no exit code to report: the CLI is a child the SDK owns, and inventing one would be
    // worse than the null. `error` is what the dialog renders instead.
    expect(result.code).toBeNull();
    expect(result.error).toMatch(/error_max_turns/);
    expect(result.stderr).toContain("it went wrong");
    expect(result.stdout).toContain("partial work"); // output is kept on the failing path too
  });

  it("says how many tool calls were refused when a run ends badly", async () => {
    // A run that quietly declined half of what it was asked to do and then reported failure is a
    // different diagnosis from one that could not reach the model.
    const { preview } = await previewTask();
    const { fake, deps } = fakeRunner();

    const run = runPreviewedClaude(preview.token, { output: () => {} }, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");
    fake.end({
      ok: false,
      subtype: "success",
      error: "The session ended as success.",
      denied: [{ tool: "Write", path: "/etc/passwd", message: "outside" }],
    });

    expect((await run).error).toMatch(/1 tool call was denied/);
  });

  it("reports a CLI that cannot be executed as a crash, distinguishably, naming the file", async () => {
    const { preview, bin } = await previewTask();
    fs.rmSync(bin); // it was there when the prompt was previewed; it isn't now
    const { fake, deps } = fakeRunner();

    const run = runPreviewedClaude(preview.token, { output: () => {} }, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");
    await spawnFailure(fake.spawn(bin, ["--version"]));
    fake.end({ ok: false, error: "the transport gave up" });

    const result = await run;
    expect(result.outcome).toBe("crashed");
    expect(result.code).toBeNull();
    expect(result.error).toContain(bin);
    expect(result.error).not.toMatch(/ENOENT/);
  });

  it("distinguishes a crash from a failure in the same field", async () => {
    // The two are separate outcomes rather than `ok: false`, because "the session went wrong" and
    // "the CLI never ran" send the user to completely different places.
    const failing = await previewTask();
    const failedRunner = fakeRunner();
    const failed = runPreviewedClaude(failing.preview.token, { output: () => {} }, failedRunner.deps);
    await waitFor(() => failedRunner.fake.request !== undefined, "the session to start");
    failedRunner.fake.end({ ok: false, error: "nope" });

    const crashing = await previewTask();
    fs.rmSync(crashing.bin);
    const crashedRunner = fakeRunner();
    const crashed = runPreviewedClaude(crashing.preview.token, { output: () => {} }, crashedRunner.deps);
    await waitFor(() => crashedRunner.fake.request !== undefined, "the session to start");
    await spawnFailure(crashedRunner.fake.spawn(crashing.bin, []));
    crashedRunner.fake.end({ ok: false, error: "nope" });

    expect((await failed).outcome).toBe("failed");
    expect((await crashed).outcome).toBe("crashed");
  });

  it("reports what was ACTUALLY spawned, not the equivalent argv the modal showed", async () => {
    // The SDK adds its own stream-protocol flags. Reporting the preview's argv back would be the
    // comfortable answer and the wrong one — this field is the record of what ran.
    const { preview } = await previewTask();
    const { fake, deps } = fakeRunner();

    const run = runPreviewedClaude(preview.token, { output: () => {} }, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");
    fake.spawn("/bin/sh", ["-c", "true"]);
    fake.end();

    expect((await run).argv).toEqual(["/bin/sh", "-c", "true"]);
  });

  it("cancels a running invocation and kills the process it started", async () => {
    const pidFile = path.join(tmp, "child.pid");
    const { preview } = await previewTask();
    const { fake, deps } = fakeRunner();

    const run = runPreviewedClaude(preview.token, { output: () => {} }, deps);
    await waitFor(() => fake.request !== undefined, "the session to start");
    // A CLI that spawns its own child, which is what the real one does. Signalling only the
    // process we spawned would leave this `sleep` running with nothing to stop it.
    fake.spawn("/bin/sh", ["-c", `sleep 300 &\necho $! > ${pidFile}\nwait`]);

    await waitFor(() => fs.existsSync(pidFile), "the run to start its child");
    const childPid = Number(fs.readFileSync(pidFile, "utf8").trim());
    expect(alive(childPid)).toBe(true);

    expect(cancelClaudeRun(preview.token!)).toBe(true);
    // Closing the query and signalling the group are two different actions and Stop does both.
    expect(fake.closed).toBe(true);
    fake.end({ ok: false, error: "aborted" });

    expect((await run).outcome).toBe("cancelled");
    await waitFor(() => !alive(childPid), "the grandchild process to die");
    expect(alive(childPid)).toBe(false);
  });

  it("reports nothing to cancel for a token with no run in flight", () => {
    expect(cancelClaudeRun("no-such-run")).toBe(false);
  });
});

describe("the spawn the SDK is handed", () => {
  // `spawnClaudeCodeProcess` exists so the SDK does not own this. The reason is one property, and
  // it is the reason Stop works: the child is a process GROUP leader, so the CLI's own children go
  // with it. Tested against `/bin/sh` rather than a fake `claude` — the thing under test is the
  // spawn, and nothing about it is Claude-specific.
  const options = (command: string, args: string[]): SpawnOptions => ({
    command,
    args,
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    signal: new AbortController().signal,
  });

  it("puts the child in its own process group, so a group signal reaches its children", async () => {
    const pidFile = path.join(tmp, "group.pid");
    const child = spawnClaudeChild(options("/bin/sh", ["-c", `sleep 300 &\necho $! > ${pidFile}\nwait`]));

    await waitFor(() => fs.existsSync(pidFile), "the child to start its own child");
    const grandchild = Number(fs.readFileSync(pidFile, "utf8").trim());
    expect(alive(grandchild)).toBe(true);

    // The negative pid IS the test: it only reaches the grandchild if `detached` made a group.
    process.kill(-child.pid!, "SIGTERM");
    await waitFor(() => !alive(grandchild), "the grandchild to die with the group");
  });

  it("gives the child three pipes — the SDK talks to it over stdin", () => {
    // The old spawn closed stdin, because headless `-p` read its prompt from argv. The SDK speaks
    // a control protocol over stdin/stdout, so an inherited or closed stdin ends the conversation.
    const child = spawnClaudeChild(options("/bin/sh", ["-c", "true"]));
    expect(child.stdin).not.toBeNull();
    expect(child.stdout).not.toBeNull();
    expect(child.stderr).not.toBeNull();
    child.kill("SIGKILL");
  });
});
