// What a run can read, and where each part of that answer came from.
//
// The property under test is not "the list is correct" — it is "the list is EFFECTIVE". A
// disclosure built from what the app passes would pass every naive test while being wrong in
// exactly the case that matters: a settings file on disk widening the scope without the app ever
// asking. So most of what follows drives the builder with settings the app did not choose, and
// checks that they arrive attributed rather than absorbed.

import { describe, it, expect } from "vitest";
import path from "node:path";

import { buildReadScope, withinDirectory, RULE_DISPLAY_CAP } from "../../src/core/read-scope.js";
import type {
  ClaudeWriteTarget,
  EffectiveSettingsSnapshot,
  SettingsPermissions,
  SettingsTier,
} from "../../src/core/contracts.js";

const PROJECT = "/home/tester/repo";
const MARKET = "/home/tester/marketplaces/my-tools";

const permissions = (p: Partial<SettingsPermissions> = {}): SettingsPermissions => ({
  additionalDirectories: [],
  allow: [],
  deny: [],
  ask: [],
  defaultMode: null,
  ...p,
});

/** A snapshot whose `effective` is the union of its tiers — the shape the SDK hands back. */
function snapshot(tiers: Array<{ tier: SettingsTier; path: string | null } & Partial<SettingsPermissions>>) {
  const sources = tiers.map(({ tier, path: file, ...perms }) => ({
    tier,
    path: file,
    permissions: permissions(perms),
  }));
  const union = (pick: (p: SettingsPermissions) => string[]) => [
    ...new Set(sources.flatMap((s) => pick(s.permissions))),
  ];
  const snap: EffectiveSettingsSnapshot = {
    sources,
    effective: {
      additionalDirectories: union((p) => p.additionalDirectories),
      allow: union((p) => p.allow),
      deny: union((p) => p.deny),
      ask: union((p) => p.ask),
      defaultMode:
        sources
          .map((s) => s.permissions.defaultMode)
          .filter(Boolean)
          .pop() ?? null,
    },
  };
  return snap;
}

const targets = (...paths: string[]): ClaudeWriteTarget[] => paths.map((p) => ({ path: p, action: "modify" }));

describe("path containment", () => {
  it("counts a directory as containing itself", () => {
    expect(withinDirectory(PROJECT, PROJECT)).toBe(true);
  });

  it("does not mistake a sibling with a shared prefix for a child", () => {
    // The bug this exists for: `/repo-backup` starts with `/repo`, and a `startsWith` check would
    // report a whole second tree as readable. Every claim in this disclosure rests on this.
    expect(withinDirectory("/home/tester/repo", "/home/tester/repo-backup")).toBe(false);
    expect(withinDirectory("/home/tester/repo", "/home/tester/repo/src/main.ts")).toBe(true);
  });

  it("is false for a parent, which is the direction that matters", () => {
    expect(withinDirectory("/home/tester/repo/src", PROJECT)).toBe(false);
  });
});

describe("with nothing resolved", () => {
  const scope = buildReadScope({
    projectRoot: PROJECT,
    cwd: PROJECT,
    targets: targets(path.join(PROJECT, ".claude", "skills", "a", "SKILL.md")),
    settings: null,
  });

  it("still lists the working directory — the app's own choice needs no file to be known", () => {
    expect(scope.directories.map((d) => d.path)).toEqual([PROJECT]);
    expect(scope.directories[0].origin).toBe("cwd");
    expect(scope.directories[0].tier).toBeNull();
  });

  it("says the settings were not consulted rather than implying they added nothing", () => {
    // The two are different answers and only one of them is a guarantee. A scope that quietly
    // reported just the cwd would read as complete, which is the failure mode this whole slice is
    // about: a confident list that is not the effective configuration.
    expect(scope.unresolved).toMatch(/not consulted/);
    expect(scope.summary).toMatch(/could widen this list/);
    expect(scope.sources).toEqual([]);
    expect(scope.rules).toEqual([]);
  });
});

describe("directories a settings file added", () => {
  const scope = buildReadScope({
    projectRoot: PROJECT,
    cwd: PROJECT,
    targets: [],
    settings: snapshot([
      { tier: "user", path: "/home/tester/.claude/settings.json", additionalDirectories: ["/home/tester/notes"] },
      { tier: "project", path: `${PROJECT}/.claude/settings.json`, additionalDirectories: ["/srv/shared"] },
    ]),
  });

  it("lists them alongside the working directory, and marks which is which", () => {
    expect(scope.directories.map((d) => d.path)).toEqual([PROJECT, "/home/tester/notes", "/srv/shared"]);
    expect(scope.directories.map((d) => d.origin)).toEqual(["cwd", "settings", "settings"]);
  });

  it("keeps the file each one came from, rather than flattening them into one list", () => {
    // The acceptance criterion in one assertion. "These are the directories" is not the disclosure;
    // "the app chose this one and a file on disk added those two" is.
    const notes = scope.directories.find((d) => d.path === "/home/tester/notes")!;
    expect(notes.tier).toBe("user");
    expect(notes.file).toBe("/home/tester/.claude/settings.json");
    expect(notes.note).toMatch(/the app did not ask for this directory/);

    expect(scope.directories.find((d) => d.path === "/srv/shared")!.tier).toBe("project");
  });

  it("counts them in the summary, so the extra scope is visible without expanding anything", () => {
    expect(scope.summary).toMatch(/2 further directories were added by settings files/);
  });

  it("does not list a directory twice, however many tiers name it", () => {
    const dup = buildReadScope({
      projectRoot: PROJECT,
      cwd: PROJECT,
      targets: [],
      settings: snapshot([
        { tier: "user", path: "/u.json", additionalDirectories: ["/srv/shared"] },
        { tier: "local", path: "/l.json", additionalDirectories: ["/srv/shared", PROJECT] },
      ]),
    });
    // And the cwd is not re-listed as an addition just because a file also names it.
    expect(dup.directories.map((d) => d.path)).toEqual([PROJECT, "/srv/shared"]);
  });
});

describe("a run that reads one tree and writes into another", () => {
  // The asymmetry this slice exists to say out loud: a create-* run's working directory is the
  // TARGET — a marketplace repo — and not the open project. Correct for writing, backwards for
  // exploring, and completely invisible from a path list unless something says so.
  const scope = buildReadScope({
    projectRoot: PROJECT,
    cwd: MARKET,
    targets: targets(path.join(MARKET, "README.md")),
    settings: snapshot([{ tier: "user", path: "/home/tester/.claude/settings.json" }]),
  });

  it("reports the open project as unreadable, and names it", () => {
    expect(scope.projectReadable).toBe(false);
    expect(scope.summary).toContain(MARKET);
    expect(scope.summary).toContain(PROJECT);
    expect(scope.summary).toMatch(/cannot see the repository you have open/);
  });

  it("says so plainly when settings put the project back in scope", () => {
    const widened = buildReadScope({
      projectRoot: PROJECT,
      cwd: MARKET,
      targets: [],
      settings: snapshot([{ tier: "user", path: "/u.json", additionalDirectories: [PROJECT] }]),
    });
    expect(widened.projectReadable).toBe(true);
    expect(widened.summary).toMatch(/only because the settings added it/);
  });

  it("flags a write target that sits outside everything the run can read", () => {
    const blind = buildReadScope({
      projectRoot: PROJECT,
      cwd: MARKET,
      targets: targets(path.join(PROJECT, ".claude", "agents", "a.md")),
      settings: snapshot([{ tier: "user", path: "/u.json" }]),
    });
    expect(blind.writesOutsideReadScope).toEqual([path.join(PROJECT, ".claude", "agents", "a.md")]);
    expect(blind.summary).toMatch(/write .* it cannot read/);
  });

  it("says the ordinary thing when both are the open project", () => {
    const same = buildReadScope({ projectRoot: PROJECT, cwd: PROJECT, targets: [], settings: snapshot([]) });
    expect(same.projectReadable).toBe(true);
    expect(same.writesOutsideReadScope).toEqual([]);
    expect(same.summary).toBe(`This run reads the open project at ${PROJECT}.`);
  });
});

describe("permission rules the app never chose", () => {
  const scope = buildReadScope({
    projectRoot: PROJECT,
    cwd: PROJECT,
    targets: [],
    settings: snapshot([
      { tier: "user", path: "/home/tester/.claude/settings.json", allow: ["Bash(ls:*)"], ask: ["WebFetch"] },
      { tier: "local", path: `${PROJECT}/.claude/settings.local.json`, deny: ["Read(./.env)"] },
    ]),
  });

  it("carries each rule with the file it came from", () => {
    expect(scope.rules).toContainEqual({
      list: "deny",
      rule: "Read(./.env)",
      tier: "local",
      file: `${PROJECT}/.claude/settings.local.json`,
    });
    expect(scope.rules).toContainEqual({
      list: "allow",
      rule: "Bash(ls:*)",
      tier: "user",
      file: "/home/tester/.claude/settings.json",
    });
  });

  it("lists what RESTRICTS a run first, so a cap can only ever drop permissive entries", () => {
    const many = buildReadScope({
      projectRoot: PROJECT,
      cwd: PROJECT,
      targets: [],
      settings: snapshot([
        {
          tier: "user",
          path: "/u.json",
          allow: Array.from({ length: RULE_DISPLAY_CAP + 20 }, (_, i) => `Bash(cmd${i}:*)`),
          deny: ["Read(./secrets/**)"],
        },
      ]),
    });

    expect(many.rules).toHaveLength(RULE_DISPLAY_CAP);
    // 60 allow + 1 deny = 61 rules; the 21 past the cap are counted rather than listed, because
    // "and 21 more" is itself information about the configuration.
    expect(many.rulesOmitted).toBe(61 - RULE_DISPLAY_CAP);
    // The one that narrows what the run may do survived the truncation.
    expect(many.rules[0]).toMatchObject({ list: "deny", rule: "Read(./secrets/**)" });
  });

  it("reports the effective defaultMode and which tier set it", () => {
    const scoped = buildReadScope({
      projectRoot: PROJECT,
      cwd: PROJECT,
      targets: [],
      settings: snapshot([{ tier: "user", path: "/u.json", defaultMode: "acceptEdits" }]),
    });
    expect(scoped.defaultMode).toEqual({ mode: "acceptEdits", tier: "user" });
  });

  it("has no defaultMode to report when no tier sets one", () => {
    expect(scope.defaultMode).toBeNull();
  });
});

describe("a directory a person granted mid-session", () => {
  // The fourth origin, and the only one that did not exist when the session started. It is on this
  // list rather than in a second one precisely so it is listed, attributed and revocable through
  // the component that already renders directories — a flat list of paths destroys the distinction
  // that matters most here, which is "you granted this, in this session".
  const scope = () =>
    buildReadScope({
      projectRoot: PROJECT,
      cwd: PROJECT,
      targets: [],
      additional: [{ path: MARKET, note: "A marketplace the app opened." }],
      granted: [{ path: "/home/tester/.claude/skills/mine", note: "You opened this folder during this session." }],
      settings: snapshot([{ tier: "user", path: "/u.json" }]),
    });

  it("is disclosed with its own origin, not folded in with the app's own directories", () => {
    const granted = scope().directories.find((d) => d.origin === "session");
    expect(granted?.path).toBe("/home/tester/.claude/skills/mine");
    expect(granted?.note).toContain("You opened this");
    // And it did not quietly become one of the app's.
    expect(
      scope()
        .directories.filter((d) => d.origin === "app")
        .map((d) => d.path)
    ).toEqual([MARKET]);
  });

  it("reads after the app's directories and before anything a settings file added", () => {
    expect(scope().directories.map((d) => d.origin)).toEqual(["cwd", "app", "session"]);
  });

  it("is said out loud in the summary, in the second person", () => {
    // A grant the user cannot recognise as their own is indistinguishable from the app having
    // widened the scope by itself, which is the thing this whole disclosure exists to prevent.
    expect(scope().summary).toContain("You granted 1 more path");
    expect(scope().summary).toContain("until the session ends");
  });

  it("does not duplicate a path the app or the settings already opened", () => {
    const built = buildReadScope({
      projectRoot: PROJECT,
      cwd: PROJECT,
      targets: [],
      additional: [{ path: MARKET, note: "A marketplace the app opened." }],
      granted: [{ path: MARKET, note: "granted" }],
      settings: snapshot([{ tier: "user", path: "/u.json" }]),
    });
    expect(built.directories.filter((d) => d.path === MARKET)).toHaveLength(1);
    expect(built.directories.find((d) => d.path === MARKET)?.origin).toBe("app");
  });

  it("says nothing about grants when there are none", () => {
    const built = buildReadScope({
      projectRoot: PROJECT,
      cwd: PROJECT,
      targets: [],
      settings: snapshot([{ tier: "user", path: "/u.json" }]),
    });
    expect(built.directories.some((d) => d.origin === "session")).toBe(false);
    expect(built.summary).not.toContain("You granted");
  });
});
