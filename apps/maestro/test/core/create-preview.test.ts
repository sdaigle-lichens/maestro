// The create-* flows crossing the bridge.
//
// The acceptance criterion these exist for is "every CLI invocation from these routes goes through
// the preview → confirm → run path; none spawns a process directly". The structural half of that
// is already pinned in `claude.test.ts` (preview's import graph cannot reach `child_process`); what
// is left is the part specific to these four kinds:
//
//   • the prompt names the file the SCAFFOLD ALREADY WROTE, so a run finishes an artifact rather
//     than creating one — and it names it via the same resolution the writer used;
//   • it is prose, not `/create-skill`. The slash command would fire the plugin's
//     UserPromptExpansion hook, which launches the Docker app and blocks on a form submission a
//     headless run cannot make. A test is the only thing that would notice that regression, since
//     the prompt would still look perfectly reasonable in the modal;
//   • the working directory follows the artifact. A skill written into a marketplace repo lives
//     outside the open project, and a run whose edits are all outside its cwd gets none of them
//     auto-accepted.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { previewClaudeRun, CLAUDE_BASE_FLAGS } from "../../src/core/claude-preview.js";
import { scaffoldCreate } from "../../src/core/scaffold.js";
import { nodeGit } from "../../src/core/git.js";
import { claimInvocation, clearInvocations } from "../../src/core/claude-tokens.js";
import type { CreateRequest, EffectiveSettingsSnapshot, SettingsPort } from "../../src/core/contracts.js";

let tmp: string;
let home: string;
let project: string;
let market: string;
let binDir: string;

/** Resolver options that see one fake CLI and one fixture home, and no real machine. */
const opts = () => ({ env: { PATH: binDir }, home, platform: "linux" as const });

const skill: CreateRequest = {
  kind: "create-skill",
  mode: "auto",
  target: "marketplace",
  name: "migration-reviewer",
  idea: "Reviews database migrations for safety issues.",
  useWhen: ["a .sql file changes", "a migration is added"],
  marketplace: "my-tools",
  plugin: "toolkit",
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "create-preview-"));
  project = fs.mkdtempSync(path.join(tmp, "project-"));
  home = fs.mkdtempSync(path.join(tmp, "home-"));
  market = fs.mkdtempSync(path.join(tmp, "market-"));

  fs.mkdirSync(path.join(market, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(market, ".claude-plugin", "marketplace.json"),
    JSON.stringify(
      { name: "my-tools", owner: { name: "Ada", email: "ada@example.com" }, plugins: [{ name: "toolkit" }] },
      null,
      2
    ) + "\n"
  );
  fs.mkdirSync(path.join(market, "plugins", "toolkit", "skills"), { recursive: true });

  const plugins = path.join(home, ".claude", "plugins");
  fs.mkdirSync(plugins, { recursive: true });
  fs.writeFileSync(
    path.join(plugins, "known_marketplaces.json"),
    JSON.stringify({ "my-tools": { source: { source: "directory" }, installLocation: market, lastUpdated: "now" } })
  );

  binDir = fs.mkdtempSync(path.join(tmp, "bin-"));
  fs.writeFileSync(path.join(binDir, "claude"), "#!/bin/sh\ntrue\n");
  fs.chmodSync(path.join(binDir, "claude"), 0o755);

  clearInvocations();
});

afterEach(() => {
  clearInvocations();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("the finishing prompt", () => {
  it("names the exact file the scaffold wrote", async () => {
    const written = scaffoldCreate(project, skill, { home });
    const preview = await previewClaudeRun(project, skill, opts());

    expect(written.scaffolded).toBe(true);
    expect(preview.prompt).toContain(written.path);
    expect(preview.targets.map((t) => t.path)).toEqual([written.path]);
    expect(preview.targets[0].action).toBe("modify");
  });

  it("tells the run to finish the artifact rather than recreate it or touch its frontmatter", async () => {
    const preview = await previewClaudeRun(project, skill, opts());
    expect(preview.prompt).toMatch(/already written/);
    expect(preview.prompt).toMatch(/Do not recreate it/);
    expect(preview.prompt).toMatch(/do not change its frontmatter/);
  });

  it("carries the form's own words, so the run is about the artifact the user described", async () => {
    const preview = await previewClaudeRun(project, skill, opts());
    expect(preview.prompt).toContain("Reviews database migrations for safety issues.");
    expect(preview.prompt).toContain("a .sql file changes or a migration is added");
  });

  it("names the skill that holds the guidance, instead of carrying a second copy of it", async () => {
    // `026`. Each prompt used to paste in the instructions its matching SKILL.md already carried —
    // two copies, one reachable only from the app and one only from a terminal, drifting apart with
    // nothing to catch it. The prompt keeps the FACTS and names the skill for the rest; `Skill` and
    // the bundled plugin (pinned in `test/isolation.test.ts`) are what make the name resolvable.
    for (const request of allFour()) {
      const preview = await previewClaudeRun(project, request, opts());
      expect(preview.prompt, request.kind).toContain(`Follow the ${request.kind} skill`);
      // The phrases that were deleted, each from a different prompt. They are what "duplicated
      // guidance" looked like, and a re-inlining is exactly how the drift starts again.
      expect(preview.prompt, request.kind).not.toMatch(/domain expert/i);
      expect(preview.prompt, request.kind).not.toMatch(/reference tables or/i);
      expect(preview.prompt, request.kind).not.toMatch(/how to install it from this marketplace/i);
    }
  });

  it("is prose, never a slash command that would re-enter the form flow", async () => {
    // `/create-skill` in a headless run fires the plugin's UserPromptExpansion hook, which brings
    // the Docker app up and waits for a submission that can never arrive.
    for (const request of allFour()) {
      const preview = await previewClaudeRun(project, request, opts());
      expect(preview.prompt, request.kind).not.toMatch(/(^|\s)\/create-(skill|subagent|plugin|marketplace)/);
      expect(preview.prompt, request.kind).not.toMatch(/(^|\s)\/ai-tools/);
    }
  });

  it("covers all four kinds", async () => {
    for (const request of allFour()) {
      const preview = await previewClaudeRun(project, request, opts());
      expect(preview.prompt.length, request.kind).toBeGreaterThan(80);
      expect(preview.targets.length, request.kind).toBeGreaterThan(0);
      // Exactly what the modal shows and exactly what runs — prompt included, verbatim.
      expect(preview.argv).toEqual([path.join(binDir, "claude"), ...CLAUDE_BASE_FLAGS, preview.prompt]);
    }
  });
});

describe("where the run happens", () => {
  it("is the project, for an artifact written into the project", async () => {
    const preview = await previewClaudeRun(project, { ...skill, target: "project" }, opts());
    expect(preview.cwd).toBe(project);
  });

  it("is the marketplace repo, for an artifact written into one", async () => {
    // Not the open project: every edit would then be outside the CLI's working directory, where
    // `--permission-mode acceptEdits` does not apply and a headless run has nobody to ask.
    expect((await previewClaudeRun(project, skill, opts())).cwd).toBe(market);
  });

  it("is the new marketplace's own directory, for create-marketplace", async () => {
    const targetDir = path.join(tmp, "brand-new");
    const preview = await previewClaudeRun(project, marketplaceRequest(targetDir), opts());
    expect(preview.cwd).toBe(targetDir);
    expect(preview.prompt).toContain("CLAUDE.md");
  });

  it("carries the private-repo FLAG only when the form asked for it, and never what it implies", async () => {
    // `026`: the env-var table this used to assert on lives in `create-marketplace/SKILL.md`, which
    // is now the only copy of it. What the prompt owes the run is the fact the form captured —
    // whether the repository is private — not a paraphrase of the documentation about it.
    const targetDir = path.join(tmp, "private-one");
    const plain = await previewClaudeRun(project, marketplaceRequest(targetDir), opts());
    const priv = await previewClaudeRun(project, { ...marketplaceRequest(targetDir), privateRepo: true }, opts());
    expect(plain.prompt).not.toMatch(/PRIVATE repository/);
    expect(priv.prompt).toMatch(/PRIVATE repository/);
    expect(priv.prompt, "the skill's env-var table is inlined again").not.toMatch(/GITHUB_TOKEN/);
  });
});

describe("what continuing in the pane would open", () => {
  // The write scope the session pane accumulates comes from here and from nowhere else, so the
  // resolution is the whole security surface of the handoff: whatever this returns is what a
  // session may write for as long as it lasts. Two failures matter and neither is visible on
  // screen — a scope wider than the artifact (the session gets somebody else's files) and a scope
  // that is not on the token at all (the renderer would have to name one).

  it("is the artifact's OWN directory, for an artifact the scaffold made one for", async () => {
    const written = scaffoldCreate(project, skill, { home });
    const preview = await previewClaudeRun(project, skill, opts());

    expect(preview.handoff).not.toBeNull();
    expect(preview.handoff!.scope).toBe("directory");
    expect(preview.handoff!.writeScope).toBe(path.dirname(written.path));
    expect(preview.handoff!.artifact).toBe(written.path);
    // Narrower than the marketplace it sits in and narrower than the plugin: the form was about one
    // skill, and the directory the scaffold made for it is the whole of what it asked for.
    expect(preview.handoff!.writeScope.startsWith(path.join(market, "plugins", "toolkit", "skills"))).toBe(true);
    expect(preview.handoff!.writeScope).not.toBe(market);
  });

  it("is the FILE, for a project subagent, which owns no directory", async () => {
    // `.claude/agents/` holds every agent the project has. Opening it because a form created one of
    // them would hand the session the rest, which no form asked for — so the lone file is the scope.
    const request: CreateRequest = {
      kind: "create-subagent",
      mode: "auto",
      target: "project",
      name: "reviewer",
      idea: "Reviews pull requests.",
      description: "",
      triggers: ["a PR opens"],
      tools: [],
      marketplace: "",
      plugin: "",
    };
    const written = scaffoldCreate(project, request, { home });
    const preview = await previewClaudeRun(project, request, opts());

    expect(preview.handoff!.scope).toBe("file");
    expect(preview.handoff!.writeScope).toBe(written.path);
    expect(preview.handoff!.writeScope).not.toBe(path.join(project, ".claude", "agents"));
  });

  it("carries the frontmatter the scaffold wrote, read back off the disk", async () => {
    // Read here rather than taken from a `ScaffoldResult`: the renderer holds one of those, and a
    // seed that trusted it would be the renderer describing what a session may write.
    scaffoldCreate(project, skill, { home });
    const preview = await previewClaudeRun(project, skill, opts());
    expect(preview.handoff!.state).toContain("name: migration-reviewer");
    expect(preview.handoff!.state.startsWith("---")).toBe(true);
  });

  it("reports the repository state, so a session does not offer to init one that exists", async () => {
    fs.mkdirSync(path.join(market, ".git"), { recursive: true });
    scaffoldCreate(project, skill, { home });
    const preview = await previewClaudeRun(project, skill, opts());
    expect(preview.handoff!.repo).toContain(market);
    expect(preview.handoff!.repo).toContain("do not run git init");
  });

  it("rides on the invocation, not just on the preview the renderer sees", async () => {
    // `session:handoff` takes a token and nothing else. The directory therefore has to be on the
    // invocation this process recorded, or the channel would need an argument naming one.
    scaffoldCreate(project, skill, { home });
    const preview = await previewClaudeRun(project, skill, opts());
    const invocation = claimInvocation(preview.token, "claude");
    expect(invocation.handoff).toEqual(preview.handoff);
  });

  it("is resolved for all four forms", async () => {
    for (const request of allFour()) {
      const preview = await previewClaudeRun(project, request, opts());
      expect(preview.handoff, request.kind).not.toBeNull();
      expect(path.isAbsolute(preview.handoff!.writeScope), request.kind).toBe(true);
    }
  });

  it("is NULL for a task run, whose write target is the whole project", async () => {
    // The one preview kind that must never be continuable in the pane: a task decides for itself
    // what it edits, so its `writable` is the project root, and one click would swallow it.
    const tasks = path.join(project, ".claude", "maestro-tasks");
    fs.mkdirSync(tasks, { recursive: true });
    fs.writeFileSync(path.join(tasks, "001-a-task.md"), "# A task\n");
    const preview = await previewClaudeRun(project, { kind: "maestro-task", filename: "001-a-task.md" }, opts());
    expect(preview.handoff).toBeNull();
    expect(claimInvocation(preview.token, "claude").handoff).toBeNull();
  });
});

describe("a request the app will not run", () => {
  it("is refused at preview, so no token is ever issued for it", async () => {
    await expect(previewClaudeRun(project, { ...skill, marketplace: "invented" }, opts())).rejects.toThrow(
      /No local marketplace/
    );
    await expect(previewClaudeRun(project, { ...skill, name: "Not Kebab" }, opts())).rejects.toThrow(/kebab-case/);
  });
});

describe("with no CLI installed", () => {
  it("still hands back the whole prompt, and nothing runnable", async () => {
    const nothing = fs.mkdtempSync(path.join(tmp, "empty-bin-"));
    const preview = await previewClaudeRun(project, skill, { env: { PATH: nothing }, home, platform: "linux" });

    expect(preview.available).toBe(false);
    expect(preview.token).toBeNull();
    // Copy prompt is the fallback that keeps these routes useful without the CLI — the scaffold
    // has already run, so pasting this into a session finishes the same artifact.
    expect(preview.prompt).toContain("Reviews database migrations for safety issues.");
  });
});

describe("what the run will be able to read", () => {
  // A `SettingsPort` standing in for the Agent SDK's resolution. The port exists precisely so this
  // is possible: `claude-preview.ts` must import nothing that can start a process, so the cascade
  // arrives as an argument and a test can hand over a fixture instead of the developer's own
  // ~/.claude. What it cannot fake is WHICH directory gets resolved — that comes from the preview.
  const port = (snapshot: EffectiveSettingsSnapshot, seen?: string[]): SettingsPort => ({
    resolve: async (cwd) => {
      seen?.push(cwd);
      return snapshot;
    },
  });

  const empty: EffectiveSettingsSnapshot = {
    sources: [],
    effective: { additionalDirectories: [], allow: [], deny: [], ask: [], defaultMode: null },
  };

  it("resolves the settings against the RUN's directory, not the open project", () => {
    // Project-tier settings are read relative to where the session starts. For a marketplace-bound
    // artifact that is the marketplace, so resolving against the open project would report a
    // different repo's `.claude/settings.json` than the one about to apply.
    const seen: string[] = [];
    return previewClaudeRun(project, skill, { ...opts(), settings: port(empty, seen) }).then((preview) => {
      expect(seen).toEqual([market]);
      expect(preview.cwd).toBe(market);
    });
  });

  it("says the open project is out of scope when the run happens in a marketplace", async () => {
    const preview = await previewClaudeRun(project, skill, { ...opts(), settings: port(empty) });

    expect(preview.read.directories.map((d) => d.path)).toEqual([market]);
    expect(preview.read.projectReadable).toBe(false);
    expect(preview.read.summary).toContain(project);
    expect(preview.read.unresolved).toBeNull();
  });

  it("carries directories a settings file added, with the file that added them", async () => {
    const snapshot: EffectiveSettingsSnapshot = {
      sources: [
        {
          tier: "user",
          path: path.join(home, ".claude", "settings.json"),
          permissions: {
            additionalDirectories: [project],
            allow: ["Bash(ls:*)"],
            deny: [],
            ask: [],
            defaultMode: null,
          },
        },
      ],
      effective: {
        additionalDirectories: [project],
        allow: ["Bash(ls:*)"],
        deny: [],
        ask: [],
        defaultMode: null,
      },
    };
    const preview = await previewClaudeRun(project, skill, { ...opts(), settings: port(snapshot) });

    expect(preview.read.directories.map((d) => d.path)).toEqual([market, project]);
    expect(preview.read.directories[1]).toMatchObject({
      origin: "settings",
      tier: "user",
      file: path.join(home, ".claude", "settings.json"),
    });
    expect(preview.read.projectReadable).toBe(true);
    expect(preview.read.rules).toContainEqual({
      list: "allow",
      rule: "Bash(ls:*)",
      tier: "user",
      file: path.join(home, ".claude", "settings.json"),
    });
  });

  it("reports the cascade as unresolved rather than failing the whole preview", async () => {
    // A disclosure detail must not cost the user the prompt and the Copy-prompt fallback. What it
    // must not do either is silently report only the cwd, which would read as a complete answer.
    const broken: SettingsPort = {
      resolve: async () => {
        throw new Error("no such file");
      },
    };
    const preview = await previewClaudeRun(project, skill, { ...opts(), settings: broken });

    expect(preview.prompt).toContain("Reviews database migrations for safety issues.");
    expect(preview.read.directories.map((d) => d.path)).toEqual([market]);
    expect(preview.read.unresolved).toMatch(/could not be read: no such file/);
  });

  it("is disclosed even with no CLI installed, since Copy prompt grants exactly the same scope", async () => {
    const nothing = fs.mkdtempSync(path.join(tmp, "no-cli-"));
    const preview = await previewClaudeRun(project, skill, {
      env: { PATH: nothing },
      home,
      platform: "linux",
      settings: port(empty),
    });

    expect(preview.available).toBe(false);
    expect(preview.read.directories.map((d) => d.path)).toEqual([market]);
  });
});

describe("cancelling the confirmation", () => {
  it("leaves the scaffolded marketplace on disk, repository and all", async () => {
    // Preview is the whole of what happens before Run: it builds a prompt, resolves the CLI and now
    // reads the settings cascade. None of that may touch the artifact the scaffold already wrote —
    // including the `.git` it made for a new marketplace, which is the part a user would notice
    // last and mind most. Cancel is then a no-op by construction: no token is ever spent.
    const targetDir = path.join(tmp, "cancelled-marketplace");
    const written = scaffoldCreate(project, marketplaceRequest(targetDir), { home, git: nodeGit() });
    expect(written.scaffolded).toBe(true);

    const before = snapshotTree(targetDir);
    // On a machine with `git` the scaffold made a repository, and that is the part of the artifact
    // a user would notice last and mind most. Without one the marketplace is still complete — the
    // scaffold reports which of the three happened — and the untouched-tree check below is the
    // assertion either way, so this is conditional rather than a requirement on the test machine.
    if (written.repo?.initialized) expect(before).toContain(".git");

    const preview = await previewClaudeRun(project, marketplaceRequest(targetDir), opts());
    // …and the user closes the dialog. Nothing claims the token; nothing spawns.
    expect(preview.token).toBeTruthy();

    expect(snapshotTree(targetDir)).toEqual(before);
  });
});

/** Every path under `root`, relative and sorted — enough to catch a file added, removed or moved. */
function snapshotTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(rel);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    }
  };
  walk(root, "");
  return out;
}

function marketplaceRequest(targetDir: string): CreateRequest {
  return {
    kind: "create-marketplace",
    name: "my-new-tools",
    description: "My personal tools",
    ownerName: "Ada",
    ownerEmail: "ada@example.com",
    homepage: "",
    targetDir,
    privateRepo: false,
  };
}

function allFour(): CreateRequest[] {
  return [
    skill,
    {
      kind: "create-subagent",
      mode: "auto",
      target: "marketplace",
      name: "security-reviewer",
      idea: "Audits pull requests for security issues.",
      description: "",
      triggers: ["a PR touches auth"],
      tools: ["Bash", "Read"],
      marketplace: "my-tools",
      plugin: "toolkit",
    },
    {
      kind: "create-plugin",
      name: "linting",
      description: "Lint helpers",
      keywords: ["lint"],
      marketplace: "my-tools",
    },
    marketplaceRequest(path.join(tmp, "brand-new")),
  ];
}
