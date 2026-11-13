// `180` through the INSTALLED launcher: .claude/scripts/maestro-worker-runtime.cjs `prune` and
// .claude/scripts/maestro-epic.cjs `finish-worker`, spawned against a temp project. `docker` and
// `claude` are stubs first on PATH. The docker stub answers `image ls`, `image inspect`, `ps`, `rm`
// and `image rm` from a JSON fixture and records every call, so the prune's parsing and selection
// are checked end to end without a daemon. Nothing real is removed. Harness rules as in
// worker-runtime-cli.test.ts: HOME pinned to a temp dir, CLAUDE_CODE_SESSION_ID deleted, and the
// child environment is built explicitly, never inherited.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { readEpicState } from "../../src/core/epics.js";
import { projectLabelFor } from "../../src/core/worker-runtime.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const LAUNCHER = ".claude/scripts/maestro-worker-runtime.cjs";
const EPIC = ".claude/scripts/maestro-epic.cjs";
const GB = 1024 ** 3;

interface StubImage {
  ref: string;
  id: string;
  size: number;
  /** The label value `docker image inspect` prints: a project hash, "" or "<no value>" when unset. */
  label: string;
}
interface StubContainer {
  name: string;
  image: string;
  state: "running" | "exited";
}
interface Fixture {
  images: StubImage[];
  containers: StubContainer[];
  /** Names (containers) or refs (images) whose removal fails. */
  rmFail: string[];
  imageLsFails: boolean;
  /** `docker ps` fails (after `image ls` succeeded). */
  psFails?: boolean;
  /** Refs whose `docker image inspect` fails. */
  inspectFails?: string[];
}

// A node script, so the stub's logic is plain. Written with concatenation, not template literals,
// because it is embedded in a TypeScript template string below.
const DOCKER_STUB_LINES = [
  'const fs = require("fs");',
  "const args = process.argv.slice(2);",
  'fs.appendFileSync(process.env.DOCKER_LOG, "CALL\\n" + args.map((a) => a + "\\n").join(""));',
  'const fx = JSON.parse(fs.readFileSync(process.env.DOCKER_FIXTURE, "utf8"));',
  "const cmd = args[0];",
  "const sub = args[1];",
  "const out = (s) => process.stdout.write(s);",
  'if (cmd === "--version") process.exit(0);',
  'if (cmd === "image" && sub === "ls") {',
  '  if (fx.imageLsFails) { process.stderr.write("Cannot connect to the Docker daemon\\n"); process.exit(1); }',
  '  out(fx.images.map((i) => i.ref + "\\n").join(""));',
  "  process.exit(0);",
  "}",
  'if (cmd === "image" && sub === "inspect") {',
  "  const im = fx.images.find((i) => i.ref === args[args.length - 1]);",
  "  if (!im || (fx.inspectFails || []).includes(im.ref)) process.exit(1);",
  '  out(im.id + "|" + im.size + "|" + im.label + "\\n");',
  "  process.exit(0);",
  "}",
  'if (cmd === "ps") {',
  '  if (fx.psFails) { process.stderr.write("Cannot connect to the Docker daemon\\n"); process.exit(1); }',
  '  out(fx.containers.map((c) => c.name + "|" + c.image + "|" + c.state + "\\n").join(""));',
  "  process.exit(0);",
  "}",
  'if (cmd === "rm" || (cmd === "image" && sub === "rm")) {',
  '  const target = cmd === "rm" ? args[1] : args[2];',
  "  if (fx.rmFail.includes(target)) {",
  '    process.stderr.write("Error response from daemon: conflict: cannot remove " + target + "\\n");',
  "    process.exit(1);",
  "  }",
  "  process.exit(0);",
  "}",
  "process.exit(0);",
];

let tmp: string;
let home: string;
let bin: string;
let root: string;
let dockerLog: string;
let fixturePath: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-180-prune-"));
  home = path.join(tmp, "home");
  bin = path.join(tmp, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  dockerLog = path.join(tmp, "docker.log");
  fixturePath = path.join(tmp, "fixture.json");
  writeStub("claude", `if [ -n "$CLAUDE_FAIL" ]; then exit 1; fi\necho "2.1.322 (Claude Code)"`);
  fs.writeFileSync(path.join(bin, "docker"), `#!${process.execPath}\n${DOCKER_STUB_LINES.join("\n")}\n`);
  fs.chmodSync(path.join(bin, "docker"), 0o755);
  root = path.join(tmp, "proj");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  await installed();
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
}

/** Only what the scripts need; nothing inherited from the developer's environment. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: home,
    TMPDIR: tmp,
    CLAUDE_PROJECT_DIR: root,
    DOCKER_LOG: dockerLog,
    DOCKER_FIXTURE: fixturePath,
    ...extra,
  };
}

function run(script: string, args: string[], extra: Record<string, string> = {}) {
  const res = spawnSync("node", [path.join(root, script), ...args], { encoding: "utf8", env: childEnv(extra) });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function writeFixture(fx: Fixture): void {
  fs.writeFileSync(fixturePath, JSON.stringify(fx));
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

/** The removal calls only, in the order docker received them, as "rm x" / "image rm x". */
function removalCalls(): string[] {
  return dockerCalls()
    .filter((c) => c[0] === "rm" || (c[0] === "image" && c[1] === "rm"))
    .map((c) => c.join(" "));
}

describe("prune through the installed launcher against a docker stub (180)", () => {
  let current: string;
  let repo: string;
  let LABEL: string;
  let OTHER_LABEL: string;

  beforeEach(() => {
    // The current tag comes from the launcher itself, so the fixture matches what prune computes.
    const tag = run(LAUNCHER, ["image", "--print-tag"]);
    expect(tag.code).toBe(0);
    current = tag.stdout.trim();
    expect(current).toMatch(/^maestro-worker-[^:]+:[^:]+$/);
    repo = current.slice(0, current.lastIndexOf(":"));
    LABEL = projectLabelFor(root);
    OTHER_LABEL = projectLabelFor("/work/other");
  });

  /** A realistic project: current image, two superseded (one used by a live container), an unlabelled
   * pre-label pair, a dangling tag, another project's worker image, a base image; one stopped worker
   * container on the superseded image, a running one, and another project's stopped one. */
  function fixture(over: Partial<Fixture> = {}): Fixture {
    const r = (t: string) => `${repo}:${t}`;
    return {
      images: [
        { ref: current, id: "sha256:c0ffee000001", size: GB, label: LABEL },
        { ref: r("old1"), id: "sha256:0a0a0a0a0a01", size: 2 * GB, label: LABEL },
        { ref: r("old2"), id: "sha256:0b0b0b0b0b02", size: GB, label: LABEL },
        { ref: r("unl"), id: "sha256:0c0c0c0c0c03", size: GB, label: "<no value>" },
        { ref: r("unl2"), id: "sha256:0d0d0d0d0d04", size: GB, label: "" },
        { ref: `${repo}:<none>`, id: "sha256:0e0e0e0e0e05", size: GB, label: "" },
        { ref: "<none>:<none>", id: "sha256:0f0f0f0f0f06", size: GB, label: "" },
        { ref: "maestro-worker-other:abc", id: "sha256:1a1a1a1a1a07", size: GB, label: OTHER_LABEL },
        { ref: "node:22-bookworm-slim", id: "sha256:1b1b1b1b1b08", size: GB, label: "" },
      ],
      containers: [
        { name: "maestro-worker-done", image: r("old1"), state: "exited" },
        { name: "maestro-worker-live", image: r("old2"), state: "running" },
        { name: "maestro-worker-theirs", image: "maestro-worker-other:abc", state: "exited" },
      ],
      rmFail: [],
      imageLsFails: false,
      ...over,
    };
  }

  it("parses image ls, inspect and ps: <none> rows are never inspected, only worker images are", () => {
    writeFixture(fixture());
    const r = run(LAUNCHER, ["prune", "--dry-run"]);
    expect(r.code).toBe(0);
    const inspected = dockerCalls()
      .filter((c) => c[0] === "image" && c[1] === "inspect")
      .map((c) => c[c.length - 1]);
    expect(inspected).toEqual([
      current,
      `${repo}:old1`,
      `${repo}:old2`,
      `${repo}:unl`,
      `${repo}:unl2`,
      "maestro-worker-other:abc",
    ]);
    expect(inspected.some((ref) => ref!.includes("<none>"))).toBe(false);
    expect(inspected).not.toContain("node:22-bookworm-slim");
  });

  it("real run: removes the stopped container, then the superseded image, keeps current and in-use, skips unlabelled", () => {
    writeFixture(fixture());
    const r = run(LAUNCHER, ["prune"]);
    expect(r.code).toBe(0);
    expect(removalCalls()).toEqual(["rm maestro-worker-done", `image rm ${repo}:old1`]);
    expect(r.stdout).toContain("removed stopped container maestro-worker-done");
    expect(r.stdout).toContain(`removed image ${repo}:old1 (2.0 GB)`);
    expect(r.stdout).toContain("freed 2.0 GB");
    expect(r.stdout).toContain(`kept ${current} (current tag)`);
    expect(r.stdout).toContain(`kept ${repo}:old2 (in use by a running container)`);
    expect(r.stdout).toContain(`skipped ${repo}:unl (1.0 GB)`);
    expect(r.stdout).toContain(`skipped ${repo}:unl2 (1.0 GB)`);
    expect(r.stdout).toContain(`to remove it yourself run: docker rmi ${repo}:unl`);
    expect(r.stdout).not.toContain("maestro-worker-other");
    expect(r.stdout).not.toContain("node:22");
    expect(r.stdout).not.toContain("maestro-worker-theirs");
  });

  it("dry run removes nothing: no rm or image rm reaches docker, and it says so", () => {
    writeFixture(fixture());
    const r = run(LAUNCHER, ["prune", "--dry-run"]);
    expect(r.code).toBe(0);
    expect(removalCalls()).toEqual([]);
    expect(r.stdout).toContain("would remove stopped container maestro-worker-done");
    expect(r.stdout).toContain(`would remove image ${repo}:old1 (2.0 GB)`);
    expect(r.stdout).toContain("would free 2.0 GB (dry run: nothing was removed)");
    expect(r.stdout).not.toMatch(/^removed /m);
  });

  it("an unlabelled image is never removed, in a real run or a dry run, and is listed with its docker rmi", () => {
    writeFixture(fixture());
    for (const args of [["prune"], ["prune", "--dry-run"]]) {
      const r = run(LAUNCHER, args);
      expect(removalCalls().some((c) => c.includes(`${repo}:unl`))).toBe(false);
      expect(r.stdout).toContain(`docker rmi ${repo}:unl`);
      expect(r.stdout).toContain(`docker rmi ${repo}:unl2`);
      fs.rmSync(dockerLog, { force: true });
    }
  });

  it("a failing docker rm of a stopped container is not reported as removed", () => {
    writeFixture(fixture({ rmFail: ["maestro-worker-done"] }));
    const r = run(LAUNCHER, ["prune"]);
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain("removed stopped container maestro-worker-done");
    expect(r.stdout).toContain("could not remove stopped container maestro-worker-done");
    expect(r.stdout).toContain(`removed image ${repo}:old1`);
  });

  // DEFECT (180, found by this test): a failed `docker image rm` is dropped silently. The image
  // stays on disk, the report says nothing about it, and the freed total leaves it out with no reason
  // given. The launcher's pruneCommand filters the plan by the removals that succeeded and never
  // reports the rest. Expected: the report names the image that could not be removed.
  it("a failing docker image rm is named in the report, not silently dropped", () => {
    writeFixture(fixture({ containers: [], rmFail: [`${repo}:old2`] }));
    const r = run(LAUNCHER, ["prune"]);
    expect(r.code).toBe(1); // a removal docker refused is a partial failure
    expect(r.stdout).toContain(`removed image ${repo}:old1 (2.0 GB)`);
    expect(r.stdout).toContain("freed 2.0 GB");
    expect(r.stdout).not.toContain(`removed image ${repo}:old2`);
    expect(r.stdout).toContain(`could not remove image ${repo}:old2`);
  });

  it("a failed image rm is excluded from freed: old1 refused, old2 removed, freed is 1.0 GB not 3.0 GB", () => {
    writeFixture(fixture({ containers: [], rmFail: [`${repo}:old1`] }));
    const r = run(LAUNCHER, ["prune"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(`removed image ${repo}:old2 (1.0 GB)`);
    expect(r.stdout).toContain("freed 1.0 GB");
    expect(r.stdout).not.toContain("freed 3.0 GB");
    expect(r.stdout).not.toContain(`removed image ${repo}:old1`);
    expect(r.stdout).toContain(`could not remove image ${repo}:old1`);
  });

  it("a failed container rm and a failed image rm are each named, and the successful image is still removed and counted", () => {
    writeFixture(fixture({ rmFail: ["maestro-worker-done", `${repo}:old2`] }));
    const r = run(LAUNCHER, ["prune"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("could not remove stopped container maestro-worker-done");
    expect(r.stdout).not.toContain("removed stopped container maestro-worker-done");
    expect(r.stdout).toContain(`removed image ${repo}:old1 (2.0 GB)`);
    expect(r.stdout).toContain("freed 2.0 GB");
    expect(r.stdout).toContain(`kept ${repo}:old2 (in use by a running container)`);
  });

  it("when every removal is refused the report names each one and does not claim nothing needed removing", () => {
    // DEFECT (180, found by this test): with every removal refused, the plan is emptied of removals and
    // formatPrune prints "nothing needed removing" above the "could not remove" lines. That contradicts the
    // report. Expected: no "nothing needed removing" line, both refused images named, exit 1.
    writeFixture(fixture({ containers: [], rmFail: [`${repo}:old1`, `${repo}:old2`] }));
    const r = run(LAUNCHER, ["prune"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(`could not remove image ${repo}:old1`);
    expect(r.stdout).toContain(`could not remove image ${repo}:old2`);
    expect(r.stdout).not.toContain("nothing needed removing");
    expect(r.stdout).not.toContain("freed");
  });

  it("exits 0 on every no-failure path: nothing to remove, only unlabelled images, and a dry run that would fail", () => {
    writeFixture(
      fixture({ containers: [], images: [{ ref: current, id: "sha256:c0ffee000001", size: GB, label: LABEL }] })
    );
    const nothing = run(LAUNCHER, ["prune"]);
    expect(nothing.code).toBe(0);
    expect(nothing.stdout).toContain("nothing needed removing");

    writeFixture(
      fixture({
        containers: [],
        images: [
          { ref: current, id: "sha256:c0ffee000001", size: GB, label: LABEL },
          { ref: `${repo}:unl`, id: "sha256:0c0c0c0c0c03", size: GB, label: "" },
        ],
      })
    );
    const skippedOnly = run(LAUNCHER, ["prune"]);
    expect(skippedOnly.code).toBe(0);
    expect(skippedOnly.stdout).toContain(`docker rmi ${repo}:unl`);

    writeFixture(fixture({ containers: [], rmFail: [`${repo}:old1`] }));
    const dry = run(LAUNCHER, ["prune", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(removalCalls()).toEqual([]);
  });

  // DEFECT (180, found by the QA re-test): with the daemon unreachable, `image ls` fails, the launcher
  // sees no images and no containers, and prints "nothing needed removing". Prune never looked, so that
  // claims a check that did not happen. Expected: the report says docker could not be reached, never
  // "nothing needed removing"; exit stays 0 and no removal is called.
  it("with the daemon unreachable it says docker could not be reached, not nothing needed removing, and calls no removal", () => {
    writeFixture(fixture({ imageLsFails: true }));
    const r = run(LAUNCHER, ["prune"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("nothing needed removing");
    expect(r.stdout).toMatch(/docker/i);
    expect(removalCalls()).toEqual([]);
  });

  // DEFECT (180, found by the QA re-test of item 3): `docker ps` fails after `image ls` succeeded. The
  // launcher's dockerLines returns null, the container list silently becomes [], and with no superseded
  // image the report says "nothing needed removing" for stopped containers it never listed.
  it("a failing docker ps is not reported as nothing needed removing", () => {
    writeFixture(
      fixture({
        containers: [],
        psFails: true,
        images: [{ ref: current, id: "sha256:c0ffee000001", size: GB, label: LABEL }],
      })
    );
    const r = run(LAUNCHER, ["prune"]);
    expect(r.stdout).not.toContain("nothing needed removing");
    expect(r.stdout).toMatch(/container[^\n]*could not|could not[^\n]*container/i);
    expect(removalCalls()).toEqual([]);
  });

  // DEFECT (180, found by the QA re-test of item 3): an image whose `docker image inspect` fails is dropped
  // from the list without a word. With only a superseded image left, the report says "nothing needed
  // removing" about an image prune never checked. Expected: the report names it; no removal of it.
  it("an image docker could not inspect is named, not reported as nothing needed removing", () => {
    writeFixture(
      fixture({
        containers: [],
        inspectFails: [`${repo}:old1`],
        images: [
          { ref: current, id: "sha256:c0ffee000001", size: GB, label: LABEL },
          { ref: `${repo}:old1`, id: "sha256:0a0a0a0a0a01", size: 2 * GB, label: LABEL },
        ],
      })
    );
    const r = run(LAUNCHER, ["prune"]);
    expect(r.stdout).not.toContain("nothing needed removing");
    expect(r.stdout).toContain(`${repo}:old1`);
    expect(r.stdout).toMatch(/could not/i);
    expect(removalCalls()).toEqual([]);
  });

  it("with the current tag uncomputable it removes no image, says so, and calls no removal", () => {
    writeFixture(fixture());
    const r = run(LAUNCHER, ["prune"], { CLAUDE_FAIL: "1" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no image removed: this project's current image tag could not be computed");
    expect(removalCalls()).toEqual([]);
  });
  // 180 QA round 2: every failed docker query exits 1, dry run included, and no removal reaches docker.
  it("a failing docker ps exits 1 on a real run and on a dry run, and no removal reaches docker", () => {
    for (const args of [["prune"], ["prune", "--dry-run"]]) {
      writeFixture(fixture({ containers: [], psFails: true }));
      const r = run(LAUNCHER, args);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("docker ps failed");
      expect(r.stdout).toContain("could not list containers, so no image removed");
      expect(r.stdout).not.toContain("nothing needed removing");
      expect(removalCalls()).toEqual([]);
      fs.rmSync(dockerLog, { force: true });
    }
  });

  it("a failing docker image inspect exits 1 on a real run and on a dry run, and that image is never removed", () => {
    for (const args of [["prune"], ["prune", "--dry-run"]]) {
      writeFixture(fixture({ containers: [], inspectFails: [`${repo}:old1`] }));
      const r = run(LAUNCHER, args);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain(`could not inspect image ${repo}:old1`);
      expect(r.stdout).not.toContain("nothing needed removing");
      expect(removalCalls().some((c) => c.includes(`${repo}:old1`))).toBe(false);
      fs.rmSync(dockerLog, { force: true });
    }
  });

  it("a failing inspect of the current tag exits 1 on a real run and on a dry run, and no image or container is removed", () => {
    for (const args of [["prune"], ["prune", "--dry-run"]]) {
      writeFixture(fixture({ inspectFails: [current] }));
      const r = run(LAUNCHER, args);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain(`could not inspect image ${current}`);
      expect(r.stdout).toContain("the current image could not be inspected; no image removed");
      expect(r.stdout).not.toContain("nothing needed removing");
      expect(removalCalls()).toEqual([]);
      fs.rmSync(dockerLog, { force: true });
    }
  });
});

describe("finish-worker through the installed maestro-epic.cjs (180)", () => {
  beforeEach(() => {
    expect(run(EPIC, ["create", "e1"]).code).toBe(0);
    expect(run(EPIC, ["add-worker", "e1", "e1-177", "--task", "177-x.md", "--pane", "1-2"]).code).toBe(0);
    expect(run(EPIC, ["add-worker", "e1", "e1-178", "--task", "178-y.md", "--pane", "1-3"]).code).toBe(0);
  });

  it("finishing a worker drops its pane from show and keeps the record", () => {
    const r = run(EPIC, ["finish-worker", "e1", "e1-177"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('worker "e1-177" on "e1" is finished');
    const show = run(EPIC, ["show", "e1"]);
    expect(show.code).toBe(0);
    expect(show.stdout).toContain("workers:   e1-178 (pane 1-3)");
    expect(show.stdout).toContain("finished:  e1-177 (session stopped)");
    expect(show.stdout).not.toContain("1-2");
    const rec = readEpicState(root, "e1")!.workers.find((w) => w.name === "e1-177")!;
    expect(rec.pane).toBeUndefined();
    expect(rec.finished_at).toBeTruthy();
  });

  it("finishing the same worker twice exits 0 both times and keeps the first time", () => {
    expect(run(EPIC, ["finish-worker", "e1", "e1-177"]).code).toBe(0);
    const first = readEpicState(root, "e1")!.workers.find((w) => w.name === "e1-177")!.finished_at;
    const again = run(EPIC, ["finish-worker", "e1", "e1-177"]);
    expect(again.code).toBe(0);
    expect(readEpicState(root, "e1")!.workers.find((w) => w.name === "e1-177")!.finished_at).toBe(first);
  });

  it("an unknown worker is refused with a readable message, and the record is unchanged", () => {
    const r = run(EPIC, ["finish-worker", "e1", "nope"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('epic "e1" has no worker "nope"');
    expect(readEpicState(root, "e1")!.workers.every((w) => !w.finished_at)).toBe(true);
  });

  it("an unknown epic is refused with a readable message", () => {
    const r = run(EPIC, ["finish-worker", "zz", "e1-177"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no epic "zz"');
  });
});
