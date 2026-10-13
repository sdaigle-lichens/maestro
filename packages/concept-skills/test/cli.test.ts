// `090`: the plugin's real concept-skills.cjs CLI, spawned. The library functions behind `agents`,
// `agents-discover` and `agents-set` are covered in concept-skills.test.ts; this pins the command
// surface the install / update skills actually call: output shape, --root, and the CLAUDE_PROJECT_DIR
// fallback (an unset root once silently reported "no agents").

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../../../plugins/concept-skills/scripts/concept-skills.cjs");

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "concept-skills-cli-"));
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}, cwd?: string) {
  const full: NodeJS.ProcessEnv = { ...process.env, ...env };
  if (!("CLAUDE_PROJECT_DIR" in env)) delete full.CLAUDE_PROJECT_DIR;
  delete full.CLAUDE_CODE_SESSION_ID;
  const res = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: full, cwd });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

const json = (r: { stdout: string }) => JSON.parse(r.stdout);
const stateFile = () => path.join(tmp, ".claude", "concept-skills.json");

describe("concept-skills.cjs agents / agents-discover / agents-set", () => {
  it("agents: [] when nothing is recorded", () => {
    const r = run(["agents", "--root", tmp]);
    expect(r.code).toBe(0);
    expect(json(r)).toEqual([]);
  });

  it("agents-set writes the list, reports written, and agents reads it back", () => {
    const set = run(["agents-set", "backend", "test", "--root", tmp]);
    expect(set.code).toBe(0);
    expect(json(set)).toEqual({ written: true, agents: ["backend", "test"] });
    expect(json(run(["agents", "--root", tmp]))).toEqual(["backend", "test"]);
    expect(JSON.parse(fs.readFileSync(stateFile(), "utf8")).agents).toEqual(["backend", "test"]);
  });

  it("agents-set with the same names again reports written:false", () => {
    run(["agents-set", "a", "--root", tmp]);
    expect(json(run(["agents-set", "a", "--root", tmp]))).toEqual({ written: false, agents: ["a"] });
  });

  it("agents-set with --root first does not treat the directory as an agent name", () => {
    const r = run(["agents-set", "--root", tmp, "x"]);
    expect(json(r).agents).toEqual(["x"]);
  });

  it("agents-set with no names empties the list", () => {
    run(["agents-set", "a", "b", "--root", tmp]);
    expect(json(run(["agents-set", "--root", tmp]))).toEqual({ written: true, agents: [] });
  });

  it("agents-set keeps the other keys of concept-skills.json", () => {
    fs.writeFileSync(stateFile(), JSON.stringify({ version: "1.2", last_update: "abc" }));
    run(["agents-set", "a", "--root", tmp]);
    const body = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    expect(body).toMatchObject({ version: "1.2", last_update: "abc", agents: ["a"] });
  });

  it("agents-discover lists .claude/agents and maestro.json agents_available, sorted, and writes nothing", () => {
    fs.mkdirSync(path.join(tmp, ".claude", "agents"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".claude", "agents", "zed.md"), "x");
    fs.writeFileSync(path.join(tmp, ".claude", "maestro.json"), JSON.stringify({ agents_available: ["backend"] }));
    const r = run(["agents-discover", "--root", tmp]);
    expect(r.code).toBe(0);
    expect(json(r)).toEqual(["backend", "zed"]);
    expect(fs.existsSync(stateFile())).toBe(false);
  });

  it("agents-discover on a project with nothing prints []", () => {
    expect(json(run(["agents-discover", "--root", tmp]))).toEqual([]);
  });

  it("without --root, CLAUDE_PROJECT_DIR is the root", () => {
    run(["agents-set", "viaEnv"], { CLAUDE_PROJECT_DIR: tmp });
    expect(json(run(["agents"], { CLAUDE_PROJECT_DIR: tmp }))).toEqual(["viaEnv"]);
  });

  it("without --root or the env var, cwd is the root", () => {
    run(["agents-set", "viaCwd"], {}, tmp);
    expect(json(run(["agents"], {}, tmp))).toEqual(["viaCwd"]);
  });
});
