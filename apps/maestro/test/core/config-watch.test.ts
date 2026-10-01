import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { watchConfigFile } from "../../src/core/config-watch.js";

let root: string;
let file: string;
const write = (text: string) => fs.writeFileSync(file, text);

beforeEach(() => {
  vi.useFakeTimers();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "config-watch-"));
  fs.mkdirSync(path.join(root, ".claude"));
  file = path.join(root, ".claude", "maestro.json");
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("watchConfigFile", () => {
  it("is silent on the initial read", () => {
    write("{}");
    const cb = vi.fn();
    const stop = watchConfigFile(root, cb, 100);
    vi.advanceTimersByTime(50);
    expect(cb).not.toHaveBeenCalled();
    stop();
  });

  it("does not fire on a poll with no change", () => {
    write("{}");
    const cb = vi.fn();
    const stop = watchConfigFile(root, cb, 100);
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
    stop();
  });

  it("fires once per edit", () => {
    write("{}");
    const cb = vi.fn();
    const stop = watchConfigFile(root, cb, 100);
    write('{"a":1}');
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
  });

  it("fires when the file is created and when it is deleted", () => {
    const cb = vi.fn();
    const stop = watchConfigFile(root, cb, 100);
    write("{}");
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(1);
    fs.rmSync(file);
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops firing after unsubscribe", () => {
    write("{}");
    const cb = vi.fn();
    const stop = watchConfigFile(root, cb, 100);
    stop();
    write('{"a":1}');
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
  });

  it("never throws, even for a missing project or a throwing listener", () => {
    expect(() => watchConfigFile(path.join(root, "nope"), () => {}, 100)()).not.toThrow();
    write("{}");
    const stop = watchConfigFile(
      root,
      () => {
        throw new Error("boom");
      },
      100
    );
    write("{}\n");
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    stop();
  });
});
