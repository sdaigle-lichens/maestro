import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dedupeProjectRoots, tailSessionLogs } from "../../src/core/session-log.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dedupe-roots-")));
  dirs.push(d);
  return d;
};

describe("dedupeProjectRoots", () => {
  it("drops exact duplicates, trailing-slash spellings and symlinks, keeping the first spelling", () => {
    const root = tmp();
    const link = path.join(tmp(), "link");
    fs.symlinkSync(root, link);
    expect(dedupeProjectRoots([root, `${root}/`, link, root])).toEqual([root]);
  });

  it("keeps distinct projects and dedupes missing paths by spelling", () => {
    const a = tmp();
    const b = tmp();
    expect(dedupeProjectRoots([a, b])).toEqual([a, b]);
    expect(dedupeProjectRoots(["/no/such/x", "/no/such/x/"])).toEqual(["/no/such/x"]);
  });

  it("tailSessionLogs inits a session once when its project is listed under two spellings", () => {
    const root = tmp();
    const dir = path.join(root, ".claude", "maestro_sessions", "s1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "log.jsonl"), "");
    const inits: string[] = [];
    const stop = tailSessionLogs(() => [root, `${root}/`], { init: (r, id) => inits.push(`${r}|${id}`) }, 10_000);
    stop();
    expect(inits).toEqual([`${root}|s1`]);
  });
});
