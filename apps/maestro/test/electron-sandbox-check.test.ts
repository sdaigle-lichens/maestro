import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
// @ts-expect-error -- plain .mjs script, no declaration file
import * as check from "../scripts/check-electron-sandbox.mjs";

const repoRoot = "/work/maestro";
const glob = `${repoRoot}/node_modules/.pnpm/electron@*/node_modules/electron/dist/electron`;
const rootSetuid = { uid: 0, mode: 0o104755 };
const plain = { uid: 1000, mode: 0o100755 };
const base = { platform: "linux", restrictedUserns: "1\n", sandboxStat: plain, profileTexts: [], repoRoot };

describe("generateProfile", () => {
  it("scopes the profile to every electron@* store dir under the given repo root", () => {
    const text = check.generateProfile(repoRoot);
    expect(text).toContain(`profile maestro-electron ${glob} flags=(unconfined) {`);
    expect(text).toContain("userns,");
    expect(text).toContain("abi <abi/5.0>,");
    expect(text).not.toContain("/home/superadmin");
  });
});

describe("decide", () => {
  it("is a no-op off linux", () => {
    expect(check.decide({ ...base, platform: "darwin" }).ok).toBe(true);
  });
  it("passes when userns is unrestricted or the sysctl is unreadable", () => {
    expect(check.decide({ ...base, restrictedUserns: "0\n" }).ok).toBe(true);
    expect(check.decide({ ...base, restrictedUserns: null }).ok).toBe(true);
  });
  it("passes when electron is not installed", () => {
    expect(check.decide({ ...base, sandboxStat: null }).ok).toBe(true);
  });
  it("passes on a root-owned setuid helper", () => {
    expect(check.decide({ ...base, sandboxStat: rootSetuid }).ok).toBe(true);
  });
  it("rejects a setuid bit on a non-root owner", () => {
    expect(check.decide({ ...base, sandboxStat: { uid: 1000, mode: 0o104755 } }).ok).toBe(false);
  });
  it("passes when an installed profile covers this repo", () => {
    expect(check.decide({ ...base, profileTexts: ["unrelated", check.generateProfile(repoRoot)] }).ok).toBe(true);
  });
  it("fails when the only profile belongs to another repo", () => {
    expect(check.decide({ ...base, profileTexts: [check.generateProfile("/other/repo")] }).ok).toBe(false);
  });
  it("fails when neither the bit nor a profile is present", () => {
    expect(check.decide(base).ok).toBe(false);
  });
});

describe("gather", () => {
  const enoent = () => {
    throw Object.assign(new Error("nope"), { code: "ENOENT" });
  };
  it("tolerates unreadable apparmor dir, sysctl and missing electron", () => {
    const facts = check.gather({
      repoRoot,
      platform: "linux",
      readFile: enoent,
      readdir: enoent,
      stat: enoent,
      realpath: enoent,
    });
    expect(facts.sandboxStat).toBeNull();
    expect(facts.restrictedUserns).toBeNull();
    expect(facts.profileTexts).toEqual([]);
  });
  it("skips profile files it cannot read and keeps the rest", () => {
    const facts = check.gather({
      repoRoot,
      platform: "linux",
      readdir: () => ["a", "b"],
      readFile: (f: string) => {
        if (f.endsWith("/a")) throw Object.assign(new Error("denied"), { code: "EACCES" });
        return "content-b";
      },
      stat: () => rootSetuid,
      realpath: (p: string) => p,
    });
    expect(facts.profileTexts).toEqual(["content-b"]);
    expect(facts.sandboxStat).toEqual(rootSetuid);
  });
});

describe("gather on a real temp layout", () => {
  it("resolves the pnpm store chrome-sandbox through the symlink and sees it is not setuid", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-check-")));
    try {
      const store = path.join(root, "node_modules/.pnpm/electron@99.0.0/node_modules/electron");
      fs.mkdirSync(path.join(store, "dist"), { recursive: true });
      fs.writeFileSync(path.join(store, "dist/chrome-sandbox"), "x", { mode: 0o755 });
      fs.mkdirSync(path.join(root, "apps/maestro/node_modules"), { recursive: true });
      fs.symlinkSync(store, path.join(root, "apps/maestro/node_modules/electron"));
      const facts = check.gather({ repoRoot: root });
      expect(facts.sandboxPath).toBe(path.join(store, "dist/chrome-sandbox"));
      expect(check.hasSetuidRoot(facts.sandboxStat)).toBe(false);
      expect(check.decide({ ...facts, platform: "linux", restrictedUserns: "1\n", profileTexts: [] }).ok).toBe(false);
      expect(
        check.decide({
          ...facts,
          platform: "linux",
          restrictedUserns: "1\n",
          profileTexts: [check.generateProfile(root)],
        }).ok
      ).toBe(true);
      expect(check.decide({ ...facts, platform: "linux", restrictedUserns: "0", profileTexts: [] }).ok).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("dev script wiring", () => {
  it("runs the preflight before electron-vite and never passes --no-sandbox", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
    expect(pkg.scripts.dev).toMatch(/^node scripts\/check-electron-sandbox\.mjs && electron-vite dev/);
    expect(JSON.stringify(pkg.scripts)).not.toContain("--no-sandbox");
  });
});

describe("failureMessage", () => {
  it("prints the exact one-time command and forbids --no-sandbox", () => {
    const msg = check.failureMessage({ profileFile: "/tmp/x/maestro-electron", sandboxPath: "/s/chrome-sandbox" });
    expect(msg).toContain(
      "sudo install -m 644 /tmp/x/maestro-electron /etc/apparmor.d/maestro-electron && sudo apparmor_parser -r /etc/apparmor.d/maestro-electron"
    );
    expect(msg).toContain("sudo chmod 4755 /s/chrome-sandbox");
    expect(msg).toContain("Do not use --no-sandbox");
  });
});
