#!/usr/bin/env node
// Writes a batch of Maestro task files from structured slice data, then syncs
// status.json in the same pass. Used by /to-maestro-tasks (Step 5) once the
// user has approved a slice breakdown, so the model never hand-assembles
// filenames/numbering/the "## Blocked by" section itself.
//
//   node maestro-write-tasks.cjs <path-to-json> [--epic <slug>]
//       `--epic` (`084`) links every written task to that existing epic in the tracker.
//
// <path-to-json> is a JSON array, one entry per slice, already in topological
// order (blockers before dependents):
//
//   [
//     {
//       "title": "Add login form",
//       "whatToBuild": "...",
//       "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
//       "blockedBy": []
//     },
//     {
//       "title": "Wire login to session store",
//       "whatToBuild": "...",
//       "acceptanceCriteria": ["Criterion 1"],
//       "blockedBy": [0]
//     }
//   ]
//
// Each `blockedBy` entry is either an index into this same array, required to
// be less than the entry's own index — the input is expected pre-sorted, this
// only catches a caller that got the order wrong — or a string naming a task
// ALREADY in the queue, by full filename ("083-foo.md") or number ("083"), so a
// new batch can depend on earlier-queued work. Numbering appends after the
// highest existing NNN-*.md (never overwrites), each title is slugged (deduped
// within the batch and against existing files), and `blockedBy` indices are
// resolved into sibling filenames once every filename in the batch is known.
//
// After writing, calls the same sync() the standalone
// `maestro-task-status.cjs sync` uses, so status.json reflects the new files
// and edges immediately — Step 5 and Step 6 collapse into one script call.

const fs = require("fs");
const path = require("path");
const { tasksDir, listTaskFiles, sync } = require("./lib/maestro-tasks.cjs");

// The queue always lives at the repository root's .claude, never a sub .claude
// folder. Starting from CLAUDE_PROJECT_DIR (or cwd), pick the nearest ancestor
// holding .claude/maestro.json, else the git root, else the starting directory.
function findProjectRoot(start) {
  const resolved = path.resolve(start);
  for (let dir = resolved; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".claude", "maestro.json"))) return dir;
    if (path.dirname(dir) === dir) break;
  }
  for (let dir = resolved; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (path.dirname(dir) === dir) break;
  }
  return resolved;
}

const projectDir = findProjectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const jsonPath = process.argv[2];

function fail(message) {
  process.stderr.write(`maestro-write-tasks: ${message}\n`);
  process.exit(1);
}

function slugify(title) {
  const slug = String(title)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "task";
}

function uniqueSlug(base, taken) {
  let slug = base;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  taken.add(slug);
  return slug;
}

function renderBody(slice, blockedByFilenames) {
  const criteria = slice.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");
  const blockedBy =
    blockedByFilenames.length === 0
      ? "None — can start immediately"
      : blockedByFilenames.map((f) => `- \`${f}\``).join("\n");
  return `# ${slice.title}

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

${slice.whatToBuild}

## Acceptance criteria

${criteria}

## Blocked by

${blockedBy}
`;
}

if (!jsonPath) {
  fail("usage: maestro-write-tasks.cjs <path-to-json> [--epic <slug>]");
}

// `084`: `--epic <slug>` links every task this batch writes to that epic, through the tracker's
// `epic` field. The epic must already exist (checked BEFORE anything is written, so a mistyped slug
// leaves the queue untouched).
const epicFlag = process.argv.indexOf("--epic");
const epicSlug = epicFlag === -1 ? null : process.argv[epicFlag + 1];
if (epicFlag !== -1 && !epicSlug) fail("--epic needs an epic name");
let epicLib = null;
if (epicSlug) {
  epicLib = require("./lib/maestro-epic.cjs");
  if (!epicLib.readEpicState(projectDir, epicSlug)) {
    fail(`no epic "${epicSlug}" — create it first with maestro-epic.cjs create ${epicSlug}. Nothing was written.`);
  }
}

let slices;
try {
  slices = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
} catch (err) {
  fail(`could not read/parse ${jsonPath}: ${err.message}`);
}

if (!Array.isArray(slices) || slices.length === 0) {
  fail("input must be a non-empty JSON array of slices");
}

slices.forEach((slice, i) => {
  if (!slice || typeof slice.title !== "string" || !slice.title.trim()) {
    fail(`slice ${i} is missing a non-empty "title"`);
  }
  if (typeof slice.whatToBuild !== "string" || !slice.whatToBuild.trim()) {
    fail(`slice ${i} ("${slice.title}") is missing a non-empty "whatToBuild"`);
  }
  if (!Array.isArray(slice.acceptanceCriteria) || slice.acceptanceCriteria.length === 0) {
    fail(`slice ${i} ("${slice.title}") needs at least one "acceptanceCriteria" entry`);
  }
  const blockedBy = slice.blockedBy || [];
  if (!Array.isArray(blockedBy)) {
    fail(`slice ${i} ("${slice.title}"): "blockedBy" must be an array of indices or task filenames`);
  }
  for (const b of blockedBy) {
    if (typeof b === "string") continue; // an existing task, resolved once the queue is listed
    if (!Number.isInteger(b) || b < 0 || b >= slices.length) {
      fail(`slice ${i} ("${slice.title}"): blockedBy index ${b} is out of range`);
    }
    if (b >= i) {
      fail(
        `slice ${i} ("${slice.title}"): blockedBy index ${b} is not earlier in the batch — ` +
          "input must already be topologically sorted (blockers before dependents)"
      );
    }
  }
});

const dir = tasksDir(projectDir);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const existing = listTaskFiles(projectDir);
const takenSlugs = new Set(
  existing.map((f) => f.replace(/^\d{3}-/, "").replace(/\.md$/, ""))
);
let nextNumber =
  existing.reduce((max, f) => {
    const m = f.match(/^(\d{3})-/);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0) + 1;

// A string blocker must name exactly one task already in the queue.
function resolveExisting(ref, i, title) {
  const match = /^\d{3}$/.test(ref)
    ? existing.filter((f) => f.startsWith(`${ref}-`))
    : existing.filter((f) => f === ref);
  if (match.length !== 1) {
    fail(`slice ${i} ("${title}"): blockedBy "${ref}" does not name exactly one existing task`);
  }
  return match[0];
}

const existingBlockers = slices.map((slice, i) =>
  (slice.blockedBy || []).map((b) => (typeof b === "string" ? resolveExisting(b, i, slice.title) : null))
);

const filenames = slices.map((slice) => {
  const slug = uniqueSlug(slugify(slice.title), takenSlugs);
  const filename = `${String(nextNumber).padStart(3, "0")}-${slug}.md`;
  nextNumber += 1;
  return filename;
});

slices.forEach((slice, i) => {
  const blockedByFilenames = (slice.blockedBy || []).map(
    (b, j) => existingBlockers[i][j] || filenames[b]
  );
  const body = renderBody(slice, blockedByFilenames);
  fs.writeFileSync(path.join(dir, filenames[i]), body, { flag: "wx" });
});

const map = sync(projectDir);
if (epicLib) epicLib.linkTasks(projectDir, epicSlug, filenames);
const counts = Object.values(map).reduce(
  (c, v) => {
    c[v.status] = (c[v.status] || 0) + 1;
    return c;
  },
  { done: 0, ready: 0, blocked: 0 }
);

const range =
  filenames.length === 1 ? filenames[0] : `${filenames[0]}–${filenames[filenames.length - 1]}`;
process.stdout.write(
  `Maestro tasks: wrote ${range} — ` +
    `${Object.keys(map).length} task(s): ${counts.done} done, ${counts.ready} ready, ${counts.blocked} blocked` +
    (epicSlug ? ` — linked to epic "${epicSlug}"` : "") +
    "\n"
);
