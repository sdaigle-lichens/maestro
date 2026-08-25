// The deterministic half of the four create-* flows: everything that can be written without a
// model, written the moment the form is submitted.
//
// PORTED FROM `apps/ai-tools-manager/src/utils/scaffold.ts`, with three things gone and one added.
//
// Gone: `mountedProjectPath`. There is no container mount, so the branch where a target sits
// outside the mounted repo and degrades to `scaffolded: false` for the dispatcher to finish
// host-side has nothing left to describe — every path on the host is reachable. `scaffolded: false`
// now means a real failure with a real reason, which is why the callers can surface it as one.
//
// Gone: `create-result.ts`. Its whole job was the `/tmp/result.json` envelope (`aiToolsAction` +
// `hookSpecificOutput`) that a hook read to unblock a waiting Claude session. There is no hook and
// no result file; these functions return their summary to the caller directly.
//
// Gone: destination paths crossing a process boundary. The web app's submit handlers took a `cwd`
// and a `marketplacePath` from the form payload. Here `resolveCreateTarget` derives every path from
// the open project root plus a marketplace NAME the user picked out of a list this process
// produced — so a renderer describes an artifact and never nominates a directory.
//
// Added: the writes are all-or-nothing. The old version wrote the manifest, then best-effort
// mkdir'd `skills/`, then best-effort registered the plugin, and reported `scaffolded: true` if the
// first one landed — so a failure halfway left a plugin on disk that no marketplace knew about and
// a summary that said it was fine. Every flow here builds its complete list of steps first and
// rolls back what it did if any of them fails, because "a failed write surfaces the reason rather
// than leaving a partial artifact" is only true if something undoes the partial artifact.
//
// Added later: a new marketplace is a git repository, and that is a step in the same list. It used
// to be an instruction in a prompt, which made "is it a repo?" depend on whether a run happened.
// `git` is reached through the `GitPort` the caller supplies — see the interface in `contracts.ts`
// for why this module must not import the implementation — and it obeys the same discipline as
// every other step: a failure after it removes the repository it made.

import fs from "node:fs";
import path from "node:path";
import { listMarketplaces, marketplaceOwner, marketplacePath, type MarketplaceOptions } from "./marketplaces.js";
import { enclosingRepo } from "./repo.js";
import { buildDesc, clip, deriveName, titleFromName } from "./text.js";
import type { CreateRequest, GitPort, RepoResult, ScaffoldResult } from "./contracts.js";

export type { CreateRequest, ScaffoldResult };

/**
 * What the scaffold needs beyond the request: which home to read marketplaces from, and how to
 * make a repository.
 *
 * `git` is optional and its absence means "this caller does not do repositories" — not "there is no
 * git". A caller that wants one passes `nodeGit()`; `src/main/ipc.ts` is the one that does, and
 * `test/isolation.test.ts` pins it there, because a scaffold silently losing its port would show up
 * as marketplaces that are quietly no longer repositories.
 */
export interface ScaffoldOptions extends MarketplaceOptions {
  git?: GitPort;
}

// ── where an artifact goes ───────────────────────────────────────────────────────────────────

/** The one resolution of "where does this land", shared by the scaffold and the bridge's preview. */
export interface CreateTarget {
  /** The kebab-case name actually used — derived from the idea when the form left it blank. */
  name: string;
  /** Absolute path of the primary artifact: the file for a skill/agent, the directory otherwise. */
  path: string;
  /**
   * The directory this artifact OWNS, or "" when it does not own one.
   *
   * Three of the five shapes get a directory of their own from the scaffold — a skill's
   * `skills/<name>/`, a marketplace subagent's `agents/<name>/`, the plugin or the marketplace
   * itself — and one does not: a project-target subagent is a single `.md` file inside
   * `.claude/agents/`, a directory it shares with every other agent in the project.
   *
   * The distinction exists because something eventually grants write access to this, and "the
   * directory the scaffold made for this artifact" and "the directory the artifact happens to sit
   * in" are the same string right up until the second one is somebody else's work. Empty means the
   * artifact is its own scope and nothing around it is included.
   */
  dir: string;
  /** The marketplace repo this writes into, or "" for a project-local artifact. */
  marketplacePath: string;
}

const KEBAB = /^[a-z][a-z0-9-]*$/;

/**
 * Why a request cannot be scaffolded, in the user's terms — empty when it can.
 *
 * The renderer validates the same rules with zod so the user sees them per-field as they type.
 * This is the copy that decides, because main does not get to assume the renderer ran: a request
 * that reaches here invalid is refused before anything touches the disk.
 */
export function validateCreateRequest(
  projectRoot: string,
  request: CreateRequest,
  opts: MarketplaceOptions = {}
): string[] {
  const errors: string[] = [];
  const named = (name: string, required: boolean) => {
    if (!name) {
      if (required) errors.push("A name is required.");
      return;
    }
    if (!KEBAB.test(name)) errors.push(`"${name}" is not kebab-case: use lowercase letters, numbers and dashes.`);
  };

  const intoMarketplace = (marketplace: string, plugin: string) => {
    const found = marketplacePath(marketplace, opts);
    if (!marketplace) errors.push("Pick a marketplace, or switch the target to Project.");
    else if (!found) errors.push(`No local marketplace named "${marketplace}" is registered with Claude Code.`);
    if (!plugin) errors.push("Pick a plugin to file this under.");
    else if (
      found &&
      !listMarketplaces(opts)
        .find((m) => m.name === marketplace)
        ?.plugins.includes(plugin)
    ) {
      errors.push(`"${marketplace}" has no plugin named "${plugin}".`);
    }
  };

  const intoProject = () => {
    if (!projectRoot) errors.push("No project is open — open one, or write into a marketplace instead.");
  };

  switch (request.kind) {
    case "create-skill": {
      named(request.name.trim(), request.mode === "manual");
      if (!request.idea.trim()) errors.push("Describe what this skill should do.");
      if (request.target === "marketplace") intoMarketplace(request.marketplace, request.plugin);
      else intoProject();
      break;
    }
    case "create-subagent": {
      named(request.name.trim(), request.mode === "manual");
      const body = request.mode === "auto" ? request.idea : request.description;
      if (!body.trim()) errors.push("Describe what this subagent should do.");
      if (request.target === "marketplace") intoMarketplace(request.marketplace, request.plugin);
      else intoProject();
      break;
    }
    case "create-plugin": {
      named(request.name.trim(), true);
      if (!request.description.trim()) errors.push("Describe what this plugin provides.");
      if (!request.marketplace) errors.push("Pick a marketplace to add the plugin to.");
      else if (!marketplacePath(request.marketplace, opts)) {
        errors.push(`No local marketplace named "${request.marketplace}" is registered with Claude Code.`);
      }
      break;
    }
    case "create-marketplace": {
      named(request.name.trim(), true);
      if (!request.description.trim()) errors.push("Describe what this marketplace provides.");
      if (!request.ownerName.trim()) errors.push("An owner name is required.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.ownerEmail.trim())) errors.push("Enter a valid owner email.");
      // Absolute only: a relative path would resolve against whatever directory the app happens to
      // have been launched from, which is not a place a user ever meant to create a marketplace.
      if (!request.targetDir.trim()) errors.push("Choose where to create the marketplace.");
      else if (!path.isAbsolute(request.targetDir.trim()))
        errors.push("The target directory must be an absolute path.");
      break;
    }
    default:
      errors.push(`Unsupported create request: ${JSON.stringify(request)}`);
  }
  return errors;
}

/**
 * Where this request's artifact goes, and under what name.
 *
 * Called by the scaffold to write and by `claude-preview.ts` to tell the user which file the run
 * will finish. One resolution, so the confirmation cannot name a different file than the one on
 * disk. Throws on an invalid request rather than inventing a path from a blank field.
 */
export function resolveCreateTarget(
  projectRoot: string,
  request: CreateRequest,
  opts: MarketplaceOptions = {}
): CreateTarget {
  const errors = validateCreateRequest(projectRoot, request, opts);
  if (errors.length) throw new Error(errors.join(" "));

  switch (request.kind) {
    case "create-skill": {
      const name = request.name.trim() || deriveName(request.idea, "new-skill");
      const mp = request.target === "marketplace" ? marketplacePath(request.marketplace, opts)! : "";
      const dir =
        request.target === "project"
          ? path.join(projectRoot, ".claude", "skills", name)
          : path.join(mp, "plugins", request.plugin, "skills", name);
      return { name, path: path.join(dir, "SKILL.md"), dir, marketplacePath: mp };
    }
    case "create-subagent": {
      const body = request.mode === "auto" ? request.idea : request.description;
      const name = request.name.trim() || deriveName(body, "new-agent");
      const mp = request.target === "marketplace" ? marketplacePath(request.marketplace, opts)! : "";
      // A project subagent is one file under .claude/agents/; a marketplace one is a directory
      // with an AGENTS.md, because that is the layout a plugin distributes.
      const file =
        request.target === "project"
          ? path.join(projectRoot, ".claude", "agents", `${name}.md`)
          : path.join(mp, "plugins", request.plugin, "agents", name, "AGENTS.md");
      // The project shape is the one artifact in the app that owns no directory: `.claude/agents/`
      // holds every agent the project has, and it is not this one's to be given away.
      return {
        name,
        path: file,
        dir: request.target === "project" ? "" : path.dirname(file),
        marketplacePath: mp,
      };
    }
    case "create-plugin": {
      const name = request.name.trim();
      const mp = marketplacePath(request.marketplace, opts)!;
      const dir = path.join(mp, "plugins", name);
      return { name, path: dir, dir, marketplacePath: mp };
    }
    case "create-marketplace": {
      const dir = request.targetDir.trim().replace(/\/+$/, "") || request.targetDir.trim();
      return { name: request.name.trim(), path: dir, dir, marketplacePath: dir };
    }
  }
}

// ── all-or-nothing writes ────────────────────────────────────────────────────────────────────

/** One change to the filesystem. A flow declares its whole list before any of it runs. */
type Step =
  | { kind: "file"; file: string; contents: string }
  | { kind: "dir"; dir: string }
  /** Rewrite an existing JSON file. Its previous bytes are restored if a later step fails. */
  | { kind: "patch"; file: string; patch: (json: Record<string, unknown>) => Record<string, unknown> }
  /** `git init` in `dir`. Comes FIRST, so a failure in any later step still un-makes it. */
  | { kind: "repo"; dir: string }
  /** Stage and commit everything the steps above wrote. Comes LAST, for the same reason. */
  | { kind: "commit"; dir: string; message: string; author: { name: string; email: string } };

interface Applied {
  written: string[];
  undo: Array<() => void>;
}

/** Create `dir` and every missing ancestor, recording each one so a rollback can remove it. */
function mkdirTracked(dir: string, applied: Applied): void {
  const missing: string[] = [];
  for (let cur = dir; !fs.existsSync(cur); cur = path.dirname(cur)) {
    missing.unshift(cur);
    if (path.dirname(cur) === cur) break;
  }
  if (!missing.length) return;
  fs.mkdirSync(dir, { recursive: true });
  // Pushed shallowest-first, because the rollback runs the stack in REVERSE — so the deepest
  // directory is removed first and each parent is empty by the time its own undo runs. Pushing
  // them deepest-first reads more naturally and leaves every parent behind. And each undo removes
  // only a still-empty directory: a rollback must never delete one something else has filled.
  for (const created of missing) {
    applied.undo.push(() => {
      try {
        if (fs.existsSync(created) && fs.readdirSync(created).length === 0) fs.rmdirSync(created);
      } catch {
        /* leaving an empty directory behind is not worth failing a rollback over */
      }
    });
  }
}

/**
 * Run every step, or none of them.
 *
 * The pre-check refuses to clobber: an existing artifact is left exactly as it is, and the caller
 * says so. Everything after it is undoable, so a permission error on the fourth write does not
 * leave the first three behind claiming success.
 */
function apply(
  steps: Step[],
  git?: GitPort
): { ok: true; written: string[]; repoError: string } | { ok: false; reason: string } {
  for (const step of steps) {
    if (step.kind === "file" && fs.existsSync(step.file)) {
      return { ok: false, reason: `${step.file} already exists — nothing was written.` };
    }
    if (step.kind === "patch" && !fs.existsSync(step.file)) {
      return { ok: false, reason: `${step.file} does not exist — nothing was written.` };
    }
  }

  const applied: Applied = { written: [], undo: [] };
  // A git failure is reported, not thrown. The other steps are the artifact; the repository is a
  // convenience on top of it, and a marketplace without one is exactly what a machine with no git
  // installed gets — complete and usable. So these two steps roll back only THEMSELVES.
  let repoError = "";
  let undoRepo: (() => void) | null = null;
  try {
    for (const step of steps) {
      if (step.kind === "dir") {
        mkdirTracked(step.dir, applied);
      } else if (step.kind === "file") {
        mkdirTracked(path.dirname(step.file), applied);
        fs.writeFileSync(step.file, step.contents);
        applied.written.push(step.file);
        applied.undo.push(() => fs.rmSync(step.file, { force: true }));
      } else if (step.kind === "patch") {
        const before = fs.readFileSync(step.file, "utf8");
        applied.undo.push(() => fs.writeFileSync(step.file, before));
        const json = JSON.parse(before) as Record<string, unknown>;
        fs.writeFileSync(step.file, JSON.stringify(step.patch(json), null, 2) + "\n");
      } else if (!repoError) {
        try {
          if (step.kind === "repo") {
            const gitDir = git!.init(step.dir);
            // Removing only the `.git` this call created — a pre-existing repository never gets
            // here, because the enclosing-repo check drops both steps before `apply` runs. It goes
            // on the shared stack too, so a LATER step failing takes the repository with it.
            undoRepo = () => fs.rmSync(gitDir, { recursive: true, force: true });
            applied.undo.push(undoRepo);
          } else {
            git!.commit(step.dir, step.message, step.author);
          }
        } catch (err) {
          repoError = err instanceof Error ? err.message : String(err);
          // An init that succeeded and a commit that did not is the half-repository this discipline
          // exists to prevent. Undoing it now is safe to repeat: `rmSync` with `force` is idempotent,
          // so the copy still on the stack is a no-op if a full rollback runs later.
          undoRepo?.();
        }
      }
    }
    return { ok: true, written: applied.written, repoError };
  } catch (err) {
    for (const undo of [...applied.undo].reverse()) {
      try {
        undo();
      } catch {
        /* best effort: report the original failure, not a failure to clean up after it */
      }
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Decide, before anything runs, whether this scaffold makes a repository — and say so either way.
 *
 * Three of the four answers drop the git steps and none of them is a failure: no port (a caller
 * that does not do repositories), no `git` on the machine, or a directory that already sits inside
 * one. The last is the criterion that matters most in a monorepo: a marketplace created under a
 * checkout must not become a nested repository nobody asked for.
 */
function planRepo(steps: Step[], git?: GitPort): { steps: Step[]; repo?: RepoResult } {
  const init = steps.find((s): s is Extract<Step, { kind: "repo" }> => s.kind === "repo");
  if (!init) return { steps };

  const without = steps.filter((s) => s.kind !== "repo" && s.kind !== "commit");
  if (!git) return { steps: without };

  const availability = git.availability();
  if (!availability.available) {
    return {
      steps: without,
      repo: {
        initialized: false,
        root: null,
        note: `${availability.reason} The marketplace is complete — run \`git init\` there once git is installed.`,
      },
    };
  }

  // Asked with `fs`, not with `git`, so the answer is the same on a machine that hasn't got it.
  const enclosing = enclosingRepo(init.dir);
  if (enclosing) {
    return {
      steps: without,
      repo: {
        initialized: false,
        root: enclosing,
        note: `Already inside the git repository at ${enclosing}, so no repository was created here.`,
      },
    };
  }

  return {
    steps,
    repo: {
      initialized: true,
      root: init.dir,
      note: `Initialised a git repository and committed the scaffolded files.`,
    },
  };
}

// ── the artifacts themselves ─────────────────────────────────────────────────────────────────

function quoteYaml(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** The body an auto-mode run replaces. Deliberately obvious, so a run that failed is visible. */
const AUTO_BODY_PLACEHOLDER =
  "<!-- The /ai-tools dispatcher (or /create-skill) authors the full body here from the idea. -->\n" +
  "Describe the workflow, concrete steps, and any reference tables.";

function manualSkillBody(): string {
  return [
    "Add instructions here. Structure freely: step-by-step workflow, reference tables, decision trees — whatever fits the skill.",
    "",
    "Optional subdirectories (create only if needed):",
    "",
    "- `scripts/` — executable helpers (Node.js, Python, shell)",
    "- `references/` — supporting docs or templates",
    "- `assets/` — static files (images, data)",
  ].join("\n");
}

function manualAgentBody(name: string, triggers: string[]): string {
  const when = triggers.length ? triggers.join(", ") : "<describe when this agent applies>";
  return [
    `Instructions for AI coding agents acting as ${name}. See [agents.md](https://agents.md/) for the format.`,
    "",
    "## Role — workflow",
    "",
    "### When to apply",
    "",
    when,
    "",
    "### Workflow",
    "",
    "1. Step one",
    "2. Step two",
    "",
    "### Output",
    "",
    "Describe the expected output format here.",
  ].join("\n");
}

/** The description the preview showed. Same helper, same clip — the file cannot disagree with it. */
function description(mode: "auto" | "manual", idea: string, triggers: string[], what: string): string {
  return clip(
    buildDesc(mode, idea, triggers, {
      manualFallback: `<short description of what this ${what} does>`,
      whatFallback: `<what this ${what} does>`,
    }),
    140
  );
}

function stepsFor(
  target: CreateTarget,
  request: CreateRequest
): { steps: Step[]; remaining: string; needsModel: boolean } {
  switch (request.kind) {
    case "create-skill": {
      const desc = description(request.mode, request.idea, request.useWhen, "skill");
      const body = request.mode === "manual" ? manualSkillBody() : AUTO_BODY_PLACEHOLDER;
      const contents =
        `---\nname: ${target.name}\ndescription: "${quoteYaml(desc)}"\n---\n\n` +
        `# ${titleFromName(target.name)}\n\n${body}\n`;
      return {
        steps: [{ kind: "file", file: target.path, contents }],
        remaining:
          request.mode === "auto"
            ? "Author the SKILL.md body from the idea, replacing the placeholder."
            : "Skeleton is complete; refine the instructions if needed.",
        needsModel: request.mode === "auto",
      };
    }

    case "create-subagent": {
      const body = request.mode === "auto" ? request.idea : request.description;
      const desc = description(request.mode, body, request.triggers, "subagent");
      const toolsLine = request.tools.length ? `\ntools: ${request.tools.join(", ")}` : "";
      const skeleton =
        request.mode === "manual" ? manualAgentBody(target.name, request.triggers) : AUTO_BODY_PLACEHOLDER;
      const contents =
        `---\nname: ${target.name}\ndescription: "${quoteYaml(desc)}"${toolsLine}\n---\n\n` +
        `# ${titleFromName(target.name)}\n\n${skeleton}\n`;
      return {
        steps: [{ kind: "file", file: target.path, contents }],
        remaining:
          request.mode === "auto"
            ? "Author the AGENTS.md body (role, when-to-apply, workflow, output) from the idea."
            : "Skeleton is complete; fill in the workflow steps.",
        needsModel: request.mode === "auto",
      };
    }

    case "create-plugin": {
      const name = target.name;
      const desc = request.description.trim();
      // Inherit the author from the marketplace manifest: deterministic, and it saves a form field
      // whose only honest answer is already sitting in the file next door.
      const author = marketplaceOwner(target.marketplacePath);
      const manifest = {
        name,
        version: "0.1.0",
        description: desc,
        ...(author ? { author } : {}),
        keywords: request.keywords,
      };
      return {
        steps: [
          {
            kind: "file",
            file: path.join(target.path, ".claude-plugin", "plugin.json"),
            contents: JSON.stringify(manifest, null, 2) + "\n",
          },
          { kind: "dir", dir: path.join(target.path, "skills") },
          // Registration is a step like any other, so a marketplace.json that cannot be rewritten
          // rolls the plugin back instead of leaving one no marketplace lists.
          {
            kind: "patch",
            file: path.join(target.marketplacePath, ".claude-plugin", "marketplace.json"),
            patch: (json) => {
              const plugins = Array.isArray(json.plugins)
                ? (json.plugins as Array<{ name?: string; source?: string; description?: string }>)
                : [];
              if (!plugins.some((p) => p?.name === name)) {
                plugins.push({ name, source: `./plugins/${name}`, description: desc });
              }
              return { ...json, plugins };
            },
          },
        ],
        remaining: "Plugin manifest written and registered. Add a README, then skills or agents.",
        needsModel: false,
      };
    }

    case "create-marketplace": {
      const manifest = {
        name: target.name,
        owner: { name: request.ownerName.trim(), email: request.ownerEmail.trim() },
        metadata: {
          description: request.description.trim(),
          version: "0.1.0",
          ...(request.homepage.trim() ? { homepage: request.homepage.trim() } : {}),
        },
        plugins: [] as unknown[],
      };
      return {
        steps: [
          // The directory first and the repository second, so `git init` runs against something
          // that exists and `mkdirTracked` still owns the undo for the directory itself. Then the
          // files, then the commit — which has to be last to have anything to commit.
          { kind: "dir", dir: target.path },
          { kind: "repo", dir: target.path },
          {
            kind: "file",
            file: path.join(target.path, ".claude-plugin", "marketplace.json"),
            contents: JSON.stringify(manifest, null, 2) + "\n",
          },
          {
            kind: "file",
            file: path.join(target.path, "README.md"),
            contents: `# ${target.name}\n\n${request.description.trim()}\n`,
          },
          { kind: "dir", dir: path.join(target.path, "plugins") },
          {
            kind: "commit",
            dir: target.path,
            message: `chore: scaffold the ${target.name} marketplace`,
            author: { name: request.ownerName.trim(), email: request.ownerEmail.trim() },
          },
        ],
        // What is left is what the app cannot decide for the user: prose, and the two setup steps
        // that need a host, an account and credentials. Those stay conversational deliberately —
        // see the /create-marketplace skill.
        remaining:
          "Enrich README.md and add a CLAUDE.md context file. Then add a git remote and push, and " +
          "configure private-repo access and auto-update if it will not be public — see /create-marketplace.",
        needsModel: true,
      };
    }
  }
}

/**
 * Write everything this request implies that does not need a model.
 *
 * No model is involved, and none can be: nothing here calls out to anything. That is the whole
 * point of the split — the user sees the artifact appear the instant they press Create, and the
 * bridge is offered afterwards for the one part (a skill's prose, an agent's system prompt) that
 * genuinely needs one.
 */
export function scaffoldCreate(
  projectRoot: string,
  request: CreateRequest,
  opts: ScaffoldOptions = {}
): ScaffoldResult {
  const errors = validateCreateRequest(projectRoot, request, opts);
  if (errors.length) {
    return {
      scaffolded: false,
      name: "",
      path: "",
      written: [],
      remaining: "",
      needsModel: false,
      reason: errors.join(" "),
    };
  }

  const target = resolveCreateTarget(projectRoot, request, opts);
  const { steps, remaining, needsModel } = stepsFor(target, request);
  const planned = planRepo(steps, opts.git);
  const res = apply(planned.steps, opts.git);

  if (!res.ok) {
    return {
      scaffolded: false,
      name: target.name,
      path: target.path,
      written: [],
      remaining: "",
      needsModel: false,
      reason: res.reason,
    };
  }

  // `planRepo` said what SHOULD happen; only `apply` knows what did. A git that was present and
  // then failed reports the failure rather than the plan, because a note claiming a repository
  // exists when it does not is worse than no note at all.
  const repo: RepoResult | undefined = res.repoError
    ? {
        initialized: false,
        root: null,
        note: `No repository was created — ${res.repoError} The marketplace itself is complete.`,
      }
    : planned.repo;

  return {
    scaffolded: true,
    name: target.name,
    path: target.path,
    written: res.written,
    remaining,
    needsModel,
    ...(repo ? { repo } : {}),
  };
}
