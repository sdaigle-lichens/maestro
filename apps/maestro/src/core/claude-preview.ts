// Preview — build the prompt, report whether the CLI exists, issue the token. Spawn nothing.
//
// ┌─ READ THIS BEFORE ADDING AN IMPORT ────────────────────────────────────────────────────────┐
// │ This module must never be able to start a process. Not "does not currently", CANNOT: it     │
// │ imports no `node:child_process`, and neither does anything it imports. `test/claude.test.ts` │
// │ walks the transitive import graph of this file and fails if a spawn reaches it.             │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// The preview/run split is the security design, not an implementation detail, and this half is
// where the property lives. Two operations exist so that the prompt the user was shown and the
// prompt that executes are the same object: preview builds it and hands back a token; run accepts
// the token and nothing else (see `claude-tokens.ts`). Collapse them into one "run this prompt"
// call and the app can execute a string the user never saw, while the diff looks like a
// simplification. If that is ever proposed, the thing being removed is the guarantee.
//
// Availability is reported HERE rather than discovered at spawn time for the same reason: the UI
// has to be able to say "the CLI was not found, here is where I looked" while the Run button is
// still un-pressed. `claude-cli.ts` decides it with `fs`, which is why it can live on this side.

import fs from "node:fs";
import path from "node:path";
import { readSkillsFromDir } from "@repo/claude-fs";
import { cliNotFoundMessage, resolveClaudeCli, type ResolveOptions } from "./claude-cli.js";
import { issueInvocation } from "./claude-tokens.js";
import { buildReadScope } from "./read-scope.js";
import { enclosingRepo } from "./repo.js";
import { resolveCreateTarget } from "./scaffold.js";
import { readAllSkillTags } from "./skill-tags.js";
import { tasksDirFor } from "./tasks.js";
import { joinOxford } from "./text.js";
import type {
  ClaudePreview,
  ClaudeReadScope,
  ClaudeRequest,
  ClaudeWriteTarget,
  CreateRequest,
  HandoffContext,
  SettingsPort,
} from "./contracts.js";

export type { ClaudePreview, ClaudeReadScope, ClaudeRequest, ClaudeWriteTarget, HandoffContext };

/**
 * The create-\* request kinds a session pane can be handed through `buildHandoff`. `update-skill-tags`
 * is also handoff-able but built separately (`buildUpdateSkillTagsHandoff`) since it has no scaffold
 * and no single artifact — see the branch in `previewClaudeRun` below.
 */
const HANDOFF_KINDS = ["create-skill", "create-subagent", "create-plugin", "create-marketplace"] as const;

/**
 * What the preview needs beyond the CLI resolution options.
 *
 * `settings` is a PORT, not an import, and the reason is the box at the top of this file: resolving
 * the cascade lives in the Agent SDK, which can start processes. Handed in, it cannot appear in
 * this module's import graph. Left out — which is what every test in `test/core/` does unless it is
 * testing this specifically — the disclosure says the settings were not consulted rather than
 * quietly presenting the app's own intent as the effective configuration.
 */
export interface PreviewOptions extends ResolveOptions {
  settings?: SettingsPort;
}

/**
 * The equivalent command line, before the prompt — one flag, and no permission mode at all.
 *
 * `-p` is headless print mode: one prompt, output to stdout, no interactive session.
 *
 * There used to be a second pair here, `--permission-mode acceptEdits`, because a run whose job was
 * to author a file could not stop to ask about writing it and print mode had nobody to ask. It is
 * gone: a run is an Agent SDK session now, the host process **is** somebody to ask, and the app
 * answers for exactly the paths this preview listed in `targets` (see `write-scope.ts`). That is
 * strictly narrower than the flag it replaces, which permitted writing anything anywhere under the
 * working directory. There is no longer a difference between an authoring invocation and an asking
 * one at this level — the difference is the write scope, and it is on screen as a list of paths
 * rather than as a flag the reader has to know the meaning of.
 *
 * What `argv` therefore is: the **equivalent** invocation, and the thing Copy prompt exists for. The
 * app runs it through the SDK, which adds its own stream-protocol flags; the exact argv it spawned
 * comes back on `ClaudeRunResult.argv`.
 */
export const CLAUDE_BASE_FLAGS = ["-p"] as const;

interface BuiltRequest {
  prompt: string;
  targets: ClaudeWriteTarget[];
  /**
   * Where to run, when that is not the open project.
   *
   * A create-* flow can write into a marketplace repo or a brand-new marketplace directory, both of
   * which sit outside the project the window has open. The cwd is derived here, from the same
   * resolution that chose the path, and the modal shows it; it is never taken from the caller. It
   * is also what the run can READ, so the choice is a disclosure and not only a convenience.
   */
  cwd?: string;
}

/**
 * The finishing prompt for a create-* flow, and the file it may touch.
 *
 * FACTS ONLY, PLUS THE NAME OF THE SKILL THAT HOLDS THE GUIDANCE. That split is `026`'s, and it is
 * the whole shape of this function:
 *
 *   • It names an artifact that ALREADY EXISTS. The deterministic scaffold ran when the form was
 *     submitted, so the run's job is to finish a file, not to create one — and the path comes from
 *     `resolveCreateTarget`, the same resolution the scaffold wrote with, so the prompt cannot name
 *     a different file than the one on disk.
 *   • It forbids touching the frontmatter. The `description:` was computed by `buildDesc` and shown
 *     in the form's live preview; a model rewriting it would silently replace the string the user
 *     approved with one they never saw.
 *   • It carries the FORM'S OWN WORDS — the name, the idea, the triggers — because they are facts
 *     about this artifact that exist nowhere else.
 *   • It carries NO authoring guidance. "Write it as a domain expert would", the README's sections,
 *     the private-repo env vars: all of that used to be inlined here AND written in the matching
 *     `SKILL.md`, two copies with nothing to catch them drifting. The prompt names the skill
 *     instead, and `SESSION_SKILLS` in `agent-sdk.ts` is what makes the name resolvable on both app
 *     entries — the headless run and the pane. One source, for the app and the terminal both.
 *   • It is still prose, NOT a slash command. That rule outlives its original reason (M5 deleted
 *     the `UserPromptExpansion` hook that launched the Docker app and blocked on a form submission
 *     a headless run could never make): a slash command re-enters the skill from the top, where
 *     naming it as a skill lets the model arrive holding what the form already decided.
 *     `test/core/create-preview.test.ts` asserts no create prompt contains one.
 */
function buildCreate(projectRoot: string, request: CreateRequest, opts: ResolveOptions): BuiltRequest {
  const target = resolveCreateTarget(projectRoot, request, { home: opts.home });
  // Marketplace-bound artifacts (and a brand-new marketplace) live outside the open project, so
  // that repo is the working directory — see `BuiltRequest.cwd`.
  const cwd = target.marketplacePath || projectRoot;
  const preamble = [
    `The deterministic scaffold has already written ${target.path}, with its frontmatter/manifest complete.`,
    `Do not recreate it, do not move it, and do not change its frontmatter — the description shown there is the one the user approved.`,
    // The one line that replaces the deleted instructions. Named rather than pasted: the skill
    // describes this exact entry — the artifact exists, its fields are decided, nothing is re-asked.
    `Follow the ${request.kind} skill for how to finish it; this is the app entry it describes, so do not re-ask for anything below.`,
    "",
  ];
  const only = (file: string, note: string): ClaudeWriteTarget[] => [{ path: file, action: "modify", note }];

  switch (request.kind) {
    case "create-skill":
      return {
        prompt: [
          ...preamble,
          `The work: author the body of that SKILL.md, replacing the placeholder comment.`,
          "",
          `Skill name: ${target.name}`,
          `Idea: ${request.idea.trim()}`,
          `Use when: ${request.useWhen.length ? joinOxford(request.useWhen) : "(no triggers given)"}`,
        ].join("\n"),
        targets: only(target.path, "The scaffolded skill file — its body is rewritten, its frontmatter is not."),
        cwd,
      };

    case "create-subagent":
      return {
        prompt: [
          ...preamble,
          `The work: author the body of that agent file, replacing the placeholder comment.`,
          "",
          `Subagent name: ${target.name}`,
          `Idea: ${(request.mode === "auto" ? request.idea : request.description).trim()}`,
          `When to apply: ${request.triggers.length ? joinOxford(request.triggers) : "(no triggers given)"}`,
          `Tools: ${request.tools.length ? request.tools.join(", ") : "(unrestricted)"}`,
        ].join("\n"),
        targets: only(target.path, "The scaffolded agent file — its body is rewritten, its frontmatter is not."),
        cwd,
      };

    case "create-plugin":
      return {
        prompt: [
          ...preamble,
          `The plugin.json manifest and the skills/ directory exist, and the plugin is registered in the`,
          `marketplace's marketplace.json.`,
          `The work: write ${path.join(target.path, "README.md")}. Change nothing else.`,
          "",
          `Plugin name: ${target.name}`,
          `Description: ${request.description.trim()}`,
          `Keywords: ${request.keywords.length ? request.keywords.join(", ") : "(none)"}`,
        ].join("\n"),
        targets: [{ path: path.join(target.path, "README.md"), action: "create", note: "The plugin's README." }],
        cwd,
      };

    case "create-marketplace":
      return {
        prompt: [
          ...preamble,
          `The work: enrich the starter README.md and write a CLAUDE.md beside it. Do not edit marketplace.json.`,
          // Repository setup left this prompt when it became a scaffold step, and the run is told
          // the OUTCOME instead — read off the disk the scaffold just wrote, so the sentence is true
          // in both cases rather than a claim about what should have happened. Left unsaid, a model
          // finishing a marketplace reasonably reaches for `git init` and either nests a repository
          // or re-commits the scaffold under its own authorship. Remotes and private-repo access
          // are still the user's to arrange; they are not this run's either.
          enclosingRepo(target.path)
            ? `The directory is already a git repository with the scaffold committed: do not run git.`
            : `The directory is not a git repository and the app could not make it one: do not run git — the user will.`,
          // The FLAG, not what it implies. The env-var table it used to spell out lives in the
          // skill, which is the only place it can be corrected once.
          request.privateRepo ? `\nThis marketplace will live in a PRIVATE repository.` : "",
          "",
          `Marketplace name: ${target.name}`,
          `Description: ${request.description.trim()}`,
          `Owner: ${request.ownerName.trim()} <${request.ownerEmail.trim()}>`,
        ]
          .filter((line) => line !== "")
          .join("\n"),
        targets: [
          { path: path.join(target.path, "README.md"), action: "modify", note: "The starter README, enriched." },
          { path: path.join(target.path, "CLAUDE.md"), action: "create", note: "Context for sessions opened here." },
        ],
        cwd,
      };
  }
}

/**
 * This project's own skills — `<projectRoot>/.claude/skills/`, the one source `update-skill-tags`
 * works over — as a description-and-tags-only table.
 *
 * Deliberately NOT `discoverSkills()` from `discovery.ts`: that module imports `node:child_process`
 * (for the `vibe-rules` CLI), and this one may not — see the box at the top of this file. Reading
 * `readSkillsFromDir` + `readAllSkillTags` directly keeps the same guarantee `claude.test.ts` walks
 * for, at the cost of duplicating a two-line merge `discoverSkills` also does.
 */
async function projectSkillsForTagging(
  projectRoot: string
): Promise<Array<{ id: string; description: string; tags: string[] }>> {
  const skills = await readSkillsFromDir(path.join(projectRoot, ".claude", "skills"));
  const tagsById = readAllSkillTags();
  return skills.map((s) => ({ id: s.name, description: s.description, tags: tagsById[s.name] ?? [] })).sort((a, b) => a.id.localeCompare(b.id));
}

/** The seeded table's own row format — one line per skill, id/description/tags only. */
function skillTagsRow(s: { id: string; description: string; tags: string[] }): string {
  return `| ${s.id} | ${s.description || "(none)"} | ${s.tags.length ? s.tags.join(", ") : "(none)"} |`;
}

/**
 * The `update-skill-tags` request: no scaffold, no artifact — a table of this project's skills'
 * CURRENT descriptions and tags, and nothing else about them (never the skill's own SKILL.md body).
 * That is the whole point of building the prompt from this table rather than handing the session
 * `Read` access to every skill file: the context stays small on purpose.
 */
async function buildUpdateSkillTags(projectRoot: string): Promise<BuiltRequest> {
  const skills = await projectSkillsForTagging(projectRoot);
  const skillsDir = path.join(projectRoot, ".claude", "skills");
  const table =
    skills.length > 0
      ? [`| id | description | tags |`, `| --- | --- | --- |`, ...skills.map(skillTagsRow)].join("\n")
      : "(no skills found under .claude/skills/)";
  return {
    prompt: [
      `The work: for every row below missing a description, propose one from the skill's id/name`,
      `alone; for every row with a description but no tags, propose tags from the fixed set`,
      `(backend, frontend, mobile, refactor, reviewer, scribe, test) derived from the description`,
      `text; for every already-tagged row, re-derive tags the same way and flag any change. A row`,
      `with no description and no usable signal in its id may be skipped — say so rather than`,
      `guessing. Present the full proposed table and wait for the user to confirm before writing`,
      `anything. Follow the update-skill-tags skill for exactly how to apply what's confirmed.`,
      "",
      table,
    ].join("\n"),
    targets: [
      { path: skillsDir, action: "modify", note: "Only a skill's own SKILL.md frontmatter `description:` field." },
    ],
  };
}

function buildUpdateSkillTagsHandoff(projectRoot: string, state: string): HandoffContext {
  const skillsDir = path.join(projectRoot, ".claude", "skills");
  const repo = enclosingRepo(skillsDir);
  return {
    kind: "update-skill-tags",
    name: "skill tags",
    artifact: skillsDir,
    writeScope: skillsDir,
    scope: "directory",
    state: state.length > HANDOFF_STATE_CAP ? `${state.slice(0, HANDOFF_STATE_CAP)}…` : state,
    repo: repo
      ? `already inside the git repository at ${repo}.`
      : `not inside a git repository — this flow never runs git either way.`,
  };
}

/** How much of the scaffolded state a handoff carries. A seed is context, not a file viewer. */
const HANDOFF_STATE_CAP = 1200;

/** How many entries of an artifact DIRECTORY are listed before the rest are counted. */
const HANDOFF_LISTING_CAP = 20;

/**
 * What the scaffold left on disk, read at preview time — the artifact's frontmatter, or its files.
 *
 * Read here rather than taken from `ScaffoldResult`, and that is the whole point: the renderer holds
 * a `ScaffoldResult`, and a handoff that trusted it would be a renderer describing what a session
 * may write. This module already resolves the same path the scaffold wrote to, and by the time a
 * preview is built that file exists — so the seed describes the disk rather than a message.
 *
 * Never throws. A missing or unreadable artifact produces a sentence saying so: a preview is still
 * worth having, and "the app could not read it back" is a more useful thing for the model to be
 * told than an absent section.
 */
function scaffoldedState(target: string): string {
  try {
    if (fs.statSync(target).isDirectory()) {
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const listed = entries
        .slice(0, HANDOFF_LISTING_CAP)
        .map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`)
        .join("\n");
      const more = entries.length - Math.min(entries.length, HANDOFF_LISTING_CAP);
      return more > 0 ? `${listed}\n… and ${more} more` : listed || "(the directory is empty)";
    }
    const body = fs.readFileSync(target, "utf8");
    // The frontmatter alone when there is one: it is the part the user approved in the form's live
    // preview and the part the finishing prompt forbids touching, and the body below it is the
    // placeholder the run is being asked to replace.
    const match = /^---\n([\s\S]*?)\n---/.exec(body);
    const text = match ? `---\n${match[1]}\n---` : body;
    return text.length > HANDOFF_STATE_CAP ? `${text.slice(0, HANDOFF_STATE_CAP)}…` : text;
  } catch (err) {
    return `(the app could not read ${target} back: ${err instanceof Error ? err.message : String(err)})`;
  }
}

/**
 * What continuing this create-\* preview in the pane would open.
 *
 * ONE DIRECTORY, RESOLVED HERE. `target.dir` is the directory the scaffold made for this artifact,
 * or "" when the artifact is a lone file in a directory it shares — see `CreateTarget.dir`. Falling
 * back to the file is the narrower of the two answers and the right way to be wrong: a handoff that
 * silently opened `.claude/agents/` would be granting write access to every other agent in the
 * project on the strength of a form about one of them.
 */
function buildHandoff(projectRoot: string, request: CreateRequest, opts: ResolveOptions): HandoffContext {
  const target = resolveCreateTarget(projectRoot, request, { home: opts.home });
  const repo = enclosingRepo(target.path);
  return {
    kind: request.kind,
    name: target.name,
    artifact: target.path,
    writeScope: target.dir || target.path,
    scope: target.dir ? "directory" : "file",
    state: scaffoldedState(target.path),
    repo: repo
      ? `already inside the git repository at ${repo}, with the scaffold's work committed or staged there — do not run git init.`
      : `not inside a git repository, and the app did not make one — do not run git; the user will.`,
  };
}

/**
 * The prompt for one request kind, and the paths it may touch.
 *
 * Every branch here is a prompt the app can execute; there is no branch that takes prompt text from
 * the caller. Adding a kind means adding a case, which is the review surface this design is for.
 */
async function build(projectRoot: string, request: ClaudeRequest, opts: ResolveOptions): Promise<BuiltRequest> {
  switch (request?.kind) {
    case "update-skill-tags":
      return buildUpdateSkillTags(projectRoot);
    case "maestro-task": {
      // basename, not the path as given: a request must not be able to name a file outside the
      // tasks directory, and `filename` crosses a process boundary.
      const filename = path.basename(String(request.filename ?? ""));
      const file = path.join(tasksDirFor(projectRoot), filename);
      if (!filename.endsWith(".md") || !fs.existsSync(file)) {
        throw new Error(`No such task: ${filename || "(none given)"}`);
      }
      const relativePath = path.posix.join(".claude", "maestro-tasks", filename);
      return {
        // The same sentence /maestro-tasks offers as "Copy prompt" — running it here and pasting
        // it into a session by hand must produce the same session.
        prompt: `Use /maestro to complete the task described in file ${relativePath}`,
        targets: [
          {
            path: projectRoot,
            action: "unknown",
            note:
              "A task decides what it edits, so the run can write anywhere in this project. " +
              "Read the task before confirming.",
          },
        ],
      };
    }
    case "create-skill":
    case "create-subagent":
    case "create-plugin":
    case "create-marketplace":
      return buildCreate(projectRoot, request, opts);
    default:
      throw new Error(`Unsupported Claude request: ${JSON.stringify(request)}`);
  }
}

/**
 * What the run will be able to READ, resolved rather than assumed.
 *
 * Never throws. A cascade that cannot be resolved — no port supplied, an SDK that failed to load,
 * an unreadable settings file — still produces a scope naming the working directory, with
 * `unresolved` saying why the rest is unknown. The alternative, failing the whole preview, would
 * cost the user the prompt and the Copy-prompt fallback over a disclosure detail; the alternative
 * of silently reporting only the cwd would be worse still, since it reads as a complete answer.
 */
async function readScopeFor(
  projectRoot: string,
  cwd: string,
  targets: ClaudeWriteTarget[],
  settings: SettingsPort | undefined
): Promise<ClaudeReadScope> {
  if (!settings) {
    return buildReadScope({
      projectRoot,
      cwd,
      targets,
      settings: null,
      unresolved: "The settings files on disk were not consulted for this preview.",
    });
  }
  try {
    return buildReadScope({ projectRoot, cwd, targets, settings: await settings.resolve(cwd) });
  } catch (err) {
    return buildReadScope({
      projectRoot,
      cwd,
      targets,
      settings: null,
      unresolved: `The settings files on disk could not be read: ${err instanceof Error ? err.message : String(err)}.`,
    });
  }
}

/**
 * Build the invocation the confirmation modal shows, and authorise it.
 *
 * Pure with respect to the machine: it reads the project to build the prompt, reads directories to
 * find the CLI, and reads the settings cascade through the injected port. It writes nothing
 * anywhere and — the property the box at the top of this file is about — it cannot spawn.
 *
 * Async because of that last read. The cascade is genuinely on disk and genuinely worth waiting
 * for: the confirmation's claim about what a run can see is only true if something actually looked.
 */
export async function previewClaudeRun(
  projectRoot: string,
  request: ClaudeRequest,
  opts: PreviewOptions = {}
): Promise<ClaudePreview> {
  if (!projectRoot) throw new Error("No project is open.");
  const built = await build(projectRoot, request, opts);
  const { prompt, targets } = built;
  // The open project unless the request resolved somewhere else — a create-* flow writing into a
  // marketplace repo runs there, so its edits are inside the CLI's working directory.
  const cwd = built.cwd ?? projectRoot;
  const cli = resolveClaudeCli(opts);
  // Resolved against the run's OWN cwd, not the open project: project-tier settings are read
  // relative to where the session starts, and for a create-* flow that is the marketplace.
  const read = await readScopeFor(projectRoot, cwd, targets, opts.settings);

  // argv[0] is the resolved path rather than the bare name, so what the modal shows is the exact
  // executable that will run — "claude" would be a claim about PATH resolution the user cannot check.
  const args = [...CLAUDE_BASE_FLAGS, prompt];
  const argv = [cli.bin ?? "claude", ...args];

  // What continuing in the pane would open, resolved whether or not a CLI exists — the dialog shows
  // it beside the prompt, and a machine with no CLI has no session to hand off into but is still
  // owed an honest account of what the button would have done.
  const handoff =
    request?.kind === "update-skill-tags"
      ? buildUpdateSkillTagsHandoff(projectRoot, prompt)
      : (HANDOFF_KINDS as readonly string[]).includes(request?.kind)
        ? buildHandoff(projectRoot, request as CreateRequest, opts)
        : null;

  if (!cli.available) {
    // No token: there is nothing runnable to authorise. The prompt and argv are still returned in
    // full — Copy prompt is the whole fallback, and it must work in exactly this state. The read
    // scope comes too: a user about to paste this into their own session is about to grant it.
    return {
      token: null,
      prompt,
      argv,
      cwd,
      targets,
      read,
      handoff,
      available: false,
      bin: null,
      searched: cli.searched,
      unavailable: cliNotFoundMessage(cli),
      expiresAt: 0,
    };
  }

  // `writable` is the same list the dialog renders under "What it may write" — not a second
  // derivation of it. The permission callback the run installs reads it off the invocation, so what
  // the user was shown and what the session will allow are one value that travels together.
  const invocation = issueInvocation({
    purpose: "claude",
    bin: cli.bin!,
    args,
    cwd,
    prompt,
    writable: targets.map((t) => t.path),
    // The pane's half of the same authorisation. One token, two ways to spend it — a headless run
    // or a conversation — and claiming it for either consumes it, so a preview cannot do both.
    handoff,
  });
  return {
    token: invocation.token,
    prompt,
    argv,
    cwd,
    targets,
    read,
    handoff,
    available: true,
    bin: cli.bin,
    searched: cli.searched,
    unavailable: null,
    expiresAt: invocation.expiresAt,
  };
}
