// scripts/refresh-runtime.mjs: the one command that refreshes this repo's tracked runtime.
// Order is the contract (libs, then the install that copies mirrors and syncs STEPS and settings,
// then the HANDOFFS render), and a failing step must stop the chain.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncManagedRegions } from "../../src/core/skill-regions.js";

// @ts-expect-error plain .mjs script with no type declarations
import { refresh, refreshSteps, REFRESH_COMMAND } from "../../../../scripts/refresh-runtime.mjs";
import { REFRESH_COMMAND as TEST_COMMAND, staleMirrors, describeStale } from "../helpers/mirror-parity.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("refresh-runtime script", () => {
  it("runs the libs build, then the install, then the render, in that order", () => {
    const names = refreshSteps(ROOT).map((s: { args: string[] }) => path.basename(s.args[0]));
    expect(names).toEqual(["build-plugin-libs.mjs", "maestro-install.js", "maestro-render-orchestrator.cjs"]);
  });

  it("names the same command the parity messages name", () => {
    expect(REFRESH_COMMAND).toBe(TEST_COMMAND);
  });

  it("stops at the first failing step and returns its status", () => {
    const calls: string[] = [];
    const run = (_cmd: string, args: string[]) => {
      calls.push(path.basename(args[0]));
      return { status: calls.length === 2 ? 3 : 0 };
    };
    expect(refresh(ROOT, run)).toBe(3);
    expect(calls).toEqual(["build-plugin-libs.mjs", "maestro-install.js"]);
  });

  it("returns 0 when every step succeeds", () => {
    expect(refresh(ROOT, () => ({ status: 0 }))).toBe(0);
  });

  it("maps a null exit status (killed step) to 1 and skips the rest", () => {
    const calls: number[] = [];
    expect(refresh(ROOT, () => (calls.push(1), { status: null }))).toBe(1);
    expect(calls).toHaveLength(1);
  });
});

describe("stale detection names the one command (negative controls)", () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

  it("a stale mirror is reported with the command and no cp line", () => {
    const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "mirror-"));
    try {
      fs.mkdirSync(path.join(tmp, "plugin"));
      fs.mkdirSync(path.join(tmp, "proj"));
      fs.writeFileSync(path.join(tmp, "plugin/a.js"), "new");
      fs.writeFileSync(path.join(tmp, "proj/a.cjs"), "old");
      const stale = staleMirrors(path.join(tmp, "plugin"), path.join(tmp, "proj"), [
        { src: "a.js", dest: "a.cjs" },
        { src: "a.js", dest: "gone.cjs" },
      ]);
      expect(stale.map((s) => s.reason)).toEqual(["differs", "missing"]);
      const msg = describeStale(stale);
      expect(msg).toContain("pnpm refresh:runtime");
      expect(msg).not.toContain("cp ");
      expect(describeStale([])).toBe("");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a tampered STEPS region is detected by the same check parity.test.ts uses", () => {
    const template = read("plugins/maestro/templates/maestro/SKILL.md");
    const installed = read(".claude/skills/maestro/SKILL.md");
    expect(syncManagedRegions(installed, template).text).toBe(installed);
    const stale = installed.replace("<!-- Maestro:STEPS:START -->", "<!-- Maestro:STEPS:START -->\nSTALE LINE");
    expect(stale).not.toBe(installed);
    const { text, missing } = syncManagedRegions(stale, template);
    expect(missing).toEqual([]);
    expect(text === stale).toBe(false);
    expect(text).toBe(installed);
  });
});
