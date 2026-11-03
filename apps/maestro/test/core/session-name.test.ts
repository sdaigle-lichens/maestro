// session-name.ts (`113`): deterministic `maestro-<id8>` / `maestro-mgr-<id8>` session names, the
// first-entrance-wins record in session.json, the `sessionTitle` decision for SessionStart and
// UserPromptSubmit, and re-derivation from the claim / epic records after the session directory was
// swept. Real fs against temp projects; CLAUDE_CODE_SESSION_ID is deleted by test/setup-isolation.ts
// and only ever stubbed explicitly here.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  sessionNameFor,
  entranceRoleFor,
  promptEntranceRole,
  noteEntrance,
  titleFor,
  storedName,
  storedSessionName,
  rederiveSessionName,
} from "../../src/core/session-name.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const ID = "0123abcd-1111-2222-3333-444455556666";
const OTHER = "ffffeeee-9999-8888-7777-666655554444";
const WORKER = "maestro-0123abcd";
const MANAGER = "maestro-mgr-0123abcd";

let tmp: string;
let root: string;
let claudeDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-113-name-"));
  root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  writeConfig(root, defaultish);
  claudeDir = path.join(root, ".claude");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sessionDir = (id = ID, dir = claudeDir) => path.join(dir, "maestro_sessions", id);
const stateOf = (id = ID, dir = claudeDir) =>
  JSON.parse(fs.readFileSync(path.join(sessionDir(id, dir), "session.json"), "utf8"));

function writeClaim(r: string, filename: string, claim: Record<string, unknown>) {
  const dir = path.join(r, ".claude", "maestro-tasks", "claims");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${filename}.json`), JSON.stringify(claim));
}

function writeEpic(r: string, slug: string, state: Record<string, unknown>) {
  const dir = path.join(r, ".claude", "epics", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ slug, workers: [], log: [], ...state }));
}

describe("sessionNameFor", () => {
  it("is maestro-<id8> for a worker and maestro-mgr-<id8> for a manager", () => {
    expect(sessionNameFor(ID, "worker")).toBe(WORKER);
    expect(sessionNameFor(ID, "manager")).toBe(MANAGER);
  });

  it("is deterministic: the same id always gives the same name", () => {
    expect(sessionNameFor(ID, "worker")).toBe(sessionNameFor(ID, "worker"));
  });

  it("uses the whole id when it is shorter than eight characters", () => {
    expect(sessionNameFor("abc", "worker")).toBe("maestro-abc");
  });

  it("is null for an invalid session id", () => {
    for (const bad of ["", "../escape", "a/b", "x".repeat(129), null, undefined, 42, {}]) {
      expect(sessionNameFor(bad, "worker"), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("entranceRoleFor / promptEntranceRole", () => {
  it("maps the two entrances, with or without a slash, namespace or whitespace", () => {
    expect(entranceRoleFor("maestro")).toBe("worker");
    expect(entranceRoleFor("/maestro")).toBe("worker");
    expect(entranceRoleFor("maestro:maestro")).toBe("worker");
    expect(entranceRoleFor("maestro-manager")).toBe("manager");
    expect(entranceRoleFor("/maestro-manager")).toBe("manager");
    expect(entranceRoleFor("maestro:maestro-manager")).toBe("manager");
    expect(entranceRoleFor("  maestro-manager  ")).toBe("manager");
  });

  it("rejects every other skill, including near-misses with the same prefix", () => {
    for (const name of [
      "maestro-tasks",
      "maestro-post-mortem",
      "maestro-manager-x",
      "maestromanager",
      "maestro:maestro-help",
      "",
      null,
      7,
    ]) {
      expect(entranceRoleFor(name), String(name)).toBeNull();
    }
  });

  it("reads the entrance a typed prompt starts with, and nothing else", () => {
    expect(promptEntranceRole("/maestro Complete the task described in file x.md")).toBe("worker");
    expect(promptEntranceRole("   /maestro-manager run the epic")).toBe("manager");
    expect(promptEntranceRole("/maestro\nsecond line")).toBe("worker");
    expect(promptEntranceRole("/maestro")).toBe("worker");
    expect(promptEntranceRole("/maestro:maestro-manager go")).toBe("manager");
    // No slash, a different command, the command mid-prompt, a non-string: not an entrance.
    expect(promptEntranceRole("maestro do it")).toBeNull();
    expect(promptEntranceRole("/maestro-tasks")).toBeNull();
    expect(promptEntranceRole("please run /maestro")).toBeNull();
    expect(promptEntranceRole("Use /maestro to complete the task")).toBeNull();
    expect(promptEntranceRole(undefined)).toBeNull();
  });
});

describe("noteEntrance", () => {
  it("records the derived name and its role in session.json", () => {
    expect(noteEntrance(claudeDir, ID, "worker")).toBe(WORKER);
    expect(stateOf()).toMatchObject({ session_name: WORKER, session_name_role: "worker", session_name_applied: false });
    expect(storedName(claudeDir, ID)).toBe(WORKER);
    expect(storedSessionName(claudeDir, ID)).toEqual({ name: WORKER, role: "worker", custom: false, applied: false });
  });

  it("first entrance wins: a later /maestro-manager keeps the worker name", () => {
    noteEntrance(claudeDir, ID, "worker");
    expect(noteEntrance(claudeDir, ID, "manager")).toBe(WORKER);
    expect(stateOf()).toMatchObject({ session_name: WORKER, session_name_role: "worker" });
  });

  it("first entrance wins the other way round too", () => {
    noteEntrance(claudeDir, ID, "manager");
    expect(noteEntrance(claudeDir, ID, "worker")).toBe(MANAGER);
    expect(storedName(claudeDir, ID)).toBe(MANAGER);
  });

  it("merges into an existing session.json without dropping its other fields", () => {
    fs.mkdirSync(sessionDir(), { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir(), "session.json"),
      JSON.stringify({ run_id: "r1", active_task: "001-a.md" })
    );
    noteEntrance(claudeDir, ID, "worker");
    expect(stateOf()).toMatchObject({ run_id: "r1", active_task: "001-a.md", session_name: WORKER });
  });

  it("recovers from an unparseable session.json instead of throwing", () => {
    fs.mkdirSync(sessionDir(), { recursive: true });
    fs.writeFileSync(path.join(sessionDir(), "session.json"), "{not json");
    expect(noteEntrance(claudeDir, ID, "worker")).toBe(WORKER);
    expect(stateOf().session_name).toBe(WORKER);
  });

  it("a recorded custom name is kept by a later entrance", () => {
    titleFor(claudeDir, { hook_event_name: "UserPromptSubmit", session_id: ID, session_title: "x" }); // no name yet: no-op
    expect(fs.existsSync(sessionDir())).toBe(false);
    noteEntrance(claudeDir, ID, "worker");
    titleFor(claudeDir, { hook_event_name: "UserPromptSubmit", session_id: ID, session_title: "my-own" });
    expect(noteEntrance(claudeDir, ID, "manager")).toBe("my-own");
  });

  it("does nothing, and creates nothing, for an invalid id or a project with no maestro.json", () => {
    expect(noteEntrance(claudeDir, "../evil", "worker")).toBeNull();
    expect(noteEntrance(claudeDir, undefined, "worker")).toBeNull();
    expect(fs.existsSync(path.join(claudeDir, "maestro_sessions"))).toBe(false);

    const bare = path.join(tmp, "not-maestro", ".claude");
    fs.mkdirSync(bare, { recursive: true });
    expect(noteEntrance(bare, ID, "worker")).toBeNull();
    expect(fs.existsSync(path.join(bare, "maestro_sessions"))).toBe(false);
  });

  it("keeps sessions apart: each id gets its own name", () => {
    noteEntrance(claudeDir, ID, "worker");
    noteEntrance(claudeDir, OTHER, "manager");
    expect(storedName(claudeDir, ID)).toBe(WORKER);
    expect(storedName(claudeDir, OTHER)).toBe("maestro-mgr-ffffeeee");
  });
});

describe("titleFor", () => {
  const ups = (extra: Record<string, unknown> = {}) => ({
    hook_event_name: "UserPromptSubmit",
    session_id: ID,
    ...extra,
  });
  const start = (extra: Record<string, unknown> = {}) => ({
    hook_event_name: "SessionStart",
    session_id: ID,
    source: "resume",
    ...extra,
  });

  it("returns null and writes nothing for a session that never entered Maestro", () => {
    expect(titleFor(claudeDir, ups())).toBeNull();
    expect(titleFor(claudeDir, start())).toBeNull();
    expect(fs.existsSync(path.join(claudeDir, "maestro_sessions"))).toBe(false);
  });

  it("UserPromptSubmit applies the stored name exactly once", () => {
    noteEntrance(claudeDir, ID, "worker");
    expect(titleFor(claudeDir, ups())).toBe(WORKER);
    expect(stateOf().session_name_applied).toBe(true);
    expect(titleFor(claudeDir, ups())).toBeNull();
    expect(titleFor(claudeDir, ups())).toBeNull();
  });

  it("SessionStart re-applies the stored name every time, even after UserPromptSubmit applied it", () => {
    noteEntrance(claudeDir, ID, "manager");
    expect(titleFor(claudeDir, ups())).toBe(MANAGER);
    for (const source of ["startup", "resume", "fork", "resume"]) {
      expect(titleFor(claudeDir, start({ source })), source).toBe(MANAGER);
    }
  });

  it("a custom session_title that differs is recorded as the name, never overwritten, and not emitted", () => {
    noteEntrance(claudeDir, ID, "worker");
    expect(titleFor(claudeDir, ups({ session_title: "  billing-boss  " }))).toBeNull();
    expect(storedSessionName(claudeDir, ID)).toEqual({
      name: "billing-boss",
      role: "worker",
      custom: true,
      applied: true,
    });
    // A later SessionStart without a title (or with the same one) does not clobber it with maestro-<id8>.
    expect(titleFor(claudeDir, start({ session_title: "billing-boss" }))).toBeNull();
    expect(storedName(claudeDir, ID)).toBe("billing-boss");
    expect(titleFor(claudeDir, start())).toBe("billing-boss");
    expect(storedName(claudeDir, ID)).toBe("billing-boss");
  });

  it("a session_title equal to the stored name emits nothing and marks it applied", () => {
    noteEntrance(claudeDir, ID, "worker");
    expect(titleFor(claudeDir, ups({ session_title: WORKER }))).toBeNull();
    expect(stateOf().session_name_applied).toBe(true);
    expect(stateOf().session_name_custom).toBeUndefined();
    expect(titleFor(claudeDir, ups())).toBeNull();
  });

  it("a blank session_title is not a custom title", () => {
    noteEntrance(claudeDir, ID, "worker");
    expect(titleFor(claudeDir, ups({ session_title: "   " }))).toBe(WORKER);
    expect(storedName(claudeDir, ID)).toBe(WORKER);
  });

  it("ignores every other event and malformed payloads", () => {
    noteEntrance(claudeDir, ID, "worker");
    for (const p of [
      { hook_event_name: "UserPromptExpansion", session_id: ID },
      { hook_event_name: "PreToolUse", session_id: ID },
      { hook_event_name: "SessionEnd", session_id: ID },
      {},
      null,
      undefined,
    ]) {
      expect(titleFor(claudeDir, p as never), JSON.stringify(p)).toBeNull();
    }
    expect(stateOf().session_name_applied).toBe(false); // none of them consumed the one-shot apply
  });

  it("an invalid payload session id does not fall through to the environment's id", () => {
    noteEntrance(claudeDir, ID, "worker");
    vi.stubEnv("CLAUDE_CODE_SESSION_ID", ID);
    expect(titleFor(claudeDir, ups({ session_id: "../bad" }))).toBeNull();
    // ...but a payload with no session_id at all does use the environment's.
    expect(titleFor(claudeDir, { hook_event_name: "UserPromptSubmit" })).toBe(WORKER);
  });

  it("no maestro.json: null even with a name on disk", () => {
    noteEntrance(claudeDir, ID, "worker");
    fs.rmSync(path.join(claudeDir, "maestro.json"));
    expect(titleFor(claudeDir, start())).toBeNull();
    expect(titleFor(claudeDir, ups())).toBeNull();
  });
});

describe("re-derivation after the session directory was swept", () => {
  const start = (extra: Record<string, unknown> = {}) => ({
    hook_event_name: "SessionStart",
    session_id: ID,
    source: "resume",
    ...extra,
  });

  it("from the claim this session holds (which may carry a custom name)", () => {
    writeClaim(root, "002-other.md", { session_id: OTHER, session_name: "not-me" });
    writeClaim(root, "001-a.md", { session_id: ID, session_name: "custom-worker" });
    expect(rederiveSessionName(claudeDir, ID)).toEqual({ name: "custom-worker", role: "worker" });
    expect(titleFor(claudeDir, start())).toBe("custom-worker");
    expect(stateOf()).toMatchObject({ session_name: "custom-worker", session_name_applied: true });
  });

  it("from an epic that records maestro-mgr-<id8> as its manager", () => {
    writeEpic(root, "billing", { manager: { name: MANAGER } });
    expect(titleFor(claudeDir, start())).toBe(MANAGER);
    expect(stateOf()).toMatchObject({ session_name: MANAGER, session_name_role: "manager" });
  });

  it("from an epic that records maestro-<id8> as a worker", () => {
    writeEpic(root, "billing", { manager: { name: "someone-else" }, workers: [{ name: WORKER }] });
    expect(titleFor(claudeDir, start())).toBe(WORKER);
    expect(stateOf().session_name_role).toBe("worker");
  });

  it("a manager record wins over a worker record in another epic, whatever the directory order", () => {
    writeEpic(root, "aaa", { manager: null, workers: [{ name: WORKER }] });
    writeEpic(root, "zzz", { manager: { name: MANAGER } });
    expect(rederiveSessionName(claudeDir, ID)).toEqual({ name: MANAGER, role: "manager" });
  });

  it("a claim with no session_name falls through to the epics", () => {
    writeClaim(root, "001-a.md", { session_id: ID });
    writeEpic(root, "billing", { workers: [{ name: WORKER }] });
    expect(rederiveSessionName(claudeDir, ID)).toEqual({ name: WORKER, role: "worker" });
  });

  it("another session's records, corrupt files and an unrelated epic re-derive nothing and create nothing", () => {
    writeClaim(root, "001-a.md", { session_id: OTHER, session_name: "maestro-ffffeeee" });
    writeEpic(root, "billing", { manager: { name: "maestro-mgr-ffffeeee" }, workers: [{ name: "maestro-ffffeeee" }] });
    fs.mkdirSync(path.join(root, ".claude", "epics", "broken"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "epics", "broken", "state.json"), "{nope");
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", "claims", "bad.json"), "{nope");
    expect(rederiveSessionName(claudeDir, ID)).toBeNull();
    expect(titleFor(claudeDir, start())).toBeNull();
    expect(fs.existsSync(sessionDir())).toBe(false);
  });

  it("UserPromptSubmit does not re-derive: only SessionStart does", () => {
    writeEpic(root, "billing", { manager: { name: MANAGER } });
    expect(titleFor(claudeDir, { hook_event_name: "UserPromptSubmit", session_id: ID })).toBeNull();
    expect(fs.existsSync(sessionDir())).toBe(false);
  });

  it("a custom session_title on the swept SessionStart is recorded instead and not emitted", () => {
    writeEpic(root, "billing", { manager: { name: MANAGER } });
    expect(titleFor(claudeDir, start({ session_title: "boss" }))).toBeNull();
    expect(storedSessionName(claudeDir, ID)).toEqual({ name: "boss", role: "manager", custom: true, applied: true });
  });

  it("a session_title equal to the re-derived name is recorded as non-custom", () => {
    writeEpic(root, "billing", { manager: { name: MANAGER } });
    expect(titleFor(claudeDir, start({ session_title: MANAGER }))).toBeNull();
    expect(storedSessionName(claudeDir, ID)).toEqual({ name: MANAGER, role: "manager", custom: false, applied: true });
  });

  it("from a linked worktree, the records are read in the main checkout", () => {
    // A linked worktree's `.git` is a file pointing at <main>/.git/worktrees/<name>.
    fs.mkdirSync(path.join(root, ".git", "worktrees", "wt"), { recursive: true });
    const wt = path.join(tmp, "wt");
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(root, ".git", "worktrees", "wt")}\n`);
    writeConfig(wt, defaultish);
    writeEpic(root, "billing", { manager: { name: MANAGER } });
    expect(rederiveSessionName(path.join(wt, ".claude"), ID)).toEqual({ name: MANAGER, role: "manager" });
  });
});
