#!/usr/bin/env node
// Maestro concept-skill index. The deterministic half of /create-concept-skills,
// /update-concept-skills and /update-single-concept-skill: finding the skills,
// doing the version arithmetic, rewriting the frontmatter markers, and stamping
// <cwd>/.claude/maestro.json. The skills spend their tokens on judgement; this
// spends none on arithmetic.
//
//   node maestro-concept-skills.cjs list [--json]
//       Every concept skill under the project root — from EVERY .claude/skills in
//       the tree, not just the root's, so a monorepo's per-app skills are found.
//       Reports id, path, version, last-update, and the sub-concept / agent-note
//       file counts. --json for one line of machine-readable output.
//
//   node maestro-concept-skills.cjs agents
//       The project's `agents_available` from maestro.json, as a JSON array — the
//       list /update-single-concept-skill writes agents/<agent>.md notes for. `[]`
//       when the project has no maestro.json, which means "write none".
//
//   node maestro-concept-skills.cjs state
//       The `concept_skills` block from maestro.json, or {"present": false} when
//       no list has been created yet. This is what /create-concept-skills reads
//       to decide whether to run at all.
//
//   node maestro-concept-skills.cjs stamp <id-or-dir> --bump minor|major [--sha <sha>]
//       Rewrite one skill's three marker lines. --bump initial sets 1.0 for a
//       skill being marked for the first time. --sha defaults to HEAD.
//
//   node maestro-concept-skills.cjs state-set --bump minor|major|initial [--sha <sha>]
//       The same, for the repo-level `concept_skills` block on maestro.json.
//       No-ops (reporting written:false) when the project has no maestro.json —
//       a repo can have concept skills without Maestro installed.
//
// Every command takes an optional --root <dir> naming the repository to act on,
// so this can be pointed at a project other than the one the session is in — the
// same `projectRoot`-as-an-argument shape every module under apps/maestro/src/core
// uses. Default: $CLAUDE_PROJECT_DIR, then the process's cwd.
//
// All logic lives in lib/maestro-concept-skills.cjs, generated from
// apps/maestro/src/core/concept-skills.ts, so the app and these skills share one
// implementation. Unlike the hook scripts this is NOT copied into a project — the
// skills call it at ${CLAUDE_PLUGIN_ROOT}/scripts/.

const { execFileSync } = require("child_process");
const path = require("path");
const {
  INITIAL_VERSION,
  readAgentsAvailable,
  bumpMinor,
  bumpMajor,
  discoverConceptSkills,
  findConceptSkill,
  resolveSkillPath,
  stampConceptSkill,
  readConceptSkillsState,
  writeConceptSkillsState,
} = require("./lib/maestro-concept-skills.cjs");

const argv = process.argv.slice(2);
const command = argv[0];

function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? null);
}

// Resolved once, here, and passed down as an argument — never re-derived inside a command. The
// env var is what a hook or a session sets; --root is how the desktop app (or a user) points this
// at a repository that is not the one the process was launched in; cwd is the honest last resort.
const projectDir = path.resolve(flag("root") || process.env.CLAUDE_PROJECT_DIR || process.cwd());

function has(name) {
  return argv.includes(`--${name}`);
}

// The sha is resolved here rather than in the skill prose: a model asked to "use the
// current commit" reaches for Bash anyway, and the scribe agent has Bash disallowed.
function headSha() {
  try {
    return execFileSync("git", ["-C", projectDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function nextVersion(current, bump) {
  if (bump === "major") return bumpMajor(current);
  if (bump === "minor") return bumpMinor(current);
  if (bump === "initial") return INITIAL_VERSION;
  return null;
}

function die(msg) {
  process.stderr.write(`maestro-concept-skills: ${msg}\n`);
  process.exit(1);
}

(async () => {
  if (command === "list") {
    const skills = await discoverConceptSkills(projectDir);
    const rows = skills.map((s) => ({
      id: s.id,
      path: s.skillPath,
      version: s.version,
      lastUpdate: s.lastUpdate,
      subConcepts: s.subConcepts.length,
      agentNotes: s.agentNotes.length,
    }));
    if (has("json")) {
      process.stdout.write(JSON.stringify({ count: rows.length, skills: rows }) + "\n");
      process.exit(0);
    }
    if (rows.length === 0) {
      process.stdout.write("No concept skills found. Run /create-concept-skills to build the list.\n");
      process.exit(0);
    }
    process.stdout.write(`${rows.length} concept skill(s):\n`);
    for (const r of rows) {
      const sha = r.lastUpdate ? r.lastUpdate.slice(0, 8) : "unstamped";
      process.stdout.write(
        `  ${r.id}  v${r.version}  @${sha}  ${r.subConcepts} sub-concept(s), ${r.agentNotes} agent note(s)\n    ${r.path}\n`
      );
    }
    process.exit(0);
  }

  if (command === "state") {
    const state = readConceptSkillsState(projectDir);
    process.stdout.write(JSON.stringify(state ? { present: true, ...state } : { present: false }) + "\n");
    process.exit(0);
  }

  if (command === "stamp") {
    const target = argv[1];
    if (!target || target.startsWith("--")) die("stamp needs a skill id or directory");
    const bump = flag("bump");
    const skill = await findConceptSkill(projectDir, target);

    // An unmarked skill has no version to bump — marking it IS the initial stamp.
    const current = skill ? skill.version : null;
    const version = nextVersion(current, bump ?? (skill ? null : "initial"));
    if (!version) die("stamp needs --bump minor|major|initial");

    // A skill that is not marked YET is the create flow's normal case, so fall back to a
    // whole-tree lookup rather than requiring the marker to already be there.
    const skillPath = skill ? skill.skillPath : await resolveSkillPath(projectDir, target);
    if (!skillPath) die(`no skill "${target}" found under ${projectDir}`);
    const lastUpdate = flag("sha") || headSha();
    try {
      stampConceptSkill(skillPath, { version, lastUpdate });
    } catch (err) {
      die(err.message);
    }
    process.stdout.write(JSON.stringify({ stamped: skillPath, version, lastUpdate }) + "\n");
    process.exit(0);
  }

  if (command === "agents") {
    process.stdout.write(JSON.stringify(readAgentsAvailable(projectDir)) + "\n");
    process.exit(0);
  }

  if (command === "state-set") {
    const bump = flag("bump");
    const current = readConceptSkillsState(projectDir);
    const version = nextVersion(current ? current.version : null, bump ?? "initial");
    if (!version) die("state-set needs --bump minor|major|initial");
    const last_update = flag("sha") || headSha();
    const written = writeConceptSkillsState(projectDir, { version, last_update });
    process.stdout.write(JSON.stringify({ written, version, last_update }) + "\n");
    process.exit(0);
  }

  process.stderr.write(
    "maestro-concept-skills: unknown command. Usage:\n" +
      "  maestro-concept-skills.cjs list [--json]\n" +
      "  maestro-concept-skills.cjs state\n" +
      "  maestro-concept-skills.cjs agents\n" +
      "  maestro-concept-skills.cjs stamp <id-or-dir> --bump minor|major|initial [--sha <sha>]\n" +
      "  maestro-concept-skills.cjs state-set --bump minor|major|initial [--sha <sha>]\n" +
      "\n" +
      "Every command also takes --root <dir> (default: $CLAUDE_PROJECT_DIR, then cwd).\n"
  );
  process.exit(1);
})().catch((err) => {
  process.stderr.write(`maestro-concept-skills: ${err.message}\n`);
  process.exit(1);
});
