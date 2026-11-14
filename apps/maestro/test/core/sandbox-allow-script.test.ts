// The plugin's real maestro-sandbox-allow.cjs, spawned against temp projects. Contract: a dry run
// writes nothing; --apply adds the narrow entries and keeps every other key; it recognises only its
// own entries, so a stale installer path is replaced and a hand-written entry is never touched;
// --remove takes back exactly what it added.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(here, "../../../../plugins/maestro");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "maestro-sandbox-allow.cjs");
const INSTALLER_ENTRY = `node ${path.join(PLUGIN_ROOT, "scripts", "maestro-install.js")} *`;

let tmp: string;
let home: string;
let n = 0;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-allow-script-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project(settings?: object | string): { root: string; settingsPath: string } {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  const settingsPath = path.join(root, ".claude", "settings.local.json");
  if (settings !== undefined) {
    fs.writeFileSync(settingsPath, typeof settings === "string" ? settings : JSON.stringify(settings));
  }
  return { root, settingsPath };
}

function run(root: string, ...flags: string[]) {
  return runEnv({}, root, ...flags);
}

function runEnv(extra: NodeJS.ProcessEnv, root: string, ...flags: string[]) {
  const res = spawnSync(process.execPath, [SCRIPT, root, ...flags], {
    encoding: "utf8",
    env: pinnedEnv(home, extra),
  });
  return { code: res.status ?? -1, out: JSON.parse(res.stdout), stderr: res.stderr };
}

const readSettings = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));

describe("maestro-sandbox-allow.cjs", () => {
  it("a dry run lists what --apply would add and writes nothing", () => {
    const { root, settingsPath } = project();
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out.dryRun).toBe(true);
    expect(out.upToDate).toBe(false);
    expect(out.added.map((a: { value: string }) => a.value)).toContain(INSTALLER_ENTRY);
    expect(out.applyCommand).toBe(`node ${SCRIPT} ${root} --apply`);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it("--apply adds the narrow entries and the script guards, keeping every other key", () => {
    const { root, settingsPath } = project({
      model: "opus",
      sandbox: { enabled: true, excludedCommands: ["gh *"] },
      permissions: { allow: ["Bash(ls)"] },
    });
    expect(run(root, "--apply").code).toBe(0);

    const s = readSettings(settingsPath);
    expect(s.model).toBe("opus");
    expect(s.sandbox.enabled).toBe(true);
    expect(s.permissions.allow).toEqual(["Bash(ls)"]);
    expect(s.sandbox.excludedCommands).toEqual([
      "gh *",
      "node .claude/scripts/maestro-render-orchestrator.cjs",
      "node .claude/scripts/maestro-render-orchestrator.cjs .",
      "node .claude/scripts/maestro-task-status.cjs worktree *",
      "node .claude/scripts/maestro-task-status.cjs freeform-check *",
      "node .claude/scripts/maestro-task-status.cjs merge *",
      "node .claude/scripts/maestro-agent-forks.cjs update *",
      INSTALLER_ENTRY,
    ]);
    expect(s.sandbox.filesystem.denyWrite).toEqual([path.join(root, ".claude", "scripts")]);
    expect(s.permissions.deny).toEqual(["Edit(/.claude/scripts/**)"]);

    const again = run(root);
    expect(again.out.upToDate).toBe(true);
    expect(again.out.sandboxEnabled).toBe(true);
  });

  it("replaces an older plugin version's installer entry and reports, but keeps, a broad hand-written one", () => {
    const stale = "node /old/cache/maestro/0.1.0/scripts/maestro-install.js *";
    const broad = "node *maestro-install.js*";
    const { root, settingsPath } = project({ sandbox: { excludedCommands: [broad, stale] } });

    const preview = run(root);
    expect(preview.out.removed).toEqual([{ kind: "excludedCommands", value: stale }]);
    expect(preview.out.broadEntries).toEqual([broad]);

    run(root, "--apply");
    const entries = readSettings(settingsPath).sandbox.excludedCommands;
    expect(entries).toContain(broad);
    expect(entries).toContain(INSTALLER_ENTRY);
    expect(entries).not.toContain(stale);
  });

  it("--remove takes out only its own entries and leaves no empty containers", () => {
    const { root, settingsPath } = project({ model: "opus", sandbox: { excludedCommands: ["gh *"] } });
    run(root, "--apply");

    const preview = run(root, "--remove", "--dry-run");
    expect(preview.out.removed).toHaveLength(9);
    expect(readSettings(settingsPath).permissions.deny).toEqual(["Edit(/.claude/scripts/**)"]);

    expect(run(root, "--remove").code).toBe(0);
    expect(readSettings(settingsPath)).toEqual({ model: "opus", sandbox: { excludedCommands: ["gh *"] } });
  });

  it("refuses a settings.local.json that does not parse, writing nothing", () => {
    const { root, settingsPath } = project("{ not json");
    const { code, out } = run(root, "--apply");
    expect(code).toBe(1);
    expect(out.ok).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe("{ not json");
  });
});

// The --herdr opt-in. Each case gets its own HOME (the user-level settings.json is one of the files
// allowAllUnixSockets is read from) with a fake executable `herdr` in $HOME/.local/bin, put first on
// PATH because the developer's real herdr may sit on the ambient one.
describe("maestro-sandbox-allow.cjs --herdr", () => {
  type Change = { kind: string; value: string };
  let h = 0;

  function herdrHome(opts: { bin?: "home" | "outside" | "none"; userSettings?: object } = {}) {
    const hh = path.join(tmp, `herdr-home-${h}`);
    const outside = path.join(tmp, `herdr-outside-${h++}`);
    fs.mkdirSync(path.join(hh, ".claude"), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    if (opts.userSettings)
      fs.writeFileSync(path.join(hh, ".claude", "settings.json"), JSON.stringify(opts.userSettings));
    const where = opts.bin ?? "home";
    const binDir = where === "home" ? path.join(hh, ".local", "bin") : outside;
    if (where !== "none") {
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, "herdr"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    // "none": PATH holds only an empty dir; the script is spawned via process.execPath, so no node on PATH needed.
    const PATH = where === "none" ? outside : `${binDir}${path.delimiter}${process.env.PATH}`;
    return {
      home: hh,
      env: { HOME: hh, PATH, HERDR_ENV: "" }, // never inherit the developer's own herdr pane
      socket: path.join(hh, ".config", "herdr", "herdr.sock"),
      binary: path.join(binDir, "herdr"),
    };
  }

  const values = (cs: Change[], kind: string) => cs.filter((c) => c.kind === kind).map((c) => c.value);

  it("the default list has no herdr entry, dry run or --apply, even with herdr on PATH under HOME", () => {
    const hh = herdrHome();
    const { root, settingsPath } = project();

    const dry = runEnv(hh.env, root);
    expect(dry.code).toBe(0);
    expect(dry.out.herdr.optIn).toBe(false);
    expect(dry.out.herdr.binary).toBe(hh.binary); // found, yet not offered
    expect(JSON.stringify(dry.out.entries)).not.toMatch(/herdr/);
    expect(JSON.stringify(dry.out.added)).not.toMatch(/herdr/);
    expect(dry.out.applyCommand).not.toMatch(/--herdr/);
    expect(dry.out.removeCommand).not.toMatch(/--herdr/);

    expect(runEnv(hh.env, root, "--apply").code).toBe(0);
    const text = fs.readFileSync(settingsPath, "utf8");
    expect(text).not.toMatch(/herdr/);
    const s = JSON.parse(text);
    expect(s.sandbox.network).toBeUndefined();
    expect(s.sandbox.filesystem.allowWrite).toBeUndefined();
    expect(s.sandbox.filesystem.allowRead).toBeUndefined();
  });

  it("--herdr dry run lists the socket and binary entries, absolute, and writes nothing", () => {
    const hh = herdrHome();
    const { root, settingsPath } = project();
    const { code, out } = runEnv(hh.env, root, "--herdr");

    expect(code).toBe(0);
    expect(out.dryRun).toBe(true);
    expect(out.upToDate).toBe(false);
    expect(out.added).toEqual(
      expect.arrayContaining([
        { kind: "allowWrite", value: hh.socket },
        { kind: "allowRead", value: hh.binary },
        { kind: "allowUnixSockets", value: hh.socket },
        { kind: "excludedCommands", value: INSTALLER_ENTRY },
      ])
    );
    for (const c of out.added as Change[]) expect(c.value.startsWith("~")).toBe(false);
    expect(path.isAbsolute(hh.socket)).toBe(true);
    // the binary only, never its directory
    expect(values(out.added, "allowRead")).toEqual([hh.binary]);
    expect(out.herdr).toEqual({
      optIn: true,
      ask: false, // no sandbox.enabled in this project's settings
      declined: false,
      declineStale: false,
      declineRecorded: false,
      fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
      declineCommand: `node ${SCRIPT} ${root} --dry-run --decline-herdr`,
      present: false,
      binary: hh.binary,
      socket: hh.socket,
      socketExists: false,
      herdrEnv: false,
      settingsEntries: [],
      inUse: false,
      allowAllUnixSockets: false,
      unparseableSettings: [],
    });
    expect(out.applyCommand).toBe(`node ${SCRIPT} ${root} --apply --herdr`);
    expect(out.removeCommand).toBe(`node ${SCRIPT} ${root} --remove --herdr`);
    const allowWrite = (out.entries as { kind: string; why: string }[]).find((e) => e.kind === "allowWrite");
    expect(allowWrite?.why).toMatch(/sandbox escape/);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it("reports herdr evidence even when the binary is hidden (binary null)", () => {
    const hh = herdrHome({ bin: "none" });
    const { root } = project();

    const none = runEnv(hh.env, root).out.herdr;
    expect(none).toMatchObject({ binary: null, socketExists: false, herdrEnv: false, inUse: false });

    const env = runEnv({ ...hh.env, HERDR_ENV: "1" }, root).out.herdr;
    expect(env).toMatchObject({ binary: null, herdrEnv: true, inUse: true });

    fs.mkdirSync(path.dirname(hh.socket), { recursive: true });
    fs.writeFileSync(hh.socket, "");
    expect(runEnv(hh.env, root).out.herdr).toMatchObject({ socketExists: true, inUse: true });
  });

  it("reports herdr entries already in the project's settings", () => {
    const hh = herdrHome({ bin: "none" });
    const { root } = project({ sandbox: { filesystem: { allowRead: ["~/.local/bin/herdr", "/other"] } } });
    const herdr = runEnv(hh.env, root).out.herdr;
    expect(herdr.settingsEntries).toEqual([
      { file: path.join(root, ".claude", "settings.local.json"), kind: "allowRead", value: "~/.local/bin/herdr" },
    ]);
    expect(herdr.inUse).toBe(true);
  });

  it("--apply --herdr writes the herdr entries beside the base list; re-runs are up to date", () => {
    const hh = herdrHome();
    const { root, settingsPath } = project({ sandbox: { enabled: true } });
    expect(runEnv(hh.env, root, "--apply", "--herdr").code).toBe(0);

    const s = readSettings(settingsPath);
    expect(s.sandbox.enabled).toBe(true);
    expect(s.sandbox.filesystem.allowWrite).toEqual([hh.socket]);
    expect(s.sandbox.filesystem.allowRead).toEqual([hh.binary]);
    expect(s.sandbox.network.allowUnixSockets).toEqual([hh.socket]);
    expect(s.sandbox.excludedCommands).toContain(INSTALLER_ENTRY);
    expect(s.sandbox.filesystem.denyWrite).toEqual([path.join(root, ".claude", "scripts")]);
    expect(s.permissions.deny).toEqual(["Edit(/.claude/scripts/**)"]);

    expect(runEnv(hh.env, root, "--herdr").out.upToDate).toBe(true);

    // A plain --apply neither re-adds nor strips the herdr entries.
    const before = fs.readFileSync(settingsPath, "utf8");
    const plainDry = runEnv(hh.env, root);
    expect(plainDry.out.upToDate).toBe(true);
    expect(plainDry.out.removed).toEqual([]);
    expect(runEnv(hh.env, root, "--apply").code).toBe(0);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
  });

  it.each([
    ["settings.local.json", "local"],
    ["project .claude/settings.json", "project"],
    ["HOME/.claude/settings.json", "user"],
  ] as const)("allowAllUnixSockets: true in %s skips the allowUnixSockets entry", (_label, where) => {
    const flag = { sandbox: { network: { allowAllUnixSockets: true } } };
    const hh = herdrHome(where === "user" ? { userSettings: flag } : {});
    const { root, settingsPath } = project(where === "local" ? flag : undefined);
    if (where === "project") fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify(flag));

    const dry = runEnv(hh.env, root, "--herdr");
    expect(dry.out.herdr.allowAllUnixSockets).toBe(true);
    expect(values(dry.out.added, "allowUnixSockets")).toEqual([]);
    expect(dry.out.entries.some((e: Change) => e.kind === "allowUnixSockets")).toBe(false);

    expect(runEnv(hh.env, root, "--apply", "--herdr").code).toBe(0);
    const s = readSettings(settingsPath);
    expect(s.sandbox.filesystem.allowWrite).toEqual([hh.socket]);
    expect(s.sandbox.filesystem.allowRead).toEqual([hh.binary]);
    expect(s.sandbox.network?.allowUnixSockets).toBeUndefined();
    if (where === "local") expect(s.sandbox.network.allowAllUnixSockets).toBe(true);
    else expect(s.sandbox.network).toBeUndefined();
    expect(runEnv(hh.env, root, "--herdr").out.upToDate).toBe(true);
  });

  it("allowAllUnixSockets is read by precedence: a local false beats a user true", () => {
    const hh = herdrHome({ userSettings: { sandbox: { network: { allowAllUnixSockets: true } } } });
    const { root } = project({ sandbox: { network: { allowAllUnixSockets: false } } });
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({ sandbox: { network: { allowAllUnixSockets: true } } })
    );
    const { out } = runEnv(hh.env, root, "--herdr");
    expect(out.herdr.allowAllUnixSockets).toBe(false);
    expect(values(out.added, "allowUnixSockets")).toEqual([hh.socket]);
  });

  it("a non-boolean allowAllUnixSockets does not count as true", () => {
    const hh = herdrHome();
    const { root } = project({ sandbox: { network: { allowAllUnixSockets: "true" } } });
    const { out } = runEnv(hh.env, root, "--herdr");
    expect(out.herdr.allowAllUnixSockets).toBe(false);
    expect(values(out.added, "allowUnixSockets")).toEqual([hh.socket]);
  });

  it("an existing socket entry under allowAllUnixSockets: true is kept by --apply --herdr and taken by --remove --herdr", () => {
    const hh = herdrHome();
    const { root, settingsPath } = project();
    // Written by an earlier --apply --herdr, before allowAllUnixSockets was turned on.
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ sandbox: { network: { allowAllUnixSockets: true, allowUnixSockets: [hh.socket] } } })
    );

    const applied = runEnv(hh.env, root, "--apply", "--herdr");
    expect(applied.out.removed).toEqual([]);
    expect(readSettings(settingsPath).sandbox.network.allowUnixSockets).toEqual([hh.socket]);

    const removed = runEnv(hh.env, root, "--remove", "--herdr");
    expect(values(removed.out.removed, "allowUnixSockets")).toEqual([hh.socket]);
    const s = readSettings(settingsPath);
    expect(s.sandbox.network).toEqual({ allowAllUnixSockets: true });
  });

  it("--remove --herdr takes out only the herdr entries, leaving base, user entries and allowAllUnixSockets", () => {
    const hh = herdrHome();
    const userSock = "~/.config/herdr/herdr.sock";
    const { root, settingsPath } = project({
      sandbox: { filesystem: { allowWrite: [userSock, "/data/out"] } },
    });
    runEnv(hh.env, root, "--apply", "--herdr");
    const afterApply = readSettings(settingsPath);
    // the hand-written ~ socket entry already counts: no absolute duplicate is written
    expect(afterApply.sandbox.filesystem.allowWrite).toEqual([userSock, "/data/out"]);

    const preview = runEnv(hh.env, root, "--remove", "--herdr", "--dry-run");
    expect(preview.out.removed).toHaveLength(2); // allowRead, allowUnixSockets
    expect(readSettings(settingsPath)).toEqual(afterApply);

    expect(runEnv(hh.env, root, "--remove", "--herdr").code).toBe(0);
    const s = readSettings(settingsPath);
    expect(s.sandbox.filesystem.allowWrite).toEqual([userSock, "/data/out"]);
    expect(s.sandbox.filesystem.allowRead).toBeUndefined();
    expect(s.sandbox.network).toBeUndefined(); // emptied, so pruned
    expect(s.sandbox.excludedCommands).toContain(INSTALLER_ENTRY);
    expect(s.sandbox.filesystem.denyWrite).toEqual([path.join(root, ".claude", "scripts")]);
    expect(s.permissions.deny).toEqual(["Edit(/.claude/scripts/**)"]);
    expect(JSON.stringify(s)).not.toContain(hh.socket);
    expect(runEnv(hh.env, root, "--remove", "--herdr").out.upToDate).toBe(true);
  });

  it("--remove --herdr keeps allowAllUnixSockets and prunes an emptied filesystem block", () => {
    const hh = herdrHome();
    const { root, settingsPath } = project({ model: "opus", sandbox: { network: { allowAllUnixSockets: true } } });
    runEnv(hh.env, root, "--apply", "--herdr");
    runEnv(hh.env, root, "--remove");
    expect(readSettings(settingsPath)).toEqual({ model: "opus", sandbox: { network: { allowAllUnixSockets: true } } });

    // Only the herdr half, with nothing else in filesystem: the block disappears.
    const p2 = project({ sandbox: { enabled: true } });
    runEnv(hh.env, p2.root, "--apply", "--herdr");
    const s0 = readSettings(p2.settingsPath);
    s0.sandbox.filesystem = {
      allowWrite: s0.sandbox.filesystem.allowWrite,
      allowRead: s0.sandbox.filesystem.allowRead,
    };
    fs.writeFileSync(p2.settingsPath, JSON.stringify(s0));
    runEnv(hh.env, p2.root, "--remove", "--herdr");
    const s = readSettings(p2.settingsPath);
    expect(s.sandbox.filesystem).toBeUndefined();
    expect(s.sandbox.network).toBeUndefined();
    expect(s.sandbox.enabled).toBe(true);
  });

  it("a plain --remove after --apply --herdr restores the file's pre-apply content", () => {
    const hh = herdrHome();
    const original = { model: "opus", sandbox: { enabled: true, excludedCommands: ["gh *"] } };
    const { root, settingsPath } = project(original);
    runEnv(hh.env, root, "--apply", "--herdr");

    const preview = runEnv(hh.env, root, "--remove", "--dry-run");
    expect(preview.out.removed).toHaveLength(12); // 9 base + allowWrite, allowRead, allowUnixSockets

    expect(runEnv(hh.env, root, "--remove").code).toBe(0);
    expect(readSettings(settingsPath)).toEqual(original);
  });

  it.each(["outside", "none"] as const)("herdr %s HOME: no allowRead entry, socket entries still added", (bin) => {
    const hh = herdrHome({ bin });
    const { root, settingsPath } = project();
    const dry = runEnv(hh.env, root, "--herdr");
    expect(dry.out.herdr.binary).toBe(bin === "none" ? null : hh.binary);
    expect(values(dry.out.added, "allowRead")).toEqual([]);
    expect(values(dry.out.added, "allowWrite")).toEqual([hh.socket]);
    expect(values(dry.out.added, "allowUnixSockets")).toEqual([hh.socket]);

    runEnv(hh.env, root, "--apply", "--herdr");
    const s = readSettings(settingsPath);
    expect(s.sandbox.filesystem.allowRead).toBeUndefined();
    expect(s.sandbox.filesystem.allowWrite).toEqual([hh.socket]);
  });

  it("hand-written ~ herdr entries count as present: no duplicate on --apply --herdr, kept by --remove", () => {
    const hh = herdrHome();
    const tilde = {
      allowWrite: ["~/.config/herdr/herdr.sock"],
      allowRead: ["~/.local/bin/herdr"],
      allowUnixSockets: ["~/.config/herdr/herdr.sock"],
    };
    const { root, settingsPath } = project({
      sandbox: {
        filesystem: { allowWrite: tilde.allowWrite, allowRead: tilde.allowRead },
        network: { allowUnixSockets: tilde.allowUnixSockets },
      },
    });

    const dry = runEnv(hh.env, root, "--herdr");
    expect(dry.out.herdr.present).toBe(true);
    for (const kind of ["allowWrite", "allowRead", "allowUnixSockets"]) expect(values(dry.out.added, kind)).toEqual([]);
    expect(dry.out.removed).toEqual([]);
    // the plain run reports it too, which is what the skills read
    expect(runEnv(hh.env, root).out.herdr.present).toBe(true);

    expect(runEnv(hh.env, root, "--apply", "--herdr").code).toBe(0);
    const s = readSettings(settingsPath);
    expect(s.sandbox.filesystem.allowWrite).toEqual(tilde.allowWrite);
    expect(s.sandbox.filesystem.allowRead).toEqual(tilde.allowRead);
    expect(s.sandbox.network.allowUnixSockets).toEqual(tilde.allowUnixSockets);

    expect(runEnv(hh.env, root, "--remove", "--herdr").out.removed).toEqual([]);
    const after = readSettings(settingsPath);
    expect(after.sandbox.filesystem.allowWrite).toEqual(tilde.allowWrite);
    expect(after.sandbox.filesystem.allowRead).toEqual(tilde.allowRead);
    expect(after.sandbox.network.allowUnixSockets).toEqual(tilde.allowUnixSockets);
  });

  it("herdr.present is false until every herdr entry is there, and ignores the stale installer entry", () => {
    const hh = herdrHome();
    const { root } = project({
      sandbox: { filesystem: { allowWrite: [hh.socket] } },
    });
    expect(runEnv(hh.env, root, "--herdr").out.herdr.present).toBe(false);

    const full = project({
      sandbox: {
        excludedCommands: ["node /old/cache/maestro/0.1.0/scripts/maestro-install.js *"],
        filesystem: { allowWrite: [hh.socket], allowRead: [hh.binary] },
        network: { allowUnixSockets: [hh.socket] },
      },
    });
    const out = runEnv(hh.env, full.root).out;
    expect(out.upToDate).toBe(false); // the installer entry is stale
    expect(out.herdr.present).toBe(true); // yet the herdr entries are all there
  });

  it("a herdr symlink under HOME pointing outside HOME is allowed as the link path, never the target", () => {
    const hh = herdrHome({ bin: "none" });
    const target = path.join(tmp, "elsewhere-herdr");
    fs.writeFileSync(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const binDir = path.join(hh.home, ".local", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const link = path.join(binDir, "herdr");
    fs.symlinkSync(target, link);
    const env = { HOME: hh.home, PATH: binDir };

    const { root, settingsPath } = project();
    const dry = runEnv(env, root, "--herdr");
    expect(dry.code).toBe(0);
    expect(dry.out.herdr.binary).toBe(link);
    expect(values(dry.out.added, "allowRead")).toEqual([link]);

    runEnv(env, root, "--apply", "--herdr");
    const s = readSettings(settingsPath);
    expect(s.sandbox.filesystem.allowRead).toEqual([link]);
    expect(JSON.stringify(s)).not.toContain(target);
    expect(runEnv(env, root, "--herdr").out.upToDate).toBe(true);
  });

  it.each([
    ["project .claude/settings.json", "project"],
    ["HOME/.claude/settings.json", "user"],
  ] as const)("an unparseable %s is reported, not guessed at, and does not crash", (_label, where) => {
    const hh = herdrHome();
    const { root } = project();
    const bad =
      where === "project"
        ? path.join(root, ".claude", "settings.json")
        : path.join(hh.home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    fs.writeFileSync(bad, "{ not json");

    const { code, out } = runEnv(hh.env, root, "--herdr");
    expect(code).toBe(0);
    expect(out.ok).toBe(true);
    expect(out.herdr.allowAllUnixSockets).toBe(false);
    expect(out.herdr.unparseableSettings).toHaveLength(1);
    expect(out.herdr.unparseableSettings[0].file).toBe(bad);
    expect(out.herdr.unparseableSettings[0].error).toMatch(/JSON/i);
    expect(values(out.added, "allowUnixSockets")).toEqual([hh.socket]);
    expect(fs.readFileSync(bad, "utf8")).toBe("{ not json");
  });

  it("skips a non-executable herdr or a herdr directory on PATH, like command -v", () => {
    const hh = herdrHome({ bin: "none" });
    const dirFirst = path.join(hh.home, "a");
    const noExec = path.join(hh.home, "b");
    const real = path.join(hh.home, "c");
    fs.mkdirSync(path.join(dirFirst, "herdr"), { recursive: true });
    fs.mkdirSync(noExec, { recursive: true });
    fs.writeFileSync(path.join(noExec, "herdr"), "#!/bin/sh\n", { mode: 0o644 });
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, "herdr"), "#!/bin/sh\n", { mode: 0o755 });
    const PATH = [dirFirst, noExec, real].join(path.delimiter);

    const { out } = runEnv({ ...hh.env, PATH }, project().root, "--herdr");
    expect(out.herdr.binary).toBe(path.join(real, "herdr"));
    expect(values(out.added, "allowRead")).toEqual([path.join(real, "herdr")]);
  });
});

describe("maestro-sandbox-allow.cjs herdr decline record", () => {
  let d = 0;

  // A fresh HOME with a herdr under it (so herdr.binary is non-null and the entry set is known).
  function declineHome(binName = ".local/bin") {
    const hh = path.join(tmp, `decline-home-${d++}`);
    const binDir = path.join(hh, binName);
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(path.join(hh, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(binDir, "herdr"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    return { HOME: hh, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, HERDR_ENV: "" };
  }

  const enabled = { sandbox: { enabled: true } };
  const recordFile = (root: string) => path.join(root, ".claude", "maestro-sandbox", "herdr-decline.json");

  it("asks while nothing is recorded, and records a decline without touching any settings file", () => {
    const env = declineHome();
    const { root, settingsPath } = project(enabled);
    const before = fs.readFileSync(settingsPath, "utf8");

    expect(runEnv(env, root).out.herdr).toMatchObject({ ask: true, declined: false });

    const rec = runEnv(env, root, "--decline-herdr").out.herdr;
    expect(rec).toMatchObject({ declineRecorded: true, declined: true, ask: false });
    expect(fs.existsSync(recordFile(root))).toBe(true);
    expect(fs.readFileSync(path.join(root, ".claude", "maestro-sandbox", ".gitignore"), "utf8")).toBe("*\n");
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(false);
  });

  it("does not ask again on the next run", () => {
    const env = declineHome();
    const { root } = project(enabled);
    runEnv(env, root, "--decline-herdr");
    const next = runEnv(env, root).out.herdr;
    expect(next).toMatchObject({ ask: false, declined: true, declineStale: false, declineRecorded: false });
  });

  it("asks again when the entries the opt-in would add change", () => {
    const env = declineHome();
    const { root } = project(enabled);
    runEnv(env, root, "--decline-herdr");
    const moved = declineHome(".local/other-bin"); // another herdr path: a different allowRead entry
    const out = runEnv(moved, root).out.herdr;
    expect(out).toMatchObject({ ask: true, declined: false, declineStale: true });
  });

  it("--ask-herdr re-asks after a decline, and an opt-in adds the same entries and clears the record", () => {
    const env = declineHome();
    const { root, settingsPath } = project(enabled);
    runEnv(env, root, "--decline-herdr");
    expect(runEnv(env, root, "--ask-herdr").out.herdr).toMatchObject({ ask: true, declined: false });

    const dry = runEnv(env, root, "--herdr").out;
    expect(runEnv(env, root, "--apply", "--herdr").code).toBe(0);
    const s = readSettings(settingsPath);
    expect(s.sandbox.filesystem.allowWrite).toEqual(
      dry.added.filter((a: { kind: string }) => a.kind === "allowWrite").map((a: { value: string }) => a.value)
    );
    expect(fs.existsSync(recordFile(root))).toBe(false);
    expect(runEnv(env, root).out.herdr).toMatchObject({ present: true, ask: false });
  });

  it("never asks when the sandbox is disabled, or not known to be on", () => {
    const env = declineHome();
    for (const settings of [{ sandbox: { enabled: false } }, {}]) {
      const { root } = project(settings);
      expect(runEnv(env, root).out.herdr.ask).toBe(false);
    }
    // user-level settings that disable it lose to a project file that enables it
    fs.writeFileSync(path.join(env.HOME, ".claude", "settings.json"), JSON.stringify({ sandbox: { enabled: false } }));
    expect(runEnv(env, project(enabled).root).out.herdr.ask).toBe(true);
    expect(runEnv(env, project({}).root).out.herdr.ask).toBe(false);
  });
});

// Gaps in the decline-record coverage above: other commands leaving the record alone, a binary that
// moves or appears, corrupt and hand-edited records, a decline that writes no file, the precedence of
// sandbox.enabled and of unparseable settings files, and a `.claude` the script cannot write to.
describe("maestro-sandbox-allow.cjs herdr decline record, gaps", () => {
  let g = 0;
  const enabled = { sandbox: { enabled: true } };
  const recordFile = (root: string) => path.join(root, ".claude", "maestro-sandbox", "herdr-decline.json");

  // A HOME of its own. `binRel` is where a fake herdr is put and put first on PATH; null hides it.
  function gapHome(): string {
    const hh = path.join(tmp, `gap-home-${g++}`);
    fs.mkdirSync(path.join(hh, ".claude"), { recursive: true });
    return hh;
  }
  function gapEnv(hh: string, binRel: string | null): NodeJS.ProcessEnv {
    if (binRel === null) {
      const empty = path.join(hh, "empty-path");
      fs.mkdirSync(empty, { recursive: true });
      return { HOME: hh, PATH: empty, HERDR_ENV: "" };
    }
    const binDir = path.join(hh, binRel);
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "herdr"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    return { HOME: hh, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, HERDR_ENV: "" };
  }
  // The raw spawn, for a run that may print nothing (an uncaught write error).
  function rawRun(extra: NodeJS.ProcessEnv, root: string, ...flags: string[]) {
    return spawnSync(process.execPath, [SCRIPT, root, ...flags], { encoding: "utf8", env: pinnedEnv(home, extra) });
  }
  const writeRecord = (root: string, content: string) => {
    fs.mkdirSync(path.dirname(recordFile(root)), { recursive: true });
    fs.writeFileSync(recordFile(root), content);
  };

  it("--herdr (dry), --remove and --remove --herdr leave a recorded decline alone; the record has the documented shape", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root } = project(enabled);
    const dry = runEnv(env, root).out.herdr;
    runEnv(env, root, "--decline-herdr");
    const before = fs.readFileSync(recordFile(root), "utf8");

    const rec = JSON.parse(before);
    expect(rec.fingerprint).toBe(dry.fingerprint);
    expect(new Date(rec.declinedAt).toISOString()).toBe(rec.declinedAt);

    expect(runEnv(env, root, "--herdr").code).toBe(0);
    expect(runEnv(env, root, "--herdr", "--dry-run").code).toBe(0);
    expect(runEnv(env, root, "--remove").code).toBe(0);
    expect(runEnv(env, root, "--remove", "--herdr").code).toBe(0);
    expect(fs.readFileSync(recordFile(root), "utf8")).toBe(before);
    expect(runEnv(env, root).out.herdr).toMatchObject({ declined: true, ask: false });
  });

  it("--ask-herdr with nothing recorded asks, and writes no record", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root } = project(enabled);
    expect(runEnv(env, root, "--ask-herdr").out.herdr).toMatchObject({ ask: true, declined: false });
    expect(fs.existsSync(path.join(root, ".claude", "maestro-sandbox"))).toBe(false);
  });

  it("a herdr binary that moves within the same HOME changes the set: asked again, and back in place it is declined again", () => {
    const hh = gapHome();
    const { root } = project(enabled);
    const atHome = gapEnv(hh, ".local/bin");
    runEnv(atHome, root, "--decline-herdr");

    const moved = runEnv(gapEnv(hh, ".local/moved-bin"), root).out.herdr;
    expect(moved).toMatchObject({ ask: true, declined: false, declineStale: true });
    expect(moved.fingerprint).not.toBe(runEnv(atHome, root).out.herdr.fingerprint);

    expect(runEnv(atHome, root).out.herdr).toMatchObject({ ask: false, declined: true, declineStale: false });
  });

  it("a herdr binary that appears after a decline made while it was hidden re-asks", () => {
    const hh = gapHome();
    const { root } = project(enabled);
    runEnv(gapEnv(hh, null), root, "--decline-herdr");
    // hidden: no evidence at all, so the question is not due in the first place
    expect(runEnv(gapEnv(hh, null), root).out.herdr).toMatchObject({ ask: false, declined: true });

    expect(runEnv(gapEnv(hh, ".local/bin"), root).out.herdr).toMatchObject({
      ask: true,
      declined: false,
      declineStale: true,
    });
  });

  it("with no herdr evidence at all the question is not asked, even with the sandbox on", () => {
    const env = gapEnv(gapHome(), null);
    const { root } = project(enabled);
    expect(runEnv(env, root).out.herdr).toMatchObject({ inUse: false, binary: null, ask: false });
  });

  it.each([
    ["not JSON", "{ not json"],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["an object with no fingerprint", "{}"],
    ["a non-string fingerprint", '{"fingerprint": 42}'],
  ])(
    "a record that is %s never counts as a decline: asks, exits 0, and a dry run leaves it alone",
    (_label, content) => {
      const env = gapEnv(gapHome(), ".local/bin");
      const { root, settingsPath } = project(enabled);
      writeRecord(root, content);

      const res = runEnv(env, root);
      expect(res.code).toBe(0);
      expect(res.out.ok).toBe(true);
      expect(res.out.herdr).toMatchObject({ ask: true, declined: false, declineStale: false });
      expect(fs.readFileSync(recordFile(root), "utf8")).toBe(content);
      expect(fs.readFileSync(settingsPath, "utf8")).toBe(JSON.stringify(enabled));
    }
  );

  it("a record naming another entry set is stale: asked again, and a fresh decline replaces it", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root } = project(enabled);
    writeRecord(root, '{"fingerprint": "0000000000000000"}');
    expect(runEnv(env, root).out.herdr).toMatchObject({ ask: true, declined: false, declineStale: true });

    runEnv(env, root, "--decline-herdr");
    expect(runEnv(env, root).out.herdr).toMatchObject({ ask: false, declined: true, declineStale: false });
  });

  it("a hand-edited record that still names the current set, with extra keys, counts as a decline", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root } = project(enabled);
    const fingerprint = runEnv(env, root).out.herdr.fingerprint;
    writeRecord(root, JSON.stringify({ fingerprint, declinedAt: "by hand", note: "no thanks" }));
    expect(runEnv(env, root).out.herdr).toMatchObject({ ask: false, declined: true, declineStale: false });
  });

  it("--decline-herdr writes no settings file, whatever the project and user settings already hold", () => {
    const hh = gapHome();
    const env = gapEnv(hh, ".local/bin");
    const { root, settingsPath } = project({
      model: "opus",
      sandbox: { enabled: true, excludedCommands: ["gh *"], filesystem: { allowWrite: ["/data/out"] } },
      permissions: { allow: ["Bash(ls)"] },
    });
    const projectShared = path.join(root, ".claude", "settings.json");
    const userShared = path.join(hh, ".claude", "settings.json");
    fs.writeFileSync(projectShared, JSON.stringify({ permissions: { deny: ["Bash(rm)"] } }));
    fs.writeFileSync(userShared, JSON.stringify({ sandbox: { enabled: true } }));
    const files = [settingsPath, projectShared, userShared];
    const before = files.map((f) => fs.readFileSync(f, "utf8"));

    const rec = runEnv(env, root, "--decline-herdr").out;
    expect(rec.dryRun).toBe(true);
    expect(rec.herdr.declineRecorded).toBe(true);
    expect(files.map((f) => fs.readFileSync(f, "utf8"))).toEqual(before);
    expect(fs.existsSync(recordFile(root))).toBe(true);
  });

  it("--decline-herdr against an unparseable settings.local.json exits 1 and writes no record", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root, settingsPath } = project("{ not json");
    const res = runEnv(env, root, "--decline-herdr");
    expect(res.code).toBe(1);
    expect(res.out.ok).toBe(false);
    expect(fs.existsSync(recordFile(root))).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe("{ not json");
  });

  it("a No recorded while the sandbox is off still holds once the sandbox is turned on", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root, settingsPath } = project({ sandbox: { enabled: false } });
    expect(runEnv(env, root, "--decline-herdr").out.herdr).toMatchObject({ declineRecorded: true });

    fs.writeFileSync(settingsPath, JSON.stringify(enabled));
    expect(runEnv(env, root).out.herdr).toMatchObject({ ask: false, declined: true });
  });

  it("sandbox.enabled is read from the highest-precedence file that sets it: local, then project, then user", () => {
    const env = gapEnv(gapHome(), ".local/bin");

    const localOff = project({ sandbox: { enabled: false } });
    fs.writeFileSync(path.join(localOff.root, ".claude", "settings.json"), JSON.stringify(enabled));
    expect(runEnv(env, localOff.root).out.herdr.ask).toBe(false);

    const localOn = project({ sandbox: { enabled: true } });
    fs.writeFileSync(
      path.join(localOn.root, ".claude", "settings.json"),
      JSON.stringify({ sandbox: { enabled: false } })
    );
    expect(runEnv(env, localOn.root).out.herdr.ask).toBe(true);

    const projectOnly = project();
    fs.writeFileSync(path.join(projectOnly.root, ".claude", "settings.json"), JSON.stringify(enabled));
    expect(runEnv(env, projectOnly.root).out.herdr.ask).toBe(true);
  });

  it("an unparseable project settings.json is skipped (reported, not guessed at): the next file decides, and local still wins", () => {
    const hh = gapHome();
    fs.writeFileSync(path.join(hh, ".claude", "settings.json"), JSON.stringify({ sandbox: { enabled: false } }));
    const env = gapEnv(hh, ".local/bin");

    const userOff = project();
    fs.writeFileSync(path.join(userOff.root, ".claude", "settings.json"), "{ not json");
    const off = runEnv(env, userOff.root).out.herdr;
    expect(off.unparseableSettings).toHaveLength(1);
    expect(off.ask).toBe(false);

    const localOn = project(enabled);
    fs.writeFileSync(path.join(localOn.root, ".claude", "settings.json"), "{ not json");
    expect(runEnv(env, localOn.root).out.herdr).toMatchObject({ ask: true, unparseableSettings: [expect.anything()] });
  });

  it("turning allowAllUnixSockets on after a decline changes the entry set (one entry fewer), so it is asked again", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root, settingsPath } = project(enabled);
    runEnv(env, root, "--decline-herdr");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ sandbox: { enabled: true, network: { allowAllUnixSockets: true } } })
    );
    expect(runEnv(env, root).out.herdr).toMatchObject({ ask: true, declined: false, declineStale: true });
  });

  it.skipIf(process.getuid?.() === 0)(
    "--decline-herdr that cannot create the record exits non-zero, reports no recording, and changes no settings",
    () => {
      const env = gapEnv(gapHome(), ".local/bin");
      const { root, settingsPath } = project(enabled);
      const before = fs.readFileSync(settingsPath, "utf8");
      const claude = path.join(root, ".claude");
      fs.chmodSync(claude, 0o555);
      try {
        const res = rawRun(env, root, "--decline-herdr");
        expect(res.status).not.toBe(0);
        expect(res.stdout).not.toMatch(/"declineRecorded":true/);
        expect(fs.existsSync(recordFile(root))).toBe(false);
      } finally {
        fs.chmodSync(claude, 0o755);
      }
      expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    }
  );

  it("a plain --apply (no --herdr) after a decline keeps the record, and the next run is still declined", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root } = project(enabled);
    runEnv(env, root, "--decline-herdr");
    const before = fs.readFileSync(recordFile(root), "utf8");

    expect(runEnv(env, root, "--apply").code).toBe(0);
    expect(fs.readFileSync(recordFile(root), "utf8")).toBe(before);
    expect(runEnv(env, root).out.herdr).toMatchObject({ declined: true, ask: false });
  });

  it("--ask-herdr, even with --apply, leaves the record in place: the run after it is declined again", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root } = project(enabled);
    runEnv(env, root, "--decline-herdr");
    const before = fs.readFileSync(recordFile(root), "utf8");

    expect(runEnv(env, root, "--ask-herdr").out.herdr).toMatchObject({
      ask: true,
      declined: false,
      declineRecorded: false,
    });
    expect(runEnv(env, root, "--ask-herdr", "--apply").code).toBe(0);
    expect(fs.readFileSync(recordFile(root), "utf8")).toBe(before);
    expect(runEnv(env, root).out.herdr).toMatchObject({ ask: false, declined: true });
  });

  it("a user-level sandbox.enabled true counts when the project sets nothing; a local false beats it", () => {
    const hh = gapHome();
    fs.writeFileSync(path.join(hh, ".claude", "settings.json"), JSON.stringify(enabled));
    const env = gapEnv(hh, ".local/bin");
    expect(runEnv(env, project().root).out.herdr.ask).toBe(true);

    const localOff = project({ sandbox: { enabled: false } });
    expect(runEnv(env, localOff.root).out.herdr.ask).toBe(false);
  });

  it("an unparseable user-level settings.json is reported and skipped: alone it gives no answer, and a local enable still decides", () => {
    const hh = gapHome();
    fs.writeFileSync(path.join(hh, ".claude", "settings.json"), "{ not json");
    const env = gapEnv(hh, ".local/bin");

    const none = runEnv(env, project().root).out.herdr;
    expect(none.ask).toBe(false);
    expect(none.unparseableSettings).toHaveLength(1);

    const local = runEnv(env, project(enabled).root).out.herdr;
    expect(local.ask).toBe(true);
    expect(local.unparseableSettings).toHaveLength(1);
  });

  it.each([
    ["a string", "true"],
    ["null", null],
    ["a number", 1],
  ])("sandbox.enabled that is %s is not a boolean, so the herdr question is not asked", (_label, value) => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root } = project({ sandbox: { enabled: value } });
    expect(runEnv(env, root).out.herdr.ask).toBe(false);
  });

  it("a directory where the record file should be is read as no record (asked, exit 0); --decline-herdr then fails and changes no settings", () => {
    const env = gapEnv(gapHome(), ".local/bin");
    const { root, settingsPath } = project(enabled);
    const before = fs.readFileSync(settingsPath, "utf8");
    fs.mkdirSync(recordFile(root), { recursive: true });

    const res = runEnv(env, root);
    expect(res.code).toBe(0);
    expect(res.out.herdr).toMatchObject({ ask: true, declined: false });

    expect(rawRun(env, root, "--decline-herdr").status).not.toBe(0);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
  });
});
