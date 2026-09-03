// Guards on the process boundary.
//
// The whole premise of the desktop migration is that the renderer has no node access and reaches
// the filesystem only through the enumerated IPC channels. That is a property of configuration,
// not of code that would fail loudly if it regressed — flipping `nodeIntegration` to true or
// adding a generic `invoke(channel, ...)` to the preload bridge would work fine and silently
// undo it. Hence these assertions.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The barrel, deliberately: this is a node-side test, and the point of the prompt-drift check
// below is to compare the renderer's literal against what the MAIN process actually builds.
import {
  previewClaudeRun,
  PANE_SKILLS,
  PANE_TOOLS,
  SESSION_TOOLS,
  SESSION_DISALLOWED_TOOLS,
} from "../src/core/index.js";
import { IPC, IPC_EVENTS } from "../src/shared/ipc.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), "utf8");

/**
 * Drop comments before scanning for imports.
 *
 * Prose talks about imports: a JSDoc line reading ``derives one from `idea` `` matches an
 * import-specifier pattern exactly as well as a real import line does, and so does a comment
 * naming the very module a check exists to forbid. Line comments only for `//`, so a `"https://"`
 * inside a string survives.
 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every .ts/.tsx under a src subtree, excluding generated files. */
function sourcesUnder(rel: string): string[] {
  const root = path.join(appRoot, rel);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name) && e.name !== "routeTree.gen.ts") out.push(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

describe("BrowserWindow security flags", () => {
  const main = read("src/main/index.ts");

  it("disables node integration in the renderer", () => {
    expect(main).toMatch(/nodeIntegration:\s*false/);
  });

  it("keeps context isolation on", () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
  });

  it("routes external links to the OS browser instead of opening app frames", () => {
    expect(main).toContain("setWindowOpenHandler");
    expect(main).toMatch(/action:\s*"deny"/);
  });
});

describe("preload bridge", () => {
  const preload = read("src/preload/index.ts");

  it("exposes exactly one namespace", () => {
    const exposed = [...preload.matchAll(/exposeInMainWorld\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(exposed).toEqual(["maestro"]);
  });

  it("offers no generic invoke escape hatch", () => {
    // A passthrough like `invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)`
    // would hand the renderer every channel in the app, including future ones.
    expect(preload).not.toMatch(/invoke:\s*\(\s*channel/);
    expect(preload).not.toMatch(/ipcRenderer\.invoke\(\s*channel/);
  });

  it("only invokes channels declared in the shared contract", () => {
    const used = [...preload.matchAll(/ipcRenderer\.(?:invoke|on|removeListener)\(\s*IPC(_EVENTS)?\.(\w+)/g)].map(
      (m) => `${m[1] ? "IPC_EVENTS" : "IPC"}.${m[2]}`
    );
    const declared = new Set([
      ...Object.keys(IPC).map((k) => `IPC.${k}`),
      ...Object.keys(IPC_EVENTS).map((k) => `IPC_EVENTS.${k}`),
    ]);
    for (const u of used) expect(declared).toContain(u);
    // And no raw string channels anywhere.
    expect(preload).not.toMatch(/ipcRenderer\.(invoke|on)\(\s*["'`]/);
  });

  it("does not re-export node or electron internals to the window", () => {
    expect(preload).not.toContain('exposeInMainWorld("require"');
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*\bprocess\b/);
  });
});

describe("src/core boundary", () => {
  // THE REPLACEMENT FOR A PACKAGE EXPORT.
  //
  // `src/core` was `packages/maestro-core`, and the renderer-safe surface used to be enforced by
  // the package's `exports` map: the renderer imported `@repo/maestro-core/contracts`, and
  // reaching for the barrel instead was a different-looking import line that a reviewer would
  // catch. Both are relative paths now, and `../core/contracts.js` differs from
  // `../core/index.js` by one word. That is a real loss of safety, and this is what replaces it.
  //
  // What it costs to get wrong: the barrel re-exports modules that import fs and child_process.
  // A type pulled from it drags all of that into the renderer's type graph, and a value pulled
  // from it drags it into the renderer's BUNDLE. Quietly — types still resolve and tsc still
  // passes whenever @types/node is in scope — so nothing but an assertion catches it.
  //
  // Exactly two modules are renderer-safe, and both are self-contained by construction:
  // `contracts.ts` is interfaces only, `text.ts` has no imports at all. Adding a third means
  // proving it imports nothing that reaches the filesystem, so the list is deliberately short and
  // deliberately here rather than derived.
  const RENDERER_SAFE = ["contracts", "text"];

  const outsideMain = [...sourcesUnder("src/shared"), ...sourcesUnder("src/preload"), ...sourcesUnder("src/renderer")];
  const coreDir = path.join(appRoot, "src", "core");

  /** Every module specifier in `file`, from static imports, `export … from`, and `require()`. */
  function specifiersIn(file: string): string[] {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    return [
      ...[...src.matchAll(/(?:from|import)\s*\(?\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]),
      ...[...src.matchAll(/require\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]),
    ];
  }

  /**
   * The module under src/core a specifier names, or null if it points elsewhere.
   *
   * Resolved on the filesystem rather than pattern-matched, so `../core/index.js`,
   * `../../../core/index.js` and a `./` chain that happens to land in core are all the same
   * finding — the check must not be evadable by writing the path differently.
   */
  function coreModule(fromFile: string, spec: string): string | null {
    if (!spec.startsWith(".")) return null;
    const resolved = path.resolve(path.dirname(fromFile), spec);
    const rel = path.relative(coreDir, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return rel.replace(/\.(js|ts|tsx)$/, "");
  }

  it("has files to check", () => {
    expect(outsideMain.length).toBeGreaterThan(0);
  });

  it("reaches src/core only through the renderer-safe modules", () => {
    const offenders: string[] = [];
    for (const file of outsideMain) {
      for (const spec of specifiersIn(file)) {
        const mod = coreModule(file, spec);
        if (mod !== null && !RENDERER_SAFE.includes(mod)) {
          offenders.push(`${path.relative(appRoot, file)} → src/core/${mod}`);
        }
      }
    }
    // Named in the failure so the message says which file and which module, not just "false".
    expect(offenders, `only src/core/{${RENDERER_SAFE.join(",")}} may be imported outside src/main`).toEqual([]);
  });

  it("still finds the imports it is supposed to be checking", () => {
    // A guard that silently stopped matching anything would pass forever. src/shared/ipc.ts
    // imports contracts and src/renderer/src/utils/text.ts re-exports text; if the resolver
    // regressed, this is what notices before the check above quietly becomes a no-op.
    const seen = new Set<string>();
    for (const file of outsideMain) {
      for (const spec of specifiersIn(file)) {
        const mod = coreModule(file, spec);
        if (mod !== null) seen.add(mod);
      }
    }
    expect([...seen].sort()).toEqual(RENDERER_SAFE);
  });

  it("keeps the renderer-safe modules free of imports that could reach the filesystem", () => {
    // The other half of the boundary. `contracts.ts` and `text.ts` are safe to import only for as
    // long as they stay self-contained — a `import fs from "node:fs"` added to either would let
    // node through the front door with every import line in the app still looking correct.
    for (const mod of RENDERER_SAFE) {
      const specs = specifiersIn(path.join(coreDir, `${mod}.ts`));
      // ./types.js is the model contracts re-exports; it is interfaces only, same as this file.
      const allowed = new Set(["./types.js"]);
      expect(
        specs.filter((s) => !allowed.has(s)),
        `src/core/${mod}.ts imports something new`
      ).toEqual([]);
    }
  });

  it("never imports @repo/claude-fs outside the main process", () => {
    // Same hazard, one layer down: claude-fs is the package src/core reads the filesystem with.
    const offenders = outsideMain.filter((file) => /["'`]@repo\/claude-fs/.test(fs.readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(appRoot, f))).toEqual([]);
  });

  it("imports no node builtins outside the main process", () => {
    const offenders = outsideMain.filter((file) => /from\s*["'`]node:/.test(fs.readFileSync(file, "utf8")));
    // The preload is a node context, but it deliberately imports nothing but electron — keeping
    // it that way is what makes the bridge auditable at a glance.
    expect(offenders.map((f) => path.relative(appRoot, f))).toEqual([]);
  });
});

describe("the claude bridge across the process boundary", () => {
  // The bridge's guarantee — the only executable prompts are ones the user was shown — rests on
  // `claude:run` accepting a token AND NOTHING ELSE. `test/core/claude.test.ts` covers the core
  // half (preview cannot spawn; a forged or replayed token is refused). What it cannot see is this
  // side of the wire: a preload that helpfully forwarded a prompt, an argv or a cwd alongside the
  // token would reopen the hole in a diff that looks like a convenience, and every core test would
  // still pass.
  const preload = read("src/preload/index.ts");
  const main = read("src/main/ipc.ts");

  it("sends the token and nothing else on the run channel", () => {
    const invoke = preload.match(/ipcRenderer\s*\n?\s*\.invoke\(IPC\.claudeRun[^)]*\)/);
    expect(invoke, "preload does not invoke IPC.claudeRun").not.toBeNull();
    expect(invoke![0]).toMatch(/invoke\(IPC\.claudeRun,\s*token\s*\)/);
  });

  it("never lets the renderer supply prompt text to either channel", () => {
    // preview takes a REQUEST (a shape main knows how to build a prompt from), never a prompt.
    expect(preload).toMatch(/invoke\(IPC\.claudePreview,\s*request\s*\)/);
    expect(preload).not.toMatch(/claudePreview,\s*(prompt|argv|cwd)/);
  });

  it("builds the prompt in the main process, from the open project", () => {
    // `previewClaudeRun(root, request, …)` — the cwd comes from main's project state, so a renderer
    // cannot aim a run at a directory the window is not showing. The third argument is capabilities
    // main supplies, never anything off the request; the next test pins what has to be in it.
    expect(main).toMatch(/previewClaudeRun\(root,\s*request(,|\))/);
    expect(main).toMatch(/const root = currentRoot\(\);/);
  });

  it("hands the preview a settings port, or the read disclosure quietly stops being effective", () => {
    // The second capability this composition root supplies, next to `nodeGit()`, and it fails more
    // quietly than that one. Resolving the settings cascade lives in the Agent SDK, which can start
    // processes, so `claude-preview.ts` takes it as a PORT to keep its "cannot spawn" import graph
    // (test/core/claude.test.ts). Drop this argument and nothing throws and no test in test/core/
    // notices: the dialog simply starts saying the settings were not consulted, and a user reading
    // "these are the directories this run can see" would be reading the app's intent rather than
    // the configuration a run actually gets. So the wiring is asserted where it lives.
    expect(main).toMatch(/previewClaudeRun\(root,\s*request,\s*\{\s*settings:\s*nodeSettings\(\)\s*\}\s*\)/);
  });

  it("derives the read disclosure in main — the renderer nominates no directory", () => {
    // The same rule as the scaffold's destination path, applied to the other half of the
    // confirmation. Every path, attribution and sentence in the read scope is built by
    // `read-scope.ts` from a resolution main performed; the components render `preview.read` and
    // compute nothing. A renderer that assembled its own list would be describing a run that is
    // not the run about to happen — which is what a confirmation exists to prevent.
    for (const file of ["src/renderer/src/components/read-scope.tsx", "src/renderer/src/components/session-pane.tsx"]) {
      const src = stripComments(read(file));
      expect(src, `${file} builds paths of its own`).not.toMatch(/\bpath\.(join|resolve|relative)\(/);
      // Rendering `read.sources[].permissions.additionalDirectories.length` is fine — that value
      // was resolved in main. Naming a settings FILE here would not be: it would mean the renderer
      // had decided where the configuration lives.
      expect(src, `${file} names a settings file of its own`).not.toMatch(/settings\.(local\.)?json|\.claude\//);
    }
    // And the scope reaches the components as one prop, rather than being reassembled from parts.
    expect(read("src/renderer/src/components/claude-run-dialog.tsx")).toMatch(/<ReadScope read=\{preview\.read\}/);
    // The pane header shows the SAME thing the confirmation does, through the same component and
    // off a scope main built — a second notion of "what this session can see" is the defect here.
    expect(read("src/renderer/src/components/session-pane.tsx")).toMatch(/<ReadScope read=\{session\.info\.read\}/);
  });

  it("drops outstanding preview tokens when the project changes", () => {
    // A token names the OUTGOING project's cwd. Left live, a modal open across a switch could
    // still spawn Claude against the repo the window has moved off.
    const announce = main.slice(main.indexOf("function announce("), main.indexOf("export function registerIpc"));
    expect(announce).toContain("clearInvocations()");
  });

  it("offers a Copy prompt identical to the prompt that would execute", async () => {
    // The sentence exists twice on purpose. /maestro-tasks' Copy prompt is the paste-into-your-own-
    // session path and lives in the renderer; the executable one is built in the main process,
    // because the renderer must never be the source of a prompt the app will run. The cost of that
    // is silent drift — a reworded Copy prompt would quietly stop matching what Run does, and a
    // user comparing the two would be looking at a lie. So the two are compared here rather than
    // deduplicated: this asserts the renderer's LITERAL against what the builder actually returns,
    // not against a third copy of the string.
    const literal = read("src/renderer/src/routes/maestro-tasks.tsx").match(/`(Use \/maestro[^`]*)`/);
    expect(literal, "no Use /maestro template literal in the route").not.toBeNull();

    const project = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-prompt-drift-"));
    try {
      const filename = "001-a-task.md";
      const tasksDir = path.join(project, ".claude", "maestro-tasks");
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(path.join(tasksDir, filename), "# A task\n");

      const relativePath = path.posix.join(".claude", "maestro-tasks", filename);
      const fromRenderer = literal![1].replace("${task.relativePath}", relativePath);
      // No CLI is needed: preview returns the prompt whether or not one was found.
      const { prompt } = await previewClaudeRun(project, { kind: "maestro-task", filename });

      expect(fromRenderer).toBe(prompt);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("keeps the paths from the app to the `claude` binary to a reviewed list", () => {
    // THE ACCEPTANCE CRITERION FOR THE WHOLE MERGE, asserted where it regresses silently.
    //
    // help-server shipped a second spawn path — `execFile("claude", ["-p", prompt, …])` in a
    // server function, per chat message, with no preview and no confirmation. Nothing failed when
    // it existed; the app simply ran prompts the user had not seen. The defence is structural:
    // `resolveClaudeCli` is the only thing in the app that produces a path to the CLI, so the list
    // of modules that call it IS the list of ways to reach `claude`, and it is short enough to read.
    // `(?<!function\s)` so the module that DECLARES it isn't counted as a caller of itself.
    //
    // It was one module until the Agent SDK arrived, and the second entry is a real widening rather
    // than a formality: `agent-sdk.ts` hands that path to a library that spawns it, where
    // `claude-preview.ts` provably cannot spawn at all (test/core/claude.test.ts walks its import
    // graph). `018` moved every run onto the SDK, and this list is the same two modules afterwards —
    // deliberately. `claude-run.ts` does NOT appear: it takes the binary off the invocation the
    // token names, so the run path resolves nothing and cannot resolve anything else. There is one
    // resolution per surface (preview reports availability; the SDK is handed a path), which is the
    // narrow state this list was asking for, not a third entry.
    const callers = sourcesUnder("src/core")
      .concat(sourcesUnder("src/main"))
      .filter((f) => /(?<!function\s)\bresolveClaudeCli\s*\(/.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(appRoot, f))
      .sort();
    expect(callers, "something unreviewed resolves the claude CLI").toEqual([
      "src/core/agent-sdk.ts", //       the Agent SDK — hands the path over, never a PATH lookup
      "src/core/claude-preview.ts", //  the `claude -p` bridge — cannot spawn
    ]);
  });

  it("spawns only from modules that claim a preview token, one purpose each", () => {
    // The other half: a module that can spawn but takes its command from a caller would be the
    // same hole with a different shape. Two modules run a PREVIEWED command, and each pins the
    // purpose its tokens must carry — so a usage-stats token cannot be spent as a Claude run, or
    // the reverse. The shared store makes that mix-up a one-line mistake without the check.
    const claimers = sourcesUnder("src/core")
      .filter((f) => /(?<!function\s)\bclaimInvocation\s*\(/.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(appRoot, f))
      .sort();
    expect(claimers).toEqual(["src/core/ccusage.ts", "src/core/claude-run.ts"]);
    expect(stripComments(read("src/core/claude-run.ts"))).toMatch(/claimInvocation\([^)]*,\s*"claude"\s*\)/);
    expect(stripComments(read("src/core/ccusage.ts"))).toMatch(/claimInvocation\([^)]*,\s*"usage-stats"\s*\)/);
  });

  it("pre-accepts edits nowhere in the app", () => {
    // The acceptance criterion of `018`, asserted where it would come back. `--permission-mode
    // acceptEdits` was in the authoring flags because a headless `claude -p` run had nobody to ask;
    // it granted writes to anything anywhere under the working directory, which for a marketplace
    // target is an entire repository. The replacement is `write-scope.ts` plus the session's
    // `canUseTool`. Re-adding the flag would look like a fix for a run that "cannot write its file"
    // and would silently undo the whole slice, so it is a diff to this line instead.
    const offenders = sourcesUnder("src")
      .filter((f) =>
        /acceptEdits|bypassPermissions|dangerouslySkipPermissions/.test(stripComments(fs.readFileSync(f, "utf8")))
      )
      .map((f) => path.relative(appRoot, f));
    expect(offenders, "an escalating permission mode is back in the app").toEqual([]);
  });

  it("bounds a session's writes by what the preview displayed, and offers it no shell", () => {
    // The three halves of the permission model, each of which fails silently on its own:
    //   • no `canUseTool` → the SDK falls back to the CLI's prompting, which in a headless run has
    //     nobody to answer it: every write simply does not happen and the run reports success.
    //   • a write scope derived anywhere but the invocation → the callback could be wider than the
    //     paths the user consented to, and nothing on screen would say so.
    //   • `Bash` back in the tool set → the one tool whose filesystem reach cannot be bounded by
    //     inspecting `tool_input`, which makes the path check above decorative.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    expect(sdk).toMatch(/canUseTool:/);
    expect(sdk).toMatch(/decideWrite\(/);
    expect(sdk).toMatch(/permissionMode:\s*"default"/);
    expect(sdk).toMatch(/spawnClaudeCodeProcess:\s*request\.spawn/);
    // Named as forbidden as well as omitted from the offered set — `tools` sets the base list,
    // `disallowedTools` removes them from the model's context whatever else would put them back.
    for (const tool of ["Bash", "Agent", "NotebookEdit"]) {
      expect(SESSION_DISALLOWED_TOOLS, `${tool} is no longer disallowed`).toContain(tool);
    }
    expect(SESSION_TOOLS, "the session offers a shell").not.toContain("Bash");
    expect(SESSION_TOOLS, "the session offers subagents").not.toContain("Agent");

    // And the scope comes off the invocation the token names, so a caller cannot widen it.
    const run = stripComments(read("src/core/claude-run.ts"));
    expect(run).toMatch(/writable:\s*inv\.writable/);
  });

  it("keeps the create-* guidance in one place, and hands every session a way to reach it", () => {
    // `026`. The four create-* prompts used to inline the instructions their matching SKILL.md
    // already carried; the prompt names the skill now instead. That makes three things load-bearing
    // that were previously decoration, and every one of them fails SILENTLY — the run still gets a
    // perfectly reasonable-looking prompt, just with the middle taken out of it:
    //
    //   • `Skill` missing from the tool set → the model cannot invoke what the prompt names;
    //   • `plugins` missing at the query → the name resolves to "Unknown skill" (measured in `019`,
    //     with nothing logged);
    //   • `pluginDir` dropped anywhere along preview → run → main → the same, from one line up.
    expect(SESSION_TOOLS, "a session cannot invoke the skill its prompt names").toContain("Skill");

    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    expect(sdk).toMatch(/skills:\s*request\.pluginDir\s*\?\s*\[\.\.\.SESSION_SKILLS\]\s*:\s*\[\]/);
    expect(sdk).toMatch(/plugins:\s*request\.pluginDir\s*\?\s*\[\{\s*type:\s*"local"/);

    const run = stripComments(read("src/core/claude-run.ts"));
    expect(run).toMatch(/pluginDir:\s*events\.pluginDir/);
    // The composition root, like `nodeGit()` and `nodeSettings()` beside it: only main knows where
    // the app's own files landed, and dropping this argument breaks nothing that throws.
    const ipc = stripComments(read("src/main/ipc.ts"));
    expect(ipc).toMatch(/pluginDir:\s*bundledPluginDir\(\)/);

    // And the names have to name something. A skill renamed or moved in the plugin leaves four
    // prompts pointing at nothing, which is a broken run and a green suite.
    const pluginSkills = path.resolve(appRoot, "../../plugins/maestro/skills");
    for (const skill of ["create-skill", "create-subagent", "create-plugin", "create-marketplace"]) {
      expect(fs.existsSync(path.join(pluginSkills, skill, "SKILL.md")), `${skill} has no SKILL.md`).toBe(true);
    }
  });

  it("loads no filesystem settings for a run, and discloses the same resolution", () => {
    // The trap `017` left standing. The session is configured entirely by this app, so nothing on
    // disk can widen it and no key in a settings file can redirect billing — and `resolveEffectiveSettings`,
    // which backs the read disclosure, must resolve the SAME cascade. Configure the run one way and
    // resolve the other and the dialog keeps describing a session that no longer exists, with
    // nothing failing.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    // Four: the startup smoke, the session a RUN is, the session the PANE is, and the resolution
    // both disclosures are built on. `019` added the fourth, and it carries a consequence of its
    // own — a pane session loads no CLAUDE.md, since the SDK needs `settingSources` to include
    // 'project' for that.
    const sessions = sdk.match(/settingSources:\s*\[\]/g) ?? [];
    expect(sessions.length, "a query or a resolution stopped passing an empty settingSources").toBe(4);
    expect(sdk).toMatch(/resolveSettings\(\{\s*cwd,\s*settingSources:\s*\[\]\s*\}\)/);
  });

  it("keeps the set of modules that can start a process to a reviewed list", () => {
    // Not a rule against subprocesses — the app legitimately runs `vibe-rules` and `git`. It is a
    // rule that the list is short enough to read, so that a new one arrives as a diff to this line
    // rather than as a `child_process` import nobody looked at.
    const spawners = sourcesUnder("src/core")
      .concat(sourcesUnder("src/main"))
      .filter((f) => /["'`](?:node:)?child_process["'`]/.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(appRoot, f))
      .sort();
    expect(spawners).toEqual([
      "src/core/ccusage.ts", //     usage stats — token-gated, previewed, version-pinned
      "src/core/claude-run.ts", //  the bridge — token-gated
      "src/core/discovery.ts", //   `vibe-rules list`
      "src/core/git.ts", //         `git init` + first commit for a new marketplace
      "src/core/install.ts", //     `git` during an install
      "src/core/rules.ts", //       `vibe-rules load`
    ]);
  });

  it("kills runs in flight when the app quits", () => {
    // The child is spawned detached so its process group can be signalled; the flip side is that
    // it outlives the app unless something kills it.
    expect(main).toMatch(/export function disposeIpc[\s\S]*disposeClaudeRuns\(\)/);
  });
});

describe("the create-* routes", () => {
  const routes = ["create-skill", "create-subagent", "create-plugin", "create-marketplace"] as const;
  const routeSrc = (name: string) => read(`src/renderer/src/routes/${name}.tsx`);

  it("are reachable from the app's navigation", () => {
    // The top-nav `Create` dropdown that used to hold these four is gone (the hamburger-menu
    // refactor removed it along with `Library`). Each route is reached instead from a `CreateLink`
    // at the bottom of the one /tools tab it belongs to — a route with no way in is still a route
    // nobody finds, just from a different component now.
    const tabFor: Record<(typeof routes)[number], string> = {
      // Skills and Agents moved off /tools onto their own pages — see routes/skills.tsx,
      // routes/agents.tsx. /agents' own "+ New agent" link sits at the foot of its LEFT PANE
      // rather than in the route file, so that is where this looks for it.
      "create-skill": "src/renderer/src/routes/skills.tsx",
      "create-subagent": "src/renderer/src/components/agents/agent-list.tsx",
      "create-plugin": "src/renderer/src/components/tabs/command-center.tsx",
      "create-marketplace": "src/renderer/src/components/tabs/marketplace.tsx",
    };
    for (const route of routes) {
      const src = read(tabFor[route]);
      expect(src, `no CreateLink to /${route}`).toContain(`"/${route}"`);
    }
  });

  it("reach a model only through the bridge, never through a spawn of their own", () => {
    // The acceptance criterion, asserted where it can regress. The renderer has no child_process to
    // reach for (the bundle test above), so what this actually guards is the OTHER way to lose the
    // confirmation: a route that called some future "just run it" channel instead of previewing.
    // `useCreateFlow` is the one place that touches `window.maestro.claude`, and it previews first.
    const flow = read("src/renderer/src/utils/create-flow.tsx");
    expect(flow).toContain("window.maestro.claude.preview(request)");
    expect(flow).toContain("ClaudeRunDialog");

    for (const route of routes) {
      const src = routeSrc(route);
      expect(src, `${route} talks to window.maestro.claude directly`).not.toMatch(/window\.maestro\.claude/);
      expect(src, `${route} builds an invocation`).not.toMatch(/claude\s+-p\b|--permission-mode|child_process/);
    }
  });

  it("send a request to the scaffold channel, never a destination path", () => {
    // Main resolves every path it writes from the open project plus a marketplace NAME. A preload
    // that forwarded a path would let a renderer aim a write anywhere on disk, and no test in
    // test/core/ can see this side of the wire.
    const preload = read("src/preload/index.ts");
    expect(preload).toMatch(/invoke\(IPC\.createScaffold,\s*request\s*\)/);
    expect(preload).not.toMatch(/createScaffold,\s*(path|dir|target|cwd)/);
  });

  it("hand the scaffold a git port, or a new marketplace quietly stops being a repository", () => {
    // The scaffold takes `git` as an OPTION, because importing the implementation would put
    // `child_process` in `claude-preview.ts`'s import graph and cost the "preview cannot spawn"
    // guarantee (test/core/claude.test.ts). The price of that is a capability which can go missing
    // without anything failing: no port means no repository, silently, and every test in
    // test/core/scaffold.test.ts that injects its own would still pass. So the wiring is pinned
    // where it lives — this line IS "creating a marketplace produces a git repository".
    expect(read("src/main/ipc.ts")).toMatch(/scaffoldCreate\([\s\S]{0,80}?\{\s*git:\s*nodeGit\(\)\s*\}\s*\)/);
  });

  it("ask git for nothing that has to work without it", () => {
    // Two decisions must hold on a machine with no `git` installed: whether the target already sits
    // inside a repository (the check that stops a marketplace nesting one), and what the
    // confirmation prompt says about it. Both go through `repo.ts`, which is `fs` only — a
    // `git rev-parse` here would answer about the process's cwd for a directory that does not exist
    // yet, and would answer nothing at all on the machine this criterion is about.
    // Comments stripped first — that module's own prose explains why it is not a `git rev-parse`.
    expect(stripComments(read("src/core/repo.ts"))).not.toMatch(/child_process|execFile|spawn/);
    for (const consumer of ["src/core/scaffold.ts", "src/core/claude-preview.ts"]) {
      expect(read(consumer), `${consumer} should read the repo state from repo.ts`).toContain("./repo.js");
    }
  });

  it("preview the same description the scaffold writes, from one implementation", () => {
    // `buildDesc` decides the `description:` frontmatter. The preview pane shows it before the file
    // exists and the node-side scaffold writes it — two copies means a preview that can lie. The
    // renderer's text module must therefore only RE-EXPORT.
    const text = read("src/renderer/src/utils/text.ts");
    expect(text).toContain("../../../core/text.js");
    expect(text).not.toMatch(/function\s+buildDesc/);

    const reimplemented = sourcesUnder("src/renderer")
      .filter((f) => /function\s+(buildDesc|clip|firstSentence|joinOxford)\b/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(appRoot, f));
    expect(reimplemented).toEqual([]);
  });
});

describe("the surface folded in from help-server", () => {
  const nav = read("src/renderer/src/components/top-nav.tsx");
  const hamburger = read("src/renderer/src/components/hamburger-menu.tsx");

  it("is reachable from the app's navigation", () => {
    // Same reason as the create-* routes above: a route with no way in is a route nobody finds.
    // These two live behind the hamburger menu now — the old `Library` dropdown (and `Create`
    // alongside it) is gone from top-nav entirely.
    for (const route of ["/tools", "/docs"]) expect(hamburger, `no nav entry for ${route}`).toContain(`"${route}"`);
  });

  it("leaves the project picker as the landing page", () => {
    // help-server's dashboard was ITS `/`. Landing it on this app's `/` would have replaced the
    // project picker with a view describing a project the user has not chosen yet.
    const landing = read("src/renderer/src/routes/index.tsx");
    expect(landing).toContain("useProject");
    expect(landing).not.toMatch(/CommandCenter|CuratedTools|ProjectMarketplace/);
  });

  it("keeps the runtime badge visible now that /maestro sits inside a menu", () => {
    // The badge is the one thing in the bar a user never goes looking for. Moving the link into
    // the hamburger menu is only acceptable because the dot moved onto the menu's own button —
    // `top-nav.tsx` computes it and hands it to `HamburgerMenu`, which renders the dot itself.
    expect(nav).toMatch(/<HamburgerMenu badge=\{badge\}\s*\/>/);
    expect(hamburger).toContain('badge !== "none"');
  });

  it("has no help chat left to run, and one conversational surface in its place", () => {
    // `019` DELETED the chat: its panel, its context, and the `{ kind: "help-chat" }` request kind.
    // Two conversational surfaces would have meant two transcripts and two consent models, and the
    // chat was strictly weaker — it had no session, so it re-sent a capped copy of its own history
    // as prompt text on every question. Asserted as an ABSENCE because a partial revival (the
    // request kind back without the panel, or the reverse) is exactly the shape a merge produces.
    const files = sourcesUnder("src").map((f) => path.relative(appRoot, f));
    expect(files).not.toContain("src/renderer/src/utils/chat-context.tsx");
    expect(files).not.toContain("src/renderer/src/components/chat-panel.tsx");

    const revivals = sourcesUnder("src")
      .filter((f) => /kind:\s*["']help-chat["']/.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(appRoot, f));
    expect(revivals, "the help-chat request kind is back").toEqual([]);

    // What it inherits: the help skill, by name rather than pasted into a prompt string. It is a
    // declared SESSION skill now, which is why `Skill` had to reach the pane's tool set — and, since
    // `026` deleted the create-* prompts' inlined guidance, the headless set below it too.
    // `maestro-help` is the one bundled with this repo's plugin — `super-help` stayed behind in
    // ai-dev-tools when Maestro was split into its own repo/marketplace.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    expect(PANE_SKILLS, "the help skill is no longer reachable").toContain("maestro-help");
    expect(PANE_TOOLS, "the pane cannot invoke a skill").toContain("Skill");
    expect(sdk).toMatch(/skills:\s*\[\.\.\.PANE_SKILLS\]/);
  });

  it("previews the usage-stats command before running it, and pins any network fetch", () => {
    // The other spawn help-server grew: `npx --yes ccusage@latest` on every view of its Stats tab,
    // downloading and executing a package from the network unannounced. The core half is covered
    // by test/core/ccusage.test.ts; this is the wiring the renderer can undo.
    const preload = read("src/preload/index.ts");
    expect(preload).toMatch(/invoke\(IPC\.statsPreview,\s*view\s*\)/);
    // The run channel takes the TOKEN. `view` rides along only to file the result — a preload
    // that forwarded an argv would let the renderer choose the binary.
    expect(preload).toMatch(/invoke\(IPC\.statsRun,\s*token,\s*view\s*\)/);
    expect(preload).not.toMatch(/statsRun,\s*(argv|bin|cmd)/);

    const tab = read("src/renderer/src/components/tabs/usage-stats.tsx");
    // The command is on screen next to the button that runs it, and a network fetch says so.
    expect(tab).toContain("preview.argv");
    expect(tab).toMatch(/preview\.pinnedVersion/);
    expect(tab).toMatch(/downloads ccusage/);
    // Nothing runs on mount: the effect previews, and only `run` reaches the run channel.
    const effect = tab.slice(tab.indexOf("useEffect(() => {"), tab.indexOf("const run ="));
    expect(effect).toContain("refreshPreview");
    expect(effect).not.toContain("runUsageStats");
  });

  it("reads the open project rather than a Docker mount or a precompute file", () => {
    // help-server's `utils/helpers.ts` pinned every path to `process.cwd()/../..` — the repo the
    // container was built around. Ported, those constants would silently read the DIRECTORY THE
    // APP WAS LAUNCHED FROM instead of the project the window is showing.
    for (const mod of ["plugins", "curated", "commands", "docs"] as const) {
      const src = stripComments(read(`src/core/${mod}.ts`));
      expect(src, `src/core/${mod}.ts resolves a path from the process cwd`).not.toMatch(/process\.cwd\(\)/);
      expect(src, `src/core/${mod}.ts reads a /tmp precompute file`).not.toMatch(/\/tmp\/|os\.tmpdir\(\)/);
    }
  });

  it("routes both new loaders through callMain", () => {
    // `data:doc` rejects on a missing or unreadable file, and `data:tools` / `data:docs` can still
    // reject on anything unforeseen. A loader that let one through hands TanStack an error
    // boundary carrying Electron's "Error invoking remote method" framing, which tells a user
    // nothing — the same failure `callMain` was written for.
    for (const route of ["tools", "docs.index", "docs.$group.$slug", "project-docs.index", "project-docs.$slug"]) {
      const src = read(`src/renderer/src/routes/${route}.tsx`);
      expect(src, `${route} does not use callMain`).toContain("callMain(");
      expect(src, `${route} awaits a channel directly`).not.toMatch(/await\s+window\.maestro\./);
    }
  });
});

describe("the session pane", () => {
  // The pane is the app's SECOND way to reach a model and the first one that holds a conversation.
  // Its guarantees are not the bridge's — there is no prompt to preview, because the user typed it
  // — so they are pinned separately here, and every one of them fails silently on its own.
  const ipc = read("src/main/ipc.ts");

  it("lets the pane send user-typed text and nothing else", () => {
    // THE INVARIANT, RESTATED. `claude:run` guarantees the only executable prompts are ones the
    // user was SHOWN, and it buys that by taking a token and no other argument. A session turn has
    // nothing to show — the user wrote it — so the guarantee becomes: the only prompts are ones the
    // user WROTE. That rests on two things a diff could quietly undo.
    //
    // 1. The preload forwards the session id and the text. A preload that "helpfully" attached a
    //    system prompt, a history array or a directory would make the renderer a prompt author.
    const preload = read("src/preload/index.ts");
    expect(preload).toMatch(/invoke\(IPC\.sessionSay,\s*id,\s*text\s*\)/);
    expect(preload).toMatch(/invoke\(IPC\.sessionStart\)/);
    expect(preload, "the renderer picks the session's directory").not.toMatch(/sessionStart,\s*\w/);

    // 2. The turn is stamped as human-authored at the SDK boundary. Claude Code treats an
    //    unattributed user message differently and checks that require a human-typed prompt reject
    //    it, so this is what makes the property enforceable rather than merely intended.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    expect(sdk).toMatch(/origin:\s*\{\s*kind:\s*"human"\s*\}/);

    // And exactly one module in the renderer may reach the session channels, so there is no second
    // composer to review. The pane is a view of it — the same rule the chat panel had.
    const callers = sourcesUnder("src/renderer")
      .filter((f) => /window\.maestro\.session\./.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(appRoot, f));
    expect(callers).toEqual(["src/renderer/src/utils/session-context.tsx"]);
    expect(stripComments(read("src/renderer/src/components/session-pane.tsx"))).not.toMatch(/window\.maestro/);
  });

  it("grows the pane's write scope only from a claimed preview token, and never from the renderer", () => {
    // `022` REPLACED THE LITERAL, NOT THE PROPERTY. The pane's write scope used to be `writable: []`
    // at the call site — unwidenable because there was nothing to widen it with. It is a function
    // now, for the reason `023` made `readable()` one: a form submitted mid-session has to reach the
    // live callback rather than the list that existed when the pane opened. What replaces the
    // literal's guarantee is the SOURCE of that list, and every assertion here is one hop of it.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    const pane = sdk.slice(sdk.indexOf("export function startPaneSession"));

    // Still one engine, still handed the scope rather than deciding it.
    expect(pane).toMatch(/decidePaneCall\(\{\s*tool,\s*input,\s*writable:\s*writable\(\),/);
    expect(stripComments(read("src/core/session-permission.ts"))).toMatch(
      /decideWrite\(\{ tool, input, writable, cwd \}\)/
    );
    expect(pane, "the pane grew its own permission engine").not.toMatch(/behavior:\s*"deny"/);
    // Read fresh per call. A captured copy is the `023` failure applied to writes: the header and
    // the boundary go on answering different questions and nothing fails.
    expect(pane).toMatch(/const writable = \(\): string\[\] => \[\.\.\.writes\]/);

    // The accumulator has exactly one entry point, and it is not reachable from the renderer.
    const session = stripComments(read("src/main/claude-session.ts"));
    const callers = sourcesUnder("src")
      .filter((f) => /\.allowWrites\(/.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(appRoot, f));
    expect(callers).toEqual(["src/main/claude-session.ts"]);
    // …and that caller reaches it only after claiming a token, which is what makes the directory
    // the one the confirmation displayed rather than one a caller chose.
    const handoff = session.slice(session.indexOf("export async function handoffToSession"));
    expect(handoff).toMatch(/claimInvocation\(token, "claude"\)/);
    expect(handoff).toMatch(/allowWrites\(\[handoff\.writeScope\]\)/);
    expect(handoff, "a preview with no artifact must not open anything").toMatch(/if \(!handoff\)/);

    // Nothing on the wire names a writable path: the handoff channel carries a TOKEN, exactly as
    // `claude:run` does, so a renderer can no more nominate a directory than it can a prompt.
    // Comments stripped first: the channel is now DOCUMENTED as the one that widens the write
    // scope, and the property being pinned is the shape of the wire, not the absence of the word.
    const shared = stripComments(read("src/shared/ipc.ts"));
    const api = shared.slice(shared.indexOf("  session: {"), shared.indexOf("  stats: {"));
    expect(api).toMatch(/handoff\(token: string\)/);
    expect(api).not.toMatch(/writable|writeable|addDirector/i);
    const preload = read("src/preload/index.ts");
    expect(preload).toMatch(/invoke\(IPC\.sessionHandoff, token\)/);
    expect(preload, "the renderer picks what the session may write").not.toMatch(/sessionHandoff,\s*token,/);
  });

  it("seeds a handoff's context without spending a turn, and says so in the transcript", () => {
    // THE WHOLE POINT OF THE SEED IS WHAT IT DOES NOT DO. `shouldQuery: false` appends the context
    // and starts nothing; drop it and every create-* handoff silently spends a model call the user
    // did not ask for, with nothing on screen distinguishing it from one they did.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    expect(sdk).toMatch(/shouldQuery: false/);
    // And it is NOT stamped as a person's words. `origin: { kind: "human" }` belongs to `say` and to
    // nothing else — a seeded message wearing it would defeat the one check that makes "the user
    // writes the prompts" enforceable at the SDK boundary.
    const context = sdk.slice(sdk.indexOf("function contextTurn"), sdk.indexOf("function contextTurn") + 800);
    expect(context).not.toMatch(/origin/);

    // AND THE RECEIPT IT PRODUCES IS NOT A TURN. Measured in the window: a `shouldQuery: false`
    // append is answered with its own `result` message — success, `total_cost_usd: 0`, no assistant
    // text — and reporting it as a turn both claims something happened and clears the renderer's
    // `busy`, which can take the Stop button away from a turn that is still running.
    expect(sdk).toMatch(/if \(awaitingTurns > 0\) awaitingTurns--;/);
    expect(sdk).toMatch(/else if \(spent === 0 \|\| spent === null\) continue;/);

    // What the model was given is what the transcript shows — one string, built once.
    const session = stripComments(read("src/main/claude-session.ts"));
    expect(session).toMatch(/const seed = handoffSeed\(handoff, invocation\.prompt\)/);
    expect(session).toMatch(/entry\.session\.seed\(seed\)/);
    expect(session).toMatch(/kind: "context"[\s\S]{0,120}text: seed/);
    // The addition itself is announced inline, beside it.
    expect(session).toMatch(/handoffNotice\(handoff\)/);
  });

  it("bounds what a live session may READ with a hook, not with the write callback", () => {
    // The obvious wrong turn, asserted so it stays wrong. `decideWrite` returns `allow` for
    // Read/Glob/Grep WITHOUT LOOKING AT THE PATH, deliberately — reads are auto-approved by the
    // permission system and never reach `canUseTool` at all, which is why `read-scope.ts` exists to
    // disclose them. The only place a read can be stopped is a `PreToolUse` hook, which fires for
    // every tool call before the permission flow.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    expect(sdk).toMatch(/PreToolUse:\s*\[/);
    expect(sdk).toMatch(/decideBoundary\(/);
    // `020` turned the refusal into a ROUTE. `"ask"` is what makes an out-of-scope read reach
    // `canUseTool` at all — reads are auto-approved and never prompt on their own — so a diff that
    // put `"deny"` back would not fail a type check and would silently delete the prompt.
    expect(sdk).toMatch(/permissionDecision:\s*"ask"/);
    // The one surviving hook DENY, and it needs its own transcript entry: hook denials are not
    // reported through `SDKPermissionDeniedMessage`, so a call refused here and not written down
    // vanishes entirely. It is the uncheckable case — a bounded tool that named no path, where
    // there is nothing for a person to authorise.
    const paneOnly = sdk.slice(sdk.indexOf("export function startPaneSession"));
    const hook = paneOnly.slice(paneOnly.indexOf("PreToolUse:"), paneOnly.indexOf("canUseTool:"));
    expect(hook).toMatch(/permissionDecision:\s*"deny"/);
    expect(hook).toMatch(/source:\s*"read-boundary"/);
    // The boundary and the disclosure are ONE list. Two would let the header describe a session
    // that can see more (or less) than the hook allows, with nothing failing.
    expect(sdk).toMatch(/additionalDirectories:\s*\[\.\.\.request\.additionalDirectories\]/);

    // And no path check was smuggled into the write decision, where it would look like the fix.
    const write = stripComments(read("src/core/write-scope.ts"));
    const readBranch = write.slice(write.indexOf("export function decideWrite"), write.indexOf("if (!(WRITE_TOOLS"));
    expect(readBranch).toMatch(/READ_ONLY_TOOLS[\s\S]*return \{ behavior: "allow" \}/);
  });

  it("asks a person instead of deciding, and resolves every ask on every exit", () => {
    // THE WEDGE. `canUseTool` returns a promise; when the answer has to come from a user, that
    // promise is PARKED. Permission prompts do not time out — there is no backstop anywhere below
    // this — so an ask left outstanding is a session that never ends, holding a detached `claude`
    // against the user's repository. Every exit therefore resolves what it holds, denying it.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    const pane = sdk.slice(sdk.indexOf("export function startPaneSession"));
    expect(pane).toMatch(/createPermissionRegistry\(\)/);

    // Two exits, and they are NOT the same moment: `close()` runs the instant the window goes away,
    // while `finish` waits for the SDK's stream to end — which it cannot do while a `canUseTool`
    // promise is still parked. Denying in `close` is what unblocks the other one.
    const closeFn = pane.slice(pane.indexOf("close(): void"));
    expect(closeFn, "closing a window leaves a parked permission request wedging the session").toMatch(
      /releasePermissions\(/
    );
    expect(pane.slice(pane.indexOf("const finish =")), "a session that ends on its own leaves asks parked").toMatch(
      /releasePermissions\(/
    );

    // And the three teardown paths that reach `close()` are already pinned by the test below; what
    // this adds is that each of them ANSWERS rather than merely killing the child.
    const session = stripComments(read("src/main/claude-session.ts"));
    expect(session).toMatch(/entry\.session\.close\(\)/);
  });

  it("lets the renderer send a permission CHOICE and never a permission result", () => {
    // The dangerous field is `updatedPermissions` on the SDK's allow shape: `addRules`, `setMode`
    // and `addDirectories`, each with a destination that can be `localSettings`, `projectSettings`
    // or `userSettings`. One accepted update can grant blanket allow rules, flip the session to
    // `bypassPermissions`, or widen the read scope permanently and machine-wide — written into the
    // user's own repository or home directory. So the wire carries three words plus a reason, and
    // the main process constructs the answer. Same shape as the preview token: a decision crosses,
    // never a payload.
    const preload = stripComments(read("src/preload/index.ts"));
    expect(preload).toMatch(/invoke\(IPC\.sessionPermission,\s*id,\s*requestId,\s*choice\)/);

    const renderer = sourcesUnder("src/renderer")
      .map((f) => stripComments(fs.readFileSync(f, "utf8")))
      .join("\n");
    expect(renderer, "the renderer can author a permission update").not.toMatch(
      // `setMode` deliberately absent: it is also an ordinary React setter name here. The three
      // below are the SDK's own, and none of them has an innocent meaning in a renderer.
      /updatedPermissions|addDirectories|permissionMode/
    );
    expect(renderer, "the renderer builds an SDK permission result rather than a choice").not.toMatch(
      /behavior:\s*"(allow|deny)"/
    );

    // A denial's message is the ONE channel for steering the model — it reads the refusal and
    // adapts — so an empty one is a wasted turn. Both halves are asserted: the UI substitutes a
    // real sentence, and main substitutes one again in case it ever does not.
    const pane = stripComments(read("src/renderer/src/components/session-pane.tsx"));
    expect(pane).toMatch(/DEFAULT_DENY_REASON/);
    expect(stripComments(read("src/main/claude-session.ts"))).toMatch(/permissionReason\(/);

    // ── `023` widened this block rather than writing a second one ────────────
    // A session grant is the first thing in this app that puts a value in `updatedPermissions` at
    // all, so the assertions above stopped being "nobody authors one" and became "only MAIN does,
    // and only one shape of one". The four below are what that costs.

    // 1. THE RENDERER SENDS A SCOPE WORD, NEVER A PATH. `PermissionChoice`'s grant arm carries
    //    `file` or `directory`; main resolves it against the prompt IT asked. A renderer that could
    //    name a directory here would be authoring the grant rather than answering the question —
    //    the same defect as `create:scaffold` taking a destination path.
    const choice = read("src/core/contracts.ts");
    const grantArm = choice.slice(choice.indexOf("export type PermissionChoice"));
    const grantMember = grantArm.slice(grantArm.indexOf('choice: "grant"'), grantArm.indexOf("};"));
    expect(grantMember, "the renderer can nominate a directory on a grant").not.toMatch(/path|director(y|ies)/i);

    // 2. THE UPDATE IS TYPED SO NARROWLY IT CANNOT REACH DISK. The SDK's own `PermissionUpdate`
    //    also carries `addRules`, `setMode` (including `bypassPermissions`) and four destinations,
    //    three of which write — to the user's repository, their machine-local project settings, or
    //    their home directory. `SessionPermissionUpdate` is the app's whole vocabulary for this.
    const update = choice.slice(choice.indexOf("export interface SessionPermissionUpdate"));
    const body = update.slice(0, update.indexOf("}"));
    expect(body).toMatch(/type:\s*"addDirectories"/);
    expect(body).toMatch(/destination:\s*"session"/);
    expect(body, "a grant gained a destination that writes to disk").not.toMatch(
      /userSettings|projectSettings|localSettings|cliArg/
    );
    expect(body, "the app's permission update can express a rule or a mode").not.toMatch(/addRules|setMode|behavior/);

    // 3. NO OTHER DESTINATION EXISTS ANYWHERE UNDER src/. The type above is the enforcement, but a
    //    literal cast or a second update built by hand would slip past it, and the failure writes a
    //    permission rule into a file the user did not open this app to edit.
    const everywhere = sourcesUnder("src")
      .map((f) => stripComments(fs.readFileSync(f, "utf8")))
      .join("\n");
    expect(everywhere, "something authors a permission update that lands on disk").not.toMatch(
      /destination:\s*"(userSettings|projectSettings|localSettings|cliArg)"/
    );
    expect(everywhere, "a session grant is written somewhere it can outlive the session").not.toMatch(
      /type:\s*"(addRules|replaceRules|removeRules|setMode)"/
    );

    // 4. A GRANT REACHES BOTH HALVES, OR THE HEADER AND THE BOUNDARY DISAGREE. `updatedPermissions`
    //    only tells the CLI's permission system to stop prompting; the `PreToolUse` hook runs FIRST
    //    and would go on routing the same path into a prompt forever. So main widens the hook's list
    //    and then answers, and the pane re-derives its disclosure from the widened list.
    const session = stripComments(read("src/main/claude-session.ts"));
    const grantFn = session.slice(
      session.indexOf("async function grantAndAllow"),
      session.indexOf("export async function revokeGrant")
    );
    expect(grantFn, "a grant widens the SDK's scope but not the app's own boundary").toMatch(/session\.grant\(/);
    expect(grantFn).toMatch(/updatedPermissions:/);
    expect(grantFn, "the header goes on describing a scope that has moved").toMatch(/announceScope\(/);
    // And the boundary is read fresh on every call, not captured when the session started.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    const paneSession = sdk.slice(sdk.indexOf("export function startPaneSession"));
    expect(paneSession).toMatch(/directories:\s*readable\(\)/);
    expect(paneSession, "the readable set is captured once and can no longer move").not.toMatch(
      /directories:\s*readable,/
    );
  });

  it("lets the renderer send a question SELECTION and never the answer payload", () => {
    // THE ONE CARVE-OUT IN "A DECISION CROSSES, NEVER A PAYLOAD". A question's answer IS a payload:
    // it rides back on `updatedInput`, the tool's own input with the user's choices written into it,
    // which is the field every other surface in this app refuses to expose. `021` made the carve-out
    // checkable instead of trusted, and these are the hops of it.

    // 1. THE WIRE CARRIES A SELECTION. Its own channel, not a fifth arm of `PermissionChoice`: the
    //    two asks share a registry and nothing else.
    const preload = stripComments(read("src/preload/index.ts"));
    expect(preload).toMatch(/invoke\(IPC\.sessionQuestion,\s*id,\s*requestId,\s*choice\)/);

    // 2. `QuestionChoice` CANNOT EXPRESS AN ANSWER. Both arms are pinned rather than the absence of
    //    a third: an arm carrying a map keyed by question text would be the payload arriving whole.
    const contracts = read("src/core/contracts.ts");
    const wire = contracts.slice(contracts.indexOf("export type QuestionChoice"));
    const arms = wire.slice(0, wire.indexOf(";\n"));
    expect(arms).toMatch(/choice:\s*"answer";\s*selections:\s*QuestionSelection\[\]/);
    expect(arms).toMatch(/choice:\s*"reply";\s*text:\s*string/);
    expect(arms, "the renderer can send the answer payload itself").not.toMatch(/answers|updatedInput|Record</);
    // …and a selection names its question by INDEX and its options by the labels it was shown,
    // exactly as a grant names a scope word and not a path.
    const selection = contracts.slice(contracts.indexOf("export interface QuestionSelection"));
    expect(selection.slice(0, selection.indexOf("}"))).toMatch(/question:\s*number;[\s\S]*labels:\s*string\[\]/);

    // 3. NOTHING IN THE RENDERER AUTHORS ONE. Same assertion the permission block makes about
    //    `updatedPermissions`, for the field that is this slice's equivalent.
    const renderer = sourcesUnder("src/renderer")
      .map((f) => stripComments(fs.readFileSync(f, "utf8")))
      .join("\n");
    expect(renderer, "the renderer can author the tool input a question is answered with").not.toMatch(
      /updatedInput|answers:/
    );

    // 4. THE PAYLOAD IS BUILT IN EXACTLY ONE PLACE, and it is the one holding the call the SDK
    //    delivered. Validating in main instead would check the labels against a copy that had
    //    already crossed two process boundaries.
    const authors = sourcesUnder("src")
      .filter((f) => /updatedInput/.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(appRoot, f));
    // Two files may name the field at all: `contracts.ts` declares the shape, `agent-sdk.ts` fills
    // it in. Nothing between them — and nothing above them — gets to touch it.
    expect(authors).toEqual(["src/core/agent-sdk.ts", "src/core/contracts.ts"]);
    const mainSession = stripComments(read("src/main/claude-session.ts"));
    expect(mainSession, "main rebuilds the answer instead of forwarding the selection").not.toMatch(
      /answers|updatedInput/
    );
    expect(mainSession).toMatch(/entry\.session\.answerQuestion\(String\(requestId \?\? ""\), choice\)/);

    // 5. AND IT VALIDATES BEFORE IT ANSWERS. `answerQuestions` refuses a label that was not among
    //    the options offered — asserted directly in `test/core/session-question.test.ts` — so the
    //    order here is the whole guarantee: nothing is resolved until the check has run.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    // `lastIndexOf`: the same signature appears on the `PaneSession` interface above, and an
    // interface has no body to check the order of.
    const answerFn = sdk.slice(sdk.lastIndexOf("answerQuestion(requestId: string"));
    const body = answerFn.slice(0, answerFn.indexOf("allowWrites"));
    expect(body).toMatch(/answerQuestions\(parked\.questions,\s*choice\)/);
    expect(body.indexOf("answerQuestions("), "the answer is sent before the labels are checked").toBeLessThan(
      body.indexOf("permissions.answer(")
    );
    expect(body, "a rejected selection is answered anyway").toMatch(/if \(!resolution\.ok\) return/);

    // 6. THE TWO MECHANICAL PRECONDITIONS, neither of which existed before `021`: the tool has to be
    //    offered, and previews have to be asked for. Without the second, Claude emits no preview on
    //    any option and the list arrives bare — which looks like a rendering bug and is not one.
    expect(sdk).toMatch(/export const PANE_TOOLS = \[\.\.\.SESSION_TOOLS, QUESTION_TOOL\]/);
    expect(sdk).toMatch(/toolConfig:\s*\{\s*askUserQuestion:\s*\{\s*previewFormat:\s*QUESTION_PREVIEW_FORMAT\s*\}/);
    const pane = sdk.slice(sdk.indexOf("export function startPaneSession"));
    // `allowedTools` would auto-approve the tool, and the SDK would then answer the question itself.
    expect(pane, "a question routed through allowedTools is answered by the SDK, not by the user").not.toMatch(
      // Not `disallowedTools`, which contains it and is the option that IS passed.
      /(?<!dis)allowedTools:/
    );

    // 7. ONE REGISTRY, so teardown drains a question exactly as it drains a permission request. A
    //    second one beside it is a second thing to remember to drain, and the forgotten one wedges
    //    the session just as hard — which is the "dismissing the pane resolves it" criterion.
    expect(pane.match(/createPermissionRegistry\(\)/g) ?? []).toHaveLength(1);
    expect(pane).toMatch(/if \(tool === QUESTION_TOOL\) return askQuestion\(input, options\)/);
  });

  it("lets a grant die with the session, and writes it nowhere", () => {
    // THE THIRD PROPERTY, inherited from the chat's confirmation opt-out: it defaults to asking, it
    // DIES WITH THE SESSION, and it is visible and revocable from the header. The first is the
    // prompt's existence and the third is a control; this one is an absence, which is the kind that
    // regresses without anything failing.
    //
    // Both places a grant is held are in-memory and window-scoped: a closure inside
    // `startPaneSession`, and the `LiveSession` entry keyed by `webContents.id` that every teardown
    // path already deletes. Neither module may acquire a way to persist one.
    const session = stripComments(read("src/main/claude-session.ts"));
    expect(session, "the session owner learned to write files").not.toMatch(/node:fs|writeFile|readFile/);
    expect(session).toMatch(/grants:\s*SessionGrant\[\]/);
    // The grant list lives on the per-window entry, which `endSession` deletes outright — so there
    // is nothing to clear separately and nothing that could survive into the next session.
    expect(session).toMatch(/sessions\.delete\(webContentsId\)/);

    // Revoking narrows and can do nothing else: it removes an entry main is already holding, which
    // is why a PATH is allowed to cross the wire here while granting sends only a scope word.
    expect(session).toMatch(/entry\.grants\.findIndex/);
    const preload = stripComments(read("src/preload/index.ts"));
    expect(preload).toMatch(/invoke\(IPC\.sessionRevoke,\s*id,\s*path\)/);
  });

  it("writes down a refusal whichever of the four routes it arrived by", () => {
    // Four components can refuse a call, and they reach the transcript by routes that share no
    // code. Two of them are easy to build only one of: the SDK's `permission_denied` event reports
    // deny RULES and MODE denials and EXPLICITLY does not report hook denials, so the hook layer
    // owns its own entry or an out-of-scope call vanishes silently — which is the worse half,
    // because the gap stays invisible until someone wonders why a tool did nothing.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    // The auto-denial is READ in the message loop and MAPPED in the pure module, so the branch that
    // needs an administrator policy file to provoke is reachable from a test (`autoRefusal`).
    expect(sdk).toMatch(/subtype === "permission_denied"/);
    expect(sdk).toMatch(/emit\(autoRefusal\(message\)\)/);

    const permission = stripComments(read("src/core/session-permission.ts"));
    const both = sdk + permission;
    for (const source of ['"write-scope"', '"read-boundary"', '"user"', '"auto"']) {
      expect(both, `no refusal is ever attributed to ${source}`).toContain(`source: ${source}`);
    }
  });

  it("watches the other doors into the read scope, and does not follow any of them", () => {
    // A permission prompt is not the only thing that can move what a session sees. A directory
    // added to the CLI's OWN working roots and the working directory moving are both invisible to
    // `canUseTool`, and neither widens this app's boundary — so the failure is not an open door,
    // it is a silent DISAGREEMENT between the header and the hook, which is the one shape of this
    // bug nobody can diagnose from the outside.
    //
    // Both handlers are currently unreachable from the pane, measured in the window: `/add-dir`
    // answers "isn't available in this environment" in an SDK session, and nothing here moves the
    // cwd. They are pinned anyway — the point of a handler for something that cannot happen yet is
    // that the first time it can, it is not silent.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    const pane = sdk.slice(sdk.indexOf("export function startPaneSession"));
    expect(pane, "a directory added to the CLI's own roots would pass unremarked").toMatch(/DirectoryAdded:\s*\[/);
    expect(pane, "the working directory could move with nothing said").toMatch(/CwdChanged:\s*\[/);

    // And the boundary stays ANCHORED. `decideBoundary` resolves relative paths against a cwd; if
    // that cwd followed the session's, a `..` target would quietly mean somewhere else.
    const hook = pane.slice(pane.indexOf("PreToolUse:"), pane.indexOf("canUseTool:"));
    expect(hook).toMatch(/cwd:\s*request\.cwd/);
    expect(hook, "the boundary follows the working directory instead of anchoring it").not.toMatch(
      /cwd:\s*(?!request\.cwd)\w/
    );
  });

  it("stops a session at a spend ceiling and gives the ending a door", () => {
    // `024`. THE NAIVE VERSION OF THIS FEATURE DEFEATS ITSELF: reaching the ceiling ends the query,
    // which on a conversation ends the conversation — so a user who loses a transcript to it raises
    // the ceiling until it never fires, and the control stops being one. Every assertion here is one
    // half of the pair that makes a low ceiling survivable, and each of them fails silently: a
    // ceiling with no reason on the ending reads as a crash, and a crash with no transcript to
    // resume is a feature nobody will leave switched on.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    const pane = sdk.slice(sdk.indexOf("export function startPaneSession"));

    // The three limits, and they are three different mechanisms. Dropping `taskBudget` costs the
    // model its chance to wrap up; dropping `maxTurns` leaves a cheap non-converging loop running
    // under the dollar ceiling for as long as it likes.
    expect(pane).toMatch(/maxBudgetUsd: policy\.maxBudgetUsd/);
    expect(pane).toMatch(/maxTurns: policy\.maxTurns/);
    expect(pane).toMatch(/taskBudget: \{ total: policy\.pacingTokens \}/);
    // The transcript has to outlive the query or Continue has nothing to resume. Passed explicitly
    // rather than left to the SDK default, because a diff that turned it off would break the door
    // while every test still passed.
    expect(pane).toMatch(/persistSession: true/);
    expect(pane).toMatch(/resume: request\.resume/);

    // THE LATCH, and THE EXIT — two assertions because the ceiling arrives in two shapes and only
    // one of them ends the stream. A one-shot query throws right after the `error_max_budget_usd`
    // result (the child exits non-zero), so the reason has to be recorded before the catch or a
    // resumable conversation is rendered as a crash. A STREAMING-INPUT query, which is what the pane
    // is, does not tear down at all: measured in a window, the pump stays open and the CLI answers
    // 12 further turns with error results inside 1.6 seconds, none of them reaching the model. So
    // the read loop must LEAVE on a ceiling rather than wait for an end that never comes — without
    // the break the composer stays enabled and the ceiling is decoration.
    expect(pane).toMatch(/const ceiling = ceilingOf\(message\.subtype\);/);
    expect(pane).toMatch(/ceilingHit = ceiling;\s*break;/);
    expect(pane).toMatch(/if \(ceilingHit\) return finish\(null, ceilingHit\);/);
    // And the child is released on the way out, which the stream's own end would have done for us.
    expect(pane).toMatch(/if \(ceilingHit\) \{\s*try \{\s*query\?\.close\(\);/);
    // And the door is opened by the REASON, never by the error string.
    expect(pane).toMatch(/canContinue: ceiling && cliSessionId !== null/);

    // The running figure is fed from the same guard that decides a result was a turn at all — the
    // `022` lesson, which a second accumulator would quietly undo by counting a zero-cost append.
    const result = pane.slice(pane.indexOf("const spent = message.total_cost_usd"));
    expect(result.indexOf("spend = accrueTurn(spend, spent)")).toBeGreaterThan(
      result.indexOf("else if (spent === 0 || spent === null) continue;")
    );

    // Main keeps the exhausted entry — it IS what Continue resumes from — and only for a ceiling.
    const session = stripComments(read("src/main/claude-session.ts"));
    const cont = session.slice(session.indexOf("export async function continueSession"));
    // The allowance is the app's own policy — `sessionBudget()` is `paneBudget()` with only the
    // launching process's environment able to lower it, so no caller can ask for a bigger one.
    expect(cont).toMatch(/renewAllowance\(entry\.spend, sessionBudget\(\)\)/);
    expect(cont).toMatch(/resume: entry\.resumeId/);
    expect(cont, "a session that failed is not one that ran out of allowance").toMatch(/if \(!entry\.endReason/);
    expect(session).toMatch(/const continuable = \(end\.reason === "budget" \|\| end\.reason === "turns"\)/);
    expect(session).toMatch(/if \(!continuable\) sessions\.delete\(webContentsId\)/);
    // One builder for every session there is, so a resumed one cannot end up with a different tool
    // set, a different boundary or a different ceiling than the one it is continuing.
    expect((session.match(/startPaneSession\(\{/g) ?? []).length).toBe(1);

    // The wire carries the session id and nothing else — the same discipline as `claude:run`'s
    // token. An allowance or a transcript id crossing here is the only hole this channel could have.
    const preload = read("src/preload/index.ts");
    expect(preload).toMatch(/invoke\(IPC\.sessionContinue, id\)/);
    expect(preload, "the renderer picks what a continuation inherits").not.toMatch(/sessionContinue, id,/);

    // The figure is an ESTIMATE wherever it is rendered, and the pane says so in the markup rather
    // than in a comment: a number the user reconciles against a bill will not match.
    const paneUi = read("src/renderer/src/components/session-pane.tsx");
    expect(paneUi).toMatch(/data-testid="session-spend"/);
    expect(paneUi).toMatch(/estimate, not a bill/);
    expect(paneUi).toMatch(/data-testid="session-continue"/);
    // Typing into an exhausted session would silently start a DIFFERENT conversation, which looks
    // identical and has none of the transcript in front of the model.
    expect(paneUi).toMatch(/const exhausted = Boolean\(session\.info\?\.canContinue\)/);
  });

  it("changes effort and model on a live session, from lists main published", () => {
    // The two header levers, and the reason they are levers at all: both apply to a RUNNING session
    // without touching the conversation. What is pinned here is the same property the permission
    // wire has — the renderer chooses from something this process produced and cannot name its own.
    const session = stripComments(read("src/main/claude-session.ts"));
    expect(session).toMatch(/isEffortLevel\(effort\)/);
    expect(session).toMatch(/entry\.models\.some\(\(m\) => m\.id === model\)/);

    const preload = read("src/preload/index.ts");
    expect(preload).toMatch(/invoke\(IPC\.sessionEffort, id, effort\)/);
    expect(preload).toMatch(/invoke\(IPC\.sessionModel, id, model\)/);

    // A model that refuses a pacing budget answers EVERY turn with a 400 and does no work — measured
    // on Haiku 4.5, and nothing in the model list advertises it. The recovery reopens without the
    // budget; what it must not do is widen anything, so the hard ceiling is unchanged.
    expect(session).toMatch(/onPacingRejected: \(\) => void reopenWithoutPacing/);
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    expect(sdk).toMatch(/request\.pacing === false \? \{\} : \{ taskBudget/);
  });

  it("picks up a foreign conversation only from a list main published, and forks when it does", () => {
    // `025`. THE ONE PLACE ON THIS SURFACE WHERE AN ID NAMES SOMETHING MAIN HAS NO RECORD OF.
    // `session:continue` takes an id too, but that id is a key into main's own `LiveSession`; here
    // it names a file in the CLI's session store, so "the renderer cannot nominate a directory"
    // becomes "the renderer cannot nominate a transcript" — and that is a check rather than a
    // resolution. Every assertion below is one hop of it, and all of them fail silently.
    const session = stripComments(read("src/main/claude-session.ts"));

    // 1. The id must be one THIS WINDOW was offered. Without this the channel accepts any session id
    //    on the machine, and the cwd filter that keeps other projects out is bypassed entirely.
    const byId = session.slice(session.indexOf("async function resumableById"));
    expect(byId).toMatch(/offered\.get\(webContentsId\)\?\.has\(id\)/);
    // …and the row is re-read from the store rather than trusted, so a deleted transcript is a
    // refusal instead of a session started against nothing.
    expect(byId).toMatch(/resumableFrom\(await listStoredSessions\(projectRoot\)/);

    // 2. It FORKS. `024`'s Continue deliberately resumes in place — same conversation, one allowance
    //    later — and doing that to a session the user started in their terminal would write this
    //    pane's turns into the history of a session the app was never given. Measured (`025`): with
    //    the flag, the source transcript is byte-identical afterwards and the fork lands under a new
    //    id in the resuming project's directory.
    const resume = session.slice(
      session.indexOf("export async function resumeSession"),
      session.indexOf("async function resumableById")
    );
    expect(resume).toMatch(/openSession\(webContentsId, projectRoot, \{ resume: session\.id, fork: true \}\)/);
    // 3. …and it carries NOTHING ELSE. No grants (they die with an entry and are written nowhere, so
    //    there is nothing on disk to restore), no write scope (that answers a form THIS user
    //    submitted), and no spend (the other conversation was never measured against this ceiling).
    expect(resume, "a resumed session must start with no grants").not.toMatch(/grants:/);
    expect(resume, "a resumed session must start with nothing writable").not.toMatch(/writes:/);

    // 4. The fork reaches the SDK only WITH a resume, and the two callers that resume this app's own
    //    conversation must not set it — a Continue that forked would split one conversation into two
    //    records of itself.
    const sdk = stripComments(read("src/core/agent-sdk.ts"));
    const pane = sdk.slice(sdk.indexOf("export function startPaneSession"));
    expect(pane).toMatch(/request\.resume && request\.fork \? \{ forkSession: true \} : \{\}/);
    const cont = session.slice(session.indexOf("export async function continueSession"));
    expect(cont, "a Continue must resume in place").not.toMatch(/fork: true/);
    const reopen = session.slice(
      session.indexOf("async function reopenWithoutPacing"),
      session.indexOf("export async function continueSession")
    );
    expect(reopen, "the pacing reopen must resume in place").not.toMatch(/fork: true/);

    // 5. The store is read through the SDK, never walked. `~/.claude/projects/<slug>/` is a private
    //    layout with a lossy slug encoding and its own summary-extraction rule; re-deriving it here
    //    would be the `ccusage` mistake — a second reader of someone else's format, drifting in
    //    silence. So the two readers live in the app's only SDK importer, and nowhere else.
    expect(sdk).toMatch(/const \{ listSessions \} = await import\("@anthropic-ai\/claude-agent-sdk"\)/);
    expect(sdk).toMatch(/const \{ getSessionMessages \} = await import\("@anthropic-ai\/claude-agent-sdk"\)/);
    const walkers = sourcesUnder("src")
      .filter((f) => /\.claude\/projects/.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(appRoot, f));
    expect(walkers, "something is walking the CLI's session store by hand").toEqual([]);

    // 6. The wire: no argument to list, an id and nothing else to describe or attach.
    const preload = read("src/preload/index.ts");
    expect(preload).toMatch(/invoke\(IPC\.sessionResumable\)/);
    expect(preload, "the renderer picks which project's sessions to list").not.toMatch(/sessionResumable,\s*\w/);
    expect(preload).toMatch(/invoke\(IPC\.sessionResumeDetail, id\)/);
    expect(preload).toMatch(/invoke\(IPC\.sessionResume, id\)/);
    expect(preload, "the renderer describes what a resume inherits").not.toMatch(/sessionResume, id,/);

    // 7. THE DISCLOSURE IS NOT OPTIONAL, and it is about the PAST. A resumed transcript was produced
    //    under the terminal session's rules and can already hold file contents from anywhere on
    //    disk — measured in probe A, where the resumed conversation answered a question about a
    //    file's contents with no tool call at all. The boundary applies going forward only, so the
    //    UI lists what was read, marks what is out of scope, and offers a way to decline.
    const picker = read("src/renderer/src/components/session-resume.tsx");
    expect(picker).toMatch(/data-testid="session-resume-read"/);
    expect(picker).toMatch(/data-in-scope=\{read\.inScope\}/);
    expect(picker).toMatch(/data-testid="session-resume-decline"/);
    expect(picker).toMatch(/data-testid="session-resume-confirm"/);
    // Every sentence on it comes off the disclosure main built — the picker states no policy of its
    // own, exactly as the pane composes no prompt.
    expect(picker).toMatch(/\{disclosure\.readNote\}/);
    expect(picker).toMatch(/\{disclosure\.replayNote\}/);
    expect(picker).toMatch(/\{disclosure\.scopeNote\}/);
    expect(stripComments(picker), "the picker reached the session channels directly").not.toMatch(/window\.maestro/);
  });

  it("ends a session on a project switch and reaps it on quit", () => {
    // A detached process group outlives its parent BY DESIGN — that is how Stop reaches the CLI's
    // own children — so every exit has to kill it. Three exits, and the transcript makes the first
    // one the easiest to forget.
    const announce = ipc.slice(ipc.indexOf("function announce("), ipc.indexOf("export function registerIpc"));
    expect(announce, "a project switch leaves the previous project's session running").toContain("endAllSessions()");
    expect(ipc).toMatch(/export function disposeIpc[\s\S]*disposeSessions\(\)/);
    // A window that closes or reloads is the case with no user action to hang the cleanup off.
    expect(ipc).toMatch(/destroyed",\s*\(\)\s*=>\s*endSession\(/);

    // And nothing starts a session implicitly: the only caller of `startSession` is the channel the
    // user's own click reaches.
    const starts = (ipc.match(/startSession\(/g) ?? []).length;
    expect(starts, "something starts a session without being asked").toBe(1);
  });
});

describe("session log tail ownership", () => {
  // The main process keeps one tail per webContents id and stops the old one before starting a
  // new one, so `log.subscribe` is single-owner by construction. A second subscriber anywhere in
  // the renderer would steal the tail from the first, and whichever unsubscribed first would
  // stop it for both — silently, with the other view simply going quiet.
  it("has exactly one subscriber in the renderer", () => {
    const callSites = sourcesUnder("src/renderer")
      .filter((f) => /maestro\.log\.subscribe\(/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(appRoot, f));
    expect(callSites).toEqual(["src/renderer/src/utils/session-log-context.tsx"]);
  });
});

describe("saving refreshes loader data", () => {
  // `seeded` is decided by the loader from whether maestro.json existed at load time, and nothing
  // re-runs a loader on its own after a save: saving doesn't navigate, and the `project:changed`
  // broadcast ProjectProvider invalidates on doesn't fire. Without an explicit invalidation the
  // "starter configuration, not saved" banner stays up after a successful save — telling the user
  // their config is unsaved while it sits on disk. Verified in a running window; there is no
  // render test that would catch it, hence this source-level guard.
  for (const route of ["workflows", "rules"] as const) {
    it(`/${route} invalidates the router after a successful save`, () => {
      const src = read(`src/renderer/src/routes/${route}.tsx`);
      expect(src).toMatch(/useRouter/);
      expect(src).toMatch(/router\.invalidate\(\)/);
      // The invalidation must be on the success path — after the `!res.ok` bail-out, so a
      // rejected save doesn't re-run the loader and stomp the editor's state.
      const bail = src.indexOf("if (!res.ok)");
      const invalidate = src.indexOf("router.invalidate()");
      expect(bail).toBeGreaterThan(-1);
      expect(invalidate).toBeGreaterThan(bail);
    });
  }
});

describe("the Claude Agent SDK is a dependency, not a bundle", () => {
  // Everything here fails ONLY in a packaged build. A `dev` run resolves the SDK out of
  // node_modules whatever the bundler did with it, so the entire failure class is invisible until
  // the app is installed somewhere — which is the reason for asserting it at this level.
  const manifest = JSON.parse(read("package.json"));
  const config = read("electron.vite.config.ts");
  const SDK = "@anthropic-ai/claude-agent-sdk";

  it("is in `dependencies`, which is where externalizeDepsPlugin looks", () => {
    // The plugin derives its externals from `dependencies`. Before this arrived the app had NO
    // dependencies block — every entry was a devDependency — so an SDK added in the obvious place
    // would have been bundled, and its runtime `require.resolve` of a CLI on disk would have
    // resolved against out/main/ and thrown `Native CLI binary for <platform> not found`.
    expect(manifest.dependencies?.[SDK], `${SDK} is not in dependencies`).toBeTruthy();
    expect(manifest.devDependencies?.[SDK], `${SDK} is ALSO a devDependency`).toBeUndefined();
  });

  it("is the CLI-spawning SDK, not the API-key REST client", () => {
    // `@anthropic-ai/sdk` is the Messages API client: it takes an API key, bills pay-as-you-go,
    // spawns no CLI and has no canUseTool. One path segment apart from the right one, and it
    // installs and type-checks perfectly happily.
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(Object.keys(deps)).not.toContain("@anthropic-ai/sdk");
  });

  it("is not on the bundler's workspace-source exclusion list", () => {
    // `exclude:` is for workspace SOURCE packages with no build artifact for `require` to find —
    // the opposite case. Adding the SDK to it looks like the same kind of fix and undoes the above.
    const exclude = config.match(/exclude:\s*\[([^\]]*)\]/);
    expect(exclude, "externalizeDepsPlugin no longer has an exclude list").not.toBeNull();
    expect(exclude![1]).not.toContain("@anthropic-ai");
  });

  it("has exactly one module importing it", () => {
    // Not a rule against the SDK — a rule that its call sites arrive as a diff to this line. It is
    // a second way to reach the `claude` binary (see the reviewed list above), and the options it
    // is given decide the permission model for every future session.
    const importers = sourcesUnder("src/core")
      .concat(sourcesUnder("src/main"))
      .filter((f) => new RegExp(`["'\`]${SDK}["'\`]`).test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(appRoot, f));
    expect(importers).toEqual(["src/core/agent-sdk.ts"]);
  });

  it("gives the query an explicitly resolved binary and a constructed environment", () => {
    // Three properties of the spawn options, each of which is a silent failure on its own:
    //   • no `pathToClaudeCodeExecutable` → the SDK spawns NODE to run a bundled cli.js, and a
    //     GUI-launched app has no `node` on PATH. Reads as `spawn node ENOENT`; never reproduces
    //     from a terminal.
    //   • `env: process.env` → an ANTHROPIC_API_KEY anywhere in the inherited environment bills
    //     the API instead of the user's subscription, with nothing on screen saying so.
    //   • `settingSources` unset → a key in ~/.claude/settings.json is the second door to the same
    //     place, and it overrides the environment we just built.
    const src = stripComments(read("src/core/agent-sdk.ts"));
    expect(src).toMatch(/pathToClaudeCodeExecutable:\s*cli\.bin/);
    expect(src).toMatch(/settingSources:\s*\[\]/);
    // The env is built by a tested function, never spread inline from the parent at the call site.
    expect(src).toMatch(/agentChildEnv\(/);
    expect(src, "the SDK query spreads process.env directly").not.toMatch(/env:\s*\{\s*\.\.\.process\.env/);
  });

  const builtMain = path.join(appRoot, "out/main/index.js");

  it.runIf(fs.existsSync(builtMain))("is required at runtime rather than inlined into main", () => {
    const src = fs.readFileSync(builtMain, "utf8");
    // The specifier survives the build — that is what "external" means at this level.
    expect(src, "the built main bundle does not reference the SDK").toContain(SDK);
    // And the source did not come with it. `Native CLI binary for` is the SDK's own resolution
    // error, present only in its implementation; if it is in our bundle, the SDK is in our bundle.
    expect(src, "the SDK's source was inlined into out/main/index.js").not.toContain("Native CLI binary for");
    expect(src).not.toContain("CLAUDE_AGENT_SDK_CLIENT_APP");
  });
});

describe("built main and preload bundles", () => {
  // `electron` is a devDependency, so externalizeDepsPlugin (which reads `dependencies`) does not
  // cover it, and electron.vite.config.ts externalizes it by hand. If that ever comes out, the
  // npm package's Node-side shim gets inlined instead — its body is `module.exports =
  // getElectronPath()`, which runs at import time, fails to find `path.txt` beside the bundle and
  // throws "Electron failed to install correctly". The app then cannot start at all, and the
  // message points at node_modules rather than at the config. Nothing but launching the app
  // catches it, so: assert it here.
  const built = ["out/main/index.js", "out/preload/index.js"]
    .map((rel) => ({ rel, full: path.join(appRoot, rel) }))
    .filter(({ full }) => fs.existsSync(full));

  it.runIf(built.length > 0)("import electron rather than inlining its path shim", () => {
    for (const { rel, full } of built) {
      const src = fs.readFileSync(full, "utf8");
      expect(src, `${rel} inlined the electron npm shim`).not.toContain("getElectronPath");
      expect(src, `${rel} does not import electron`).toMatch(/from\s*["']electron["']/);
    }
  });
});

describe("built renderer bundle", () => {
  const outDir = path.join(appRoot, "out", "renderer", "assets");
  const bundles = fs.existsSync(outDir)
    ? fs
        .readdirSync(outDir)
        .filter((f) => f.endsWith(".js"))
        .map((f) => path.join(outDir, f))
    : [];

  // stripComments (module scope) matters doubly here: bundled dependencies ship JSDoc containing
  // lines like `* import process from 'node:process'`, which is documentation, not a resolved
  // import — matching it would fail this test for a bundle that is actually clean.

  it.runIf(bundles.length > 0)("imports no node builtins and no electron", () => {
    for (const file of bundles) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      expect(src).not.toMatch(/(?:from|import|require\()\s*["'`]node:/);
      expect(src).not.toMatch(/(?:from|require\()\s*["'`]electron["'`]/);
      // Vite's marker for a node builtin stubbed out for the browser — the exact failure mode
      // that used to blank a route in the web app.
      expect(src).not.toContain("__vite-browser-external");
    }
  });
});

describe("built renderer stylesheets", () => {
  // The renderer CSP is `default-src 'self'`, so any remote reference that reaches the built CSS
  // is not a slow load — it is a hard block plus a console error, and the app silently renders in
  // fallback fonts. That is exactly what `@repo/styles`' Google Fonts `@import` did until the
  // families were vendored into the package. Restoring it, or adding any other CDN reference,
  // looks perfectly fine in a browser and breaks only here.
  const outDir = path.join(appRoot, "out", "renderer", "assets");
  const sheets = fs.existsSync(outDir)
    ? fs
        .readdirSync(outDir)
        .filter((f) => f.endsWith(".css"))
        .map((f) => path.join(outDir, f))
    : [];

  it.runIf(sheets.length > 0)("reference nothing off-origin", () => {
    for (const file of sheets) {
      const src = fs.readFileSync(file, "utf8");
      const remote = [...src.matchAll(/url\(\s*["']?(https?:)?\/\/[^)]*\)/g)].map((m) => m[0]);
      expect(remote, `${path.basename(file)} loads a remote asset`).toEqual([]);
      expect(src).not.toContain("fonts.googleapis.com");
      expect(src).not.toContain("fonts.gstatic.com");
    }
  });

  it.runIf(sheets.length > 0)("emit the vendored font files alongside them", () => {
    // A `@font-face` whose file never got emitted resolves to nothing and falls back silently.
    const emitted = fs.readdirSync(outDir).filter((f) => f.endsWith(".woff2"));
    expect(emitted.length).toBeGreaterThan(0);
    for (const family of ["inter", "bodoni-moda", "ibm-plex-mono"]) {
      expect(
        emitted.some((f) => f.startsWith(family)),
        `no ${family} woff2 emitted`
      ).toBe(true);
    }
  });
});
