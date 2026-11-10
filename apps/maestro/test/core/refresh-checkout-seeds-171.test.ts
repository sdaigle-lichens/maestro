// `171`: a `pnpm refresh:runtime` run in one checkout must write nothing derived from another.
//
// Root cause this reproduces: the handoff and report template stores are machine-wide
// (`~/.claude/maestro-{handoff,report}-defaults.sqlite`), shared by the main checkout and every
// worktree, and any build that opens one moves its rows to ITS seed (`refreshSupersededSeeds`). The
// refresh's install step synced `.claude/handoffs/` and `.claude/reports/` from those rows, so a
// worktree refresh wrote whatever body another branch's build had left there, plus a `maestro.json`
// tracking entry pointing at it. The fix: the refresh passes `--checkout-seeds`, which syncs from
// the checkout's own bundled seeds and never opens a store.
//
// Real plugin script, spawned with HOME pinned to a temp dir whose stores stand in for "another
// branch's" state.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { writeHandoffDefault } from "../../src/core/handoff-defaults.js";
import {
  writeAgentReportDefault,
  readAgentReportDefault,
  seededReportDefault,
} from "../../src/core/report-defaults.js";
import { SEED_HANDOFFS } from "../../src/core/handoff-seeds.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";
import { refreshSteps } from "../../../../scripts/refresh-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const INSTALLER = path.join(PLUGIN_ROOT, "scripts", "maestro-install.js");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

let tmp: string;
let home: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-171-refresh-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const homeHandoffs = () => path.join(home, ".claude", "maestro-handoff-defaults.sqlite");
const homeReports = () => path.join(home, ".claude", "maestro-report-defaults.sqlite");
const cfgOf = (root: string) => JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));

/** A project installed from THIS checkout's seeds, with its own private stores. */
async function project(): Promise<string> {
  const root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  return root;
}

function install(root: string, ...flags: string[]) {
  return JSON.parse(execFileSync("node", [INSTALLER, root, ...flags], { encoding: "utf8", env: pinnedEnv(home) }));
}

/** A tracked handoff route whose file is this checkout's seed. */
function seededRoute(root: string): string {
  const handoffs = cfgOf(root).handoffs as Record<string, { syncedFrom?: { hash: string } }>;
  const id = Object.keys(handoffs).find(
    (k) =>
      handoffs[k]?.syncedFrom &&
      Object.hasOwn(SEED_HANDOFFS, k) &&
      handoffs[k]?.syncedFrom?.hash === sha(SEED_HANDOFFS[k] as string)
  );
  expect(id, "the fixture wires at least one seeded handoff route").toBeTruthy();
  return id as string;
}
const routeFile = (root: string, id: string) => {
  const [sender, receiver] = id.split("/");
  return path.join(root, ".claude", "handoffs", sender as string, `${receiver}.md`);
};

/** A tracked report whose file is this checkout's seed. */
function seededAgent(root: string): string {
  const reports = cfgOf(root).reports as Record<string, { id: string; syncedFrom?: { hash: string } }>;
  const name = Object.keys(reports).find((a) => {
    const seed = seededReportDefault(a);
    return seed !== null && reports[a]?.syncedFrom?.hash === sha(seed);
  });
  expect(name, "the fixture tracks at least one seeded report").toBeTruthy();
  return name as string;
}
const reportFile = (root: string, agent: string) =>
  path.join(root, ".claude", "reports", `${cfgOf(root).reports[agent].id}.md`);

/** Another branch's build left its own body in the shared store, a few versions ahead. */
function foreignHandoff(id: string): string {
  const body = `# another branch's ${id} protocol\n`;
  for (let i = 0; i < 3; i++) writeHandoffDefault(id, body, homeHandoffs());
  return body;
}
function foreignReport(agent: string): string {
  const body = `# another branch's ${agent} report\n`;
  for (let i = 0; i < 3; i++) writeAgentReportDefault(agent, body, homeReports());
  return body;
}

describe("a refresh writes only from its own checkout (171)", () => {
  it("reproduces the leak: a store-reading install copies another branch's handoff body and tracking", async () => {
    const root = await project();
    const id = seededRoute(root);
    const foreign = foreignHandoff(id);

    const summary = install(root);
    expect(summary.checkoutSeeds).toBe(false);
    expect(fs.readFileSync(routeFile(root, id), "utf8")).toBe(foreign);
    expect(cfgOf(root).handoffs[id].syncedFrom.hash).toBe(sha(foreign));
  });

  it("with --checkout-seeds the handoff file and its tracking stay this checkout's, and the store is untouched", async () => {
    const root = await project();
    const id = seededRoute(root);
    const tracked = cfgOf(root).handoffs[id];
    foreignHandoff(id);
    const storeBefore = fs.readFileSync(homeHandoffs());

    const summary = install(root, "--checkout-seeds");
    expect(summary.checkoutSeeds).toBe(true);
    expect(fs.readFileSync(routeFile(root, id), "utf8")).toBe(SEED_HANDOFFS[id]);
    expect(cfgOf(root).handoffs[id]).toEqual(tracked);
    expect(fs.readFileSync(homeHandoffs()).equals(storeBefore)).toBe(true);
  });

  it("with --checkout-seeds no store is created when none exists", async () => {
    const root = await project();
    fs.rmSync(path.join(home, ".claude"), { recursive: true, force: true });
    install(root, "--checkout-seeds");
    expect(fs.existsSync(homeHandoffs())).toBe(false);
    expect(fs.existsSync(homeReports())).toBe(false);
  });

  it("the same holds for reports", async () => {
    const root = await project();
    const agent = seededAgent(root);
    const tracked = cfgOf(root).reports[agent];
    const foreign = foreignReport(agent);

    install(root);
    expect(fs.readFileSync(reportFile(root, agent), "utf8")).toBe(foreign); // the leak

    // Put the checkout's own state back, then refresh the fixed way.
    fs.writeFileSync(reportFile(root, agent), seededReportDefault(agent) as string);
    const cfg = cfgOf(root);
    cfg.reports[agent] = tracked;
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), JSON.stringify(cfg, null, 2));
    const before = readAgentReportDefault(agent, homeReports());

    install(root, "--checkout-seeds");
    expect(fs.readFileSync(reportFile(root, agent), "utf8")).toBe(seededReportDefault(agent));
    expect(cfgOf(root).reports[agent]).toEqual(tracked);
    expect(readAgentReportDefault(agent, homeReports())).toEqual(before);
  });

  it("with --checkout-seeds a file still holding an older seed moves to this checkout's seed", async () => {
    const root = await project();
    const id = seededRoute(root);
    const old = "# an older seed body, left by a previous build\n";
    fs.writeFileSync(routeFile(root, id), old);
    const cfg = cfgOf(root);
    cfg.handoffs[id] = { id, syncedFrom: { version: 2, hash: sha(old) } };
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), JSON.stringify(cfg, null, 2));

    const summary = install(root, "--checkout-seeds");
    expect(summary.handoffsSync.refreshed).toContain(id);
    expect(fs.readFileSync(routeFile(root, id), "utf8")).toBe(SEED_HANDOFFS[id]);
    expect(cfgOf(root).handoffs[id].syncedFrom).toEqual({ version: 3, hash: sha(SEED_HANDOFFS[id] as string) });
  });

  it("pnpm refresh:runtime runs the install step with --checkout-seeds", () => {
    const steps = refreshSteps("/r") as Array<{ args: string[] }>;
    const installStep = steps.find((s) => s.args.some((a) => a.endsWith("maestro-install.js")));
    expect(installStep?.args).toContain("--checkout-seeds");
  });
});

/**
 * The real shape of the incident: a main checkout and a git worktree of it, each carrying the tracked
 * runtime (its own copy of the plugin, `maestro.json`, `handoffs/`, `reports/`), sharing one HOME and
 * so one pair of machine-wide stores. A refresh runs each checkout's OWN installer (its own plugin
 * copy), never the main checkout's.
 */
describe("a refresh in a git worktree writes only from that worktree (171)", () => {
  const gitEnv = () => pinnedEnv(home);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", ...args], {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
    });
  const installerOf = (root: string) => path.join(root, "plugins", "maestro", "scripts", "maestro-install.js");
  const installIn = (root: string, ...flags: string[]) =>
    JSON.parse(execFileSync("node", [installerOf(root), root, ...flags], { encoding: "utf8", env: gitEnv() }));

  /** A main checkout with its tracked runtime committed, and a worktree of it on its own branch. */
  async function pairOnDisk(): Promise<{ main: string; wt: string }> {
    const main = path.join(tmp, "main");
    const wt = path.join(tmp, "wt");
    fs.mkdirSync(main, { recursive: true });
    git(main, "init", "-q");
    fs.cpSync(PLUGIN_ROOT, path.join(main, "plugins", "maestro"), { recursive: true });
    writeConfig(main, defaultish);
    await installRuntime(
      main,
      PLUGIN_ROOT,
      path.join(tmp, "report-defaults.sqlite"),
      path.join(tmp, "project-tags.sqlite"),
      path.join(tmp, "handoff-defaults.sqlite")
    );
    const tracked = ["plugins/maestro", ".claude/maestro.json", ".claude/handoffs", ".claude/reports"].filter((p) =>
      fs.existsSync(path.join(main, p))
    );
    git(main, "add", "-f", "--", ...tracked);
    git(main, "commit", "-q", "-m", "tracked runtime");
    git(main, "worktree", "add", "-q", "-b", "wt-171", wt);
    return { main, wt };
  }

  it("reproduces the leak in a worktree: a refresh that reads the stores writes another branch's body into it", async () => {
    const { main, wt } = await pairOnDisk();
    const id = seededRoute(wt);
    const mainFile = fs.readFileSync(routeFile(main, id), "utf8");
    const mainCfg = cfgOf(main);
    const foreign = foreignHandoff(id);

    installIn(wt); // the pre-171 refresh, run in the worktree
    expect(fs.readFileSync(routeFile(wt, id), "utf8")).toBe(foreign);
    expect(cfgOf(wt).handoffs[id].syncedFrom.hash).toBe(sha(foreign));
    // The main checkout was not refreshed, so it is untouched.
    expect(fs.readFileSync(routeFile(main, id), "utf8")).toBe(mainFile);
    expect(cfgOf(main)).toEqual(mainCfg);
  });

  it("with --checkout-seeds the worktree's tracked runtime stays exactly as committed, and the store is untouched", async () => {
    const { wt } = await pairOnDisk();
    const id = seededRoute(wt);
    foreignHandoff(id);
    const storeBefore = fs.readFileSync(homeHandoffs());

    installIn(wt, "--checkout-seeds");
    // Nothing under the tracked runtime differs from the commit, which is this checkout's own seed.
    expect(git(wt, "status", "--porcelain", "--", ".claude/handoffs", ".claude/reports", ".claude/maestro.json")).toBe(
      ""
    );
    expect(fs.readFileSync(homeHandoffs()).equals(storeBefore)).toBe(true);
    expect(fs.readFileSync(routeFile(wt, id), "utf8")).toBe(SEED_HANDOFFS[id]);
  });

  it("the runtimeVersion stamp is the worktree's own plugin version, not the main checkout's", async () => {
    const { main, wt } = await pairOnDisk();
    const pluginJson = path.join(wt, "plugins", "maestro", ".claude-plugin", "plugin.json");
    const plugin = JSON.parse(fs.readFileSync(pluginJson, "utf8"));
    plugin.version = "99.0.0"; // this worktree's branch bumped the plugin; the main checkout did not
    fs.writeFileSync(pluginJson, JSON.stringify(plugin, null, 2));
    const mainVersion = cfgOf(main).runtimeVersion;

    installIn(wt, "--checkout-seeds");
    expect(cfgOf(wt).runtimeVersion).toBe("99.0.0");
    expect(cfgOf(main).runtimeVersion).toBe(mainVersion);
  });
});
