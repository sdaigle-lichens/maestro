// The Agent SDK's child environment and tool set — the properties that are one edit apart from
// silently costing money, breaking a GUI launch, or handing an authoring run a shell.
//
// The query itself is not tested here: it spawns the user's own `claude`, costs tokens, and its
// interesting failures are packaging failures that no vitest run can reach. That half is verified
// by launching the packaged app (see `runAgentSdkSmoke` and apps/maestro/CLAUDE.md). The permission
// callback the session installs is `decideWrite`, tested exhaustively in `write-scope.test.ts`
// because it is pure; what a session DOES with it is verified in a real window.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  agentChildEnv,
  billingFrom,
  nodeSettings,
  resolveEffectiveSettings,
  BILLING_ENV_VARS,
  AGENT_SDK_PACKAGE,
  SESSION_TOOLS,
  SESSION_DISALLOWED_TOOLS,
} from "../../src/core/agent-sdk.js";

const HOME = "/home/tester";

describe("the child environment", () => {
  it("carries no billing credential the parent had", () => {
    const { env, dropped } = agentChildEnv({
      env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-live", ANTHROPIC_AUTH_TOKEN: "tok" },
      home: HOME,
      platform: "linux",
    });

    // `in`, not `=== undefined`: absence is the property, and a key present-but-undefined would
    // pass a truthiness check while still being something the SDK could spread forward.
    for (const key of BILLING_ENV_VARS) expect(key in env).toBe(false);
    expect(dropped).toEqual([...BILLING_ENV_VARS]);
  });

  it("still carries PATH — the whole reason `env` is dangerous", () => {
    // The SDK's `env` REPLACES the subprocess environment rather than merging into it. So the
    // naive way to drop an API key also drops PATH, and the CLI shells out to git and to hooks.
    const { env } = agentChildEnv({ env: { PATH: "/usr/bin" }, home: HOME, platform: "linux" });
    const dirs = (env.PATH ?? "").split(":");

    expect(dirs).toContain("/usr/bin");
    // And the EXPANDED path, not the app's own: a desktop-launched Electron process never sees
    // ~/.local/bin, which is where the installer puts `claude`.
    expect(dirs).toContain(`${HOME}/.local/bin`);
  });

  it("reports provider variables rather than removing them", () => {
    // A Bedrock or Vertex deployment is a thing the user configured on purpose; dropping it would
    // break a working setup to defend an assumption. Being silent about it is the other failure.
    const { env, otherProviderVars, dropped } = agentChildEnv({
      env: { PATH: "/usr/bin", CLAUDE_CODE_USE_BEDROCK: "1" },
      home: HOME,
      platform: "linux",
    });

    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(otherProviderVars).toEqual(["CLAUDE_CODE_USE_BEDROCK"]);
    expect(dropped).toEqual([]);
  });

  it("passes a clean parent through unchanged apart from PATH", () => {
    const { env, dropped, otherProviderVars } = agentChildEnv({
      env: { PATH: "/usr/bin", HOME, LANG: "en_US.UTF-8" },
      home: HOME,
      platform: "linux",
    });

    expect(env.HOME).toBe(HOME);
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(dropped).toEqual([]);
    expect(otherProviderVars).toEqual([]);
  });
});

describe("billing, as the CLI reports it", () => {
  it("reads a subscription from the two sources that mean no API key", () => {
    // "none" is not in the documented ApiKeySource union but is what the CLI emits at runtime for
    // an OAuth login — which is exactly the state this app wants to be in.
    expect(billingFrom("oauth")).toBe("subscription");
    expect(billingFrom("none")).toBe("subscription");
  });

  it("calls every other source an API bill", () => {
    for (const source of ["user", "project", "org", "temporary"]) {
      expect(billingFrom(source)).toBe("api-key");
    }
  });

  it("does not guess when the init message said nothing", () => {
    expect(billingFrom(null)).toBe("unknown");
  });
});

describe("the tool set a session is offered", () => {
  // The first permission layer, and the biggest. `allowedTools` is the trap: it auto-approves
  // without restricting, and an unlisted tool still falls through to the permission callback. These
  // two lists are the ones that decide what exists in the model's context at all.
  it("offers no shell and no subagents", () => {
    expect(SESSION_TOOLS).not.toContain("Bash");
    expect(SESSION_TOOLS).not.toContain("Agent");
    for (const tool of ["Bash", "Agent", "NotebookEdit"]) expect(SESSION_DISALLOWED_TOOLS).toContain(tool);
  });

  it("still offers everything a create-* run needs to finish a file", () => {
    // Reading the project to learn its conventions, and writing the one artifact it was opened for.
    for (const tool of ["Read", "Glob", "Grep", "Edit", "Write"]) expect(SESSION_TOOLS).toContain(tool);
  });

  it("names nothing it also forbids", () => {
    // Both lists reach the same query. A name in both is a contradiction the SDK resolves silently.
    for (const tool of SESSION_DISALLOWED_TOOLS) expect(SESSION_TOOLS, tool).not.toContain(tool);
  });
});

describe("the package name", () => {
  it("is the CLI-spawning SDK and not the REST client", () => {
    // The one that takes an API key and bills pay-as-you-go is `@anthropic-ai/sdk`. One path
    // segment apart, both install cleanly, and the wrong one defeats the entire point.
    expect(AGENT_SDK_PACKAGE).toBe("@anthropic-ai/claude-agent-sdk");
  });
});

describe("the settings cascade", () => {
  // The one test here that touches the real SDK, and it is worth the exception: every failure mode
  // of this call — a renamed export, a changed `sources` shape, an `alpha` API withdrawn — degrades
  // to `unresolved` in the UI rather than throwing anywhere a suite would notice. The dialog would
  // go on rendering, and go on quietly saying the settings were not consulted.
  //
  // It resolves the DEVELOPER's own settings, because `resolveSettings` has no home override. So
  // nothing is asserted about the values: only that the resolution runs, and that this module's
  // mapping of it produces the shape `read-scope.ts` consumes.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "settings-scope-"));

  it("resolves without spawning the CLI, and maps to the disclosure's shape", async () => {
    const snapshot = await resolveEffectiveSettings(cwd);

    expect(Array.isArray(snapshot.sources)).toBe(true);
    for (const source of snapshot.sources) {
      expect(["user", "project", "local", "managed", "flag"]).toContain(source.tier);
      expect(source.path === null || typeof source.path === "string").toBe(true);
      // Absent lists are normalised to empty ones. `read-scope.ts` iterates these unguarded, and a
      // settings file with no `permissions` block is the ordinary case, not the exotic one.
      for (const list of ["additionalDirectories", "allow", "deny", "ask"] as const) {
        expect(Array.isArray(source.permissions[list]), `${source.tier}.${list}`).toBe(true);
      }
    }

    for (const list of ["additionalDirectories", "allow", "deny", "ask"] as const) {
      expect(Array.isArray(snapshot.effective[list]), list).toBe(true);
    }
    expect(snapshot.effective.defaultMode === null || typeof snapshot.effective.defaultMode === "string").toBe(true);
  });

  it("is what the port hands over, so the composition root supplies no second implementation", async () => {
    const port = nodeSettings();
    const direct = await resolveEffectiveSettings(cwd);
    expect(await port.resolve(cwd)).toEqual(direct);
  });
});
