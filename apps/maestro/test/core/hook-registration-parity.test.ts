// `122`: every script hooks.json registers has a same-event, same-matcher twin in BOTH project-local
// HOOK_REGISTRATIONS lists (the app's install.ts and the plugin's maestro-install.js). `121` was a
// divergence between them that only a comment contradicted; this makes the next one fail a test.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { HOOK_REGISTRATIONS as APP_REGISTRATIONS, findUpPluginRoot } from "../../src/core/install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const require = createRequire(import.meta.url);
const PLUGIN_REGISTRATIONS: Array<{ event: string; matcher: string; script: string }> = require(
  path.join(PLUGIN_ROOT, "scripts", "maestro-install.js")
).HOOK_REGISTRATIONS;

/** hooks.json's `.sh`/`.js` script name -> the `.cjs` the project copy is installed as. */
function projectScriptName(arg: string): string {
  return path.basename(arg).replace(/\.(js|sh)$/, ".cjs");
}

function hooksJsonEntries(): Array<{ event: string; matcher: string; script: string }> {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")).hooks;
  const out: Array<{ event: string; matcher: string; script: string }> = [];
  for (const [event, list] of Object.entries(hooks) as Array<[string, any[]]>) {
    for (const entry of list) {
      for (const h of entry.hooks ?? []) {
        for (const arg of h.args ?? []) {
          if (/\.(js|sh)$/.test(arg)) out.push({ event, matcher: entry.matcher ?? "", script: projectScriptName(arg) });
        }
      }
    }
  }
  return out;
}

const key = (r: { event: string; matcher: string; script: string }) => `${r.event}|${r.matcher}|${r.script}`;

describe("hooks.json vs HOOK_REGISTRATIONS parity (122)", () => {
  const wanted = hooksJsonEntries();

  it("reads a non-trivial hooks.json", () => {
    expect(wanted.length).toBeGreaterThan(10);
  });

  for (const [name, regs] of [
    ["install.ts", APP_REGISTRATIONS],
    ["maestro-install.js", PLUGIN_REGISTRATIONS],
  ] as const) {
    it(`every hooks.json script has a same-event, same-matcher twin in ${name}`, () => {
      const have = new Set(regs.map(key));
      expect(wanted.map(key).filter((k) => !have.has(k))).toEqual([]);
    });

    it(`${name} registers nothing hooks.json does not`, () => {
      const want = new Set(wanted.map(key));
      expect(regs.map(key).filter((k) => !want.has(k))).toEqual([]);
    });
  }
});
