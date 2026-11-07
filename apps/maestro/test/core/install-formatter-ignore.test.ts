// maestro-install.js keeps formatters off Maestro-managed files: it appends the managed paths to a
// formatter ignore file that already exists, never creates one, and a reformatted managed file is
// the symptom it prevents (a changed hash makes the sync report it stale-customized).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { findUpPluginRoot } from "../../src/core/install.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER = path.join(findUpPluginRoot(here)!, "scripts", "maestro-install.js");

const PATHS = [
  ".claude/reports/",
  ".claude/handoffs/",
  ".claude/maestro.json",
  ".claude/maestro_sessions/",
  ".claude/channels/",
  ".claude/maestro-tasks/",
  ".claude/maestro-metrics/",
  ".claude/skills/maestro/",
];

let tmp: string;
let home: string;
let n = 0;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-formatter-ignore-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project(): string {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function run(root: string, ...flags: string[]) {
  const r = spawnSync("node", [INSTALLER, root, ...flags], { encoding: "utf8", env: pinnedEnv(home) });
  return { status: r.status, json: JSON.parse(r.stdout.trim().split("\n").pop()!) };
}

describe("maestro-install.js formatter ignore step", () => {
  it("appends exactly the missing paths to an existing .prettierignore and lists them", () => {
    const root = project();
    fs.writeFileSync(path.join(root, ".prettierignore"), "dist\n.claude/reports/\n");
    const { json } = run(root);
    expect(json.formatterIgnore[".prettierignore"]).toEqual(PATHS.slice(1));
    expect(fs.readFileSync(path.join(root, ".prettierignore"), "utf8")).toBe(
      "dist\n.claude/reports/\n" + PATHS.slice(1).join("\n") + "\n"
    );
  });

  it("adds a newline before appending when the file lacks one, and a re-run changes nothing", () => {
    const root = project();
    fs.writeFileSync(path.join(root, ".prettierignore"), "dist");
    run(root);
    const after = fs.readFileSync(path.join(root, ".prettierignore"), "utf8");
    expect(after.startsWith("dist\n.claude/reports/\n")).toBe(true);
    const again = run(root);
    expect(again.json.formatterIgnore[".prettierignore"]).toEqual([]);
    expect(fs.readFileSync(path.join(root, ".prettierignore"), "utf8")).toBe(after);
  });

  it("creates no formatter ignore file when none exists", () => {
    const root = project();
    const { json } = run(root);
    expect(json.formatterIgnore).toEqual({});
    for (const f of [".prettierignore", ".eslintignore", ".biomeignore"]) {
      expect(fs.existsSync(path.join(root, f))).toBe(false);
    }
  });

  it("updates .eslintignore and .biomeignore only when present", () => {
    const root = project();
    fs.writeFileSync(path.join(root, ".eslintignore"), "");
    const { json } = run(root);
    expect(Object.keys(json.formatterIgnore)).toEqual([".eslintignore"]);
    expect(json.formatterIgnore[".eslintignore"]).toEqual(PATHS);
  });

  it("does not duplicate a path covered by an exact line or a parent directory entry", () => {
    for (const parent of [".claude", ".claude/", "/.claude/", ".claude/skills"]) {
      const root = project();
      fs.writeFileSync(path.join(root, ".prettierignore"), `${parent}\n`);
      const { json } = run(root);
      const added = json.formatterIgnore[".prettierignore"] as string[];
      if (parent.includes("skills")) expect(added).not.toContain(".claude/skills/maestro/");
      else expect(added).toEqual([]);
    }
  });

  it("still updates the ignore file in --ignore-mode ignored", () => {
    const root = project();
    fs.writeFileSync(path.join(root, ".prettierignore"), "dist\n");
    const { json } = run(root, "--ignore-mode", "ignored");
    expect(json.ignoreMode).toBe("ignored");
    expect(json.formatterIgnore[".prettierignore"]).toEqual(PATHS);
  });

  it("reports an ignore file it cannot edit, and a formatter with no ignore file", () => {
    const root = project();
    const file = path.join(root, ".prettierignore");
    fs.writeFileSync(file, "dist\n");
    fs.chmodSync(file, 0o444);
    const { json } = run(root);
    if (process.getuid?.() !== 0) {
      expect(json.formatterIgnoreFailed.map((f: { file: string }) => f.file)).toEqual([".prettierignore"]);
    }
    expect(json.formatterDetected).toBe(true);

    const bare = project();
    fs.writeFileSync(path.join(bare, "package.json"), JSON.stringify({ scripts: { format: "prettier -w ." } }));
    const out = run(bare).json;
    expect(out.formatterDetected).toBe(true);
    expect(out.formatterIgnore).toEqual({});
  });

  it("reproduces the symptom: reformatted managed files go staleCustomized, restored ones do not", () => {
    const root = project();
    run(root);
    const reportsDir = path.join(root, ".claude", "reports");
    const handoffsDir = path.join(root, ".claude", "handoffs");
    const report = path.join(
      reportsDir,
      fs.readdirSync(reportsDir).find((f) => f.endsWith(".md"))!
    );
    const sender = fs.readdirSync(handoffsDir)[0];
    const handoff = path.join(handoffsDir, sender, fs.readdirSync(path.join(handoffsDir, sender))[0]);
    const seeds = new Map([report, handoff].map((f) => [f, fs.readFileSync(f, "utf8")]));

    // What prettier does to Markdown: add the trailing newline the seed lacks.
    for (const [f, text] of seeds) fs.writeFileSync(f, text + "\n");
    const stale = run(root).json;
    expect(stale.reportsSync.staleCustomized.length).toBe(1);
    expect(stale.handoffsSync.staleCustomized.length).toBe(1);

    for (const [f, text] of seeds) fs.writeFileSync(f, text);
    const clean = run(root).json;
    expect(clean.reportsSync.staleCustomized).toEqual([]);
    expect(clean.handoffsSync.staleCustomized).toEqual([]);
  });

  it("keeps CRLF line endings when appending to a CRLF ignore file", () => {
    const root = project();
    fs.writeFileSync(path.join(root, ".prettierignore"), "dist\r\n");
    run(root);
    const got = fs.readFileSync(path.join(root, ".prettierignore"), "utf8");
    expect(got).toBe("dist\r\n" + PATHS.join("\r\n") + "\r\n");
    expect(got).not.toMatch(/(^|[^\r])\n/);
  });

  it("reports an ignore path that is a directory as failed, and still exits 0", () => {
    const root = project();
    fs.mkdirSync(path.join(root, ".prettierignore"));
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.json.formatterIgnoreFailed).toEqual([{ file: ".prettierignore", reason: "EISDIR" }]);
  });

  it("leaves the ignore file untouched when the config is refused", () => {
    const root = project();
    fs.writeFileSync(path.join(root, ".prettierignore"), "dist\n");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), "{not json");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.json.refused).toBe("config");
    expect(fs.readFileSync(path.join(root, ".prettierignore"), "utf8")).toBe("dist\n");
  });

  it("keeps a real prettier run from making managed files stale, and shows the run would otherwise", () => {
    const require = createRequire(import.meta.url);
    const prettierBin = path.join(path.dirname(require.resolve("prettier/package.json")), "bin", "prettier.cjs");
    const managedMarkdown = (root: string) => {
      const files: string[] = [];
      const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".md")) files.push(p);
        }
      };
      walk(path.join(root, ".claude", "reports"));
      walk(path.join(root, ".claude", "handoffs"));
      return files;
    };
    const prettierWrite = (root: string) =>
      spawnSync(process.execPath, [prettierBin, "--write", "."], { cwd: root, encoding: "utf8", env: pinnedEnv(home) });

    // Control: no ignore file, so prettier rewrites managed files and the sync reports them stale.
    const control = project();
    run(control);
    const controlFiles = managedMarkdown(control);
    const controlSeeds = new Map(controlFiles.map((f) => [f, fs.readFileSync(f, "utf8")]));
    expect(prettierWrite(control).status).toBe(0);
    const changed = controlFiles.filter((f) => fs.readFileSync(f, "utf8") !== controlSeeds.get(f));
    expect(changed.length).toBeGreaterThan(0);
    const controlRun = run(control).json;
    expect(
      controlRun.reportsSync.staleCustomized.length + controlRun.handoffsSync.staleCustomized.length
    ).toBeGreaterThan(0);

    // Treated: the ignore file exists, so prettier leaves the managed files alone and nothing is stale.
    const root = project();
    fs.writeFileSync(path.join(root, ".prettierignore"), "");
    run(root);
    const files = managedMarkdown(root);
    const seeds = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
    expect(prettierWrite(root).status).toBe(0);
    expect(files.filter((f) => fs.readFileSync(f, "utf8") !== seeds.get(f))).toEqual([]);
    const treated = run(root).json;
    expect(treated.reportsSync.staleCustomized).toEqual([]);
    expect(treated.handoffsSync.staleCustomized).toEqual([]);
  }, 60_000);
});
