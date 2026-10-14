// The real Step 1 / end-skills scripts, spawned from the PLUGIN's own copy (the one
// /to-maestro-tasks runs through ${CLAUDE_PLUGIN_ROOT}) against temp projects. Pins, on properties
// not wording: exit 0, empty stderr, exactly one line, the configured skills named in order, the
// old `gates` booleans never read, and that no degenerate input escapes as an error.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/maestro/test/core -> repo root
const PLUGIN_SCRIPTS = path.resolve(here, "../../../../plugins/maestro/scripts");
const STEP1 = path.join(PLUGIN_SCRIPTS, "maestro-step1-gates.cjs");
const END = path.join(PLUGIN_SCRIPTS, "maestro-end-skills.cjs");

let tmp: string;
let n = 0;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-lists-scripts-"));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project(body: string | object | null): string {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  if (body !== null) {
    fs.writeFileSync(
      path.join(root, ".claude", "maestro.json"),
      typeof body === "string" ? body : JSON.stringify(body)
    );
  }
  return root;
}

function run(script: string, root: string, args: string[] = []) {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: path.join(tmp, "home") };
  delete env.CLAUDE_CODE_SESSION_ID; // `064`: never write into the developer's own session dir
  const res = spawnSync("node", [script, ...args], { encoding: "utf8", env });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

function expectContract(res: { code: number; stdout: string; stderr: string }, label: string): void {
  expect(res.code, `${label}: exit 0`).toBe(0);
  expect(res.stderr, `${label}: empty stderr`).toBe("");
  expect(res.stdout.endsWith("\n"), `${label}: newline-terminated`).toBe(true);
  expect(res.stdout.trimEnd().split("\n"), `${label}: exactly one line`).toHaveLength(1);
}

/** Positions of each id in the line, asserting they appear in the given order. */
function expectOrdered(line: string, ids: string[], label: string): void {
  let from = 0;
  for (const id of ids) {
    const at =
      line.indexOf("/" + id + ",", from) >= 0 ? line.indexOf("/" + id + ",", from) : line.indexOf("/" + id + ".", from);
    expect(at, `${label}: ${id} after previous`).toBeGreaterThanOrEqual(from);
    from = at + id.length;
  }
}

const v3 = (extra: Record<string, unknown>) => ({ version: 3, ...extra });

describe("plugin copy of maestro-step1-gates.cjs", () => {
  it("old gates booleans are not read: no start_skills is the same line as empty lists, per target", () => {
    for (const args of [[], ["--for", "to_maestro_tasks"]]) {
      const empty = run(STEP1, project(v3({ start_skills: { maestro: [], to_maestro_tasks: [] } })), args);
      const old = run(
        STEP1,
        project(v3({ gates: { confidence_check: true, use_code_architecture_design_check: true } })),
        args
      );
      expectContract(old, "gates " + args.join(" "));
      expect(old.stdout).toBe(empty.stdout);
    }
  });

  it("names the configured lists in order, namespaced ids intact, targets independent", () => {
    const root = project(
      v3({
        start_skills: {
          maestro: ["concept-skills:use-code-architecture-design-check", "zeta", "alpha"],
          to_maestro_tasks: ["beta", "alpha"],
        },
      })
    );
    const m = run(STEP1, root);
    expectContract(m, "maestro");
    expectOrdered(m.stdout, ["concept-skills:use-code-architecture-design-check", "zeta", "alpha"], "maestro");
    expect(m.stdout).not.toContain("beta");
    const t = run(STEP1, root, ["--for", "to_maestro_tasks"]);
    expectContract(t, "tasks");
    expectOrdered(t.stdout, ["beta", "alpha"], "tasks");
    expect(t.stdout).not.toContain("zeta");
  });

  it("reordering the list changes the line", () => {
    const a = run(STEP1, project(v3({ start_skills: { maestro: ["a", "b"], to_maestro_tasks: [] } })));
    const b = run(STEP1, project(v3({ start_skills: { maestro: ["b", "a"], to_maestro_tasks: [] } })));
    expect(a.stdout).not.toBe(b.stdout);
  });

  it("empty lists give the same line as every degenerate input (per target)", () => {
    for (const args of [[], ["--for", "to_maestro_tasks"]]) {
      const empty = run(STEP1, project(v3({ start_skills: { maestro: [], to_maestro_tasks: [] } })), args);
      expectContract(empty, "empty " + args.join(" "));
      const degenerate: [string, string | object | null][] = [
        ["absent maestro.json", null],
        ["corrupt", "{ nope"],
        ["empty file", ""],
        ["array", "[]"],
        ["null", "null"],
        ["version 2", { version: 2, start_skills: { maestro: ["a"] }, gates: { confidence_check: true } }],
        ["version 4", { version: 4, start_skills: { maestro: ["a"] } }],
        ["version string", { version: "3", start_skills: { maestro: ["a"] } }],
        ["no version", { start_skills: { maestro: ["a"] } }],
      ];
      for (const [label, body] of degenerate) {
        const res = run(STEP1, project(body), args);
        expectContract(res, `${label} ${args.join(" ")}`);
        expect(res.stdout, label).toBe(empty.stdout);
      }
    }
  });

  it("survives a maestro.json that is a directory and a project dir that does not exist", () => {
    const root = project(null);
    fs.mkdirSync(path.join(root, ".claude", "maestro.json"));
    expectContract(run(STEP1, root), "dir");
    expectContract(run(STEP1, path.join(tmp, "nope")), "missing project");
  });

  it("a trailing --for with no value, or an unknown target, means the orchestrator list", () => {
    const root = project(v3({ start_skills: { maestro: ["only-maestro"], to_maestro_tasks: ["only-tasks"] } }));
    for (const args of [["--for"], ["--for", "bogus"], ["--bogus"]]) {
      const res = run(STEP1, root, args);
      expectContract(res, args.join(" "));
      expect(res.stdout).toContain("/only-maestro");
      expect(res.stdout).not.toContain("only-tasks");
    }
  });

  it("drops ids with whitespace or control characters so the output stays one line", () => {
    const root = project(
      v3({ start_skills: { maestro: ["ok", "bad\nid", "bad id", "tab\tid", " trimmed "], to_maestro_tasks: [] } })
    );
    const res = run(STEP1, root);
    expectContract(res, "whitespace ids");
    expectOrdered(res.stdout, ["ok", "trimmed"], "whitespace ids");
    expect(res.stdout).not.toContain("bad");
  });

  it("falls back to cwd when CLAUDE_PROJECT_DIR is unset", () => {
    const root = project(v3({ start_skills: { maestro: ["from-cwd"], to_maestro_tasks: [] } }));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: path.join(tmp, "home") };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.CLAUDE_CODE_SESSION_ID;
    const res = spawnSync("node", [STEP1], { encoding: "utf8", env, cwd: root });
    expectContract({ code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr }, "cwd");
    expect(res.stdout).toContain("/from-cwd");
  });

  it("still exits 0 with one line when its lib is missing (a half-copied script)", () => {
    const dir = path.join(tmp, "half-copy");
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ["maestro-step1-gates.cjs", "maestro-end-skills.cjs"]) {
      fs.copyFileSync(path.join(PLUGIN_SCRIPTS, f), path.join(dir, f));
    }
    const root = project(v3({ start_skills: { maestro: ["a"] }, end_skills: { maestro: ["b"] } }));
    expectContract(run(path.join(dir, "maestro-step1-gates.cjs"), root), "step1 no lib");
    expectContract(run(path.join(dir, "maestro-end-skills.cjs"), root), "end no lib");
  });
});

describe("plugin copy of maestro-end-skills.cjs", () => {
  it("names the configured end skills in order, namespaced ids intact", () => {
    const ids = ["concept-skills:wrap-up", "second", "third"];
    const res = run(END, project(v3({ end_skills: { maestro: ids } })));
    expectContract(res, "end");
    expectOrdered(res.stdout, ids, "end");
  });

  it("ignores start_skills", () => {
    const res = run(END, project(v3({ start_skills: { maestro: ["s"], to_maestro_tasks: ["t"] } })));
    expectContract(res, "end ignores start");
    expect(res.stdout).not.toContain("/s");
  });

  it("every degenerate input resolves to the same neutral line as an empty list", () => {
    const neutral = run(END, project(v3({ end_skills: { maestro: [] } })));
    expectContract(neutral, "empty");
    const cases: (string | object | null)[] = [
      null,
      "{ nope",
      "",
      "[]",
      "null",
      { version: 2, end_skills: { maestro: ["a"] } },
      { version: "3", end_skills: { maestro: ["a"] } },
      { end_skills: { maestro: ["a"] } },
      v3({ end_skills: { maestro: "a" } }),
      v3({ end_skills: [] }),
      v3({ end_skills: { maestro: [1, null, "", "a b"] } }),
    ];
    for (const body of cases) {
      const res = run(END, project(body));
      expectContract(res, JSON.stringify(body));
      expect(res.stdout, JSON.stringify(body)).toBe(neutral.stdout);
    }
  });
});
