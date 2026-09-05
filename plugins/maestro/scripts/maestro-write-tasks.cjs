#!/usr/bin/env node
// Writes a batch of Maestro task files from structured slice data, then syncs
// status.json in the same pass. Used by /to-maestro-tasks (Step 5) once the
// user has approved a slice breakdown, so the model never hand-assembles
// filenames/numbering/the "## Blocked by" section itself.
//
//   node maestro-write-tasks.cjs <path-to-json>
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
// `blockedBy` is a list of indices into this same array, each required to be
// less than the entry's own index — the input is expected pre-sorted, this
// only catches a caller that got the order wrong. Numbering appends after the
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

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
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
  fail("usage: maestro-write-tasks.cjs <path-to-json>");
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
    fail(`slice ${i} ("${slice.title}"): "blockedBy" must be an array of indices`);
  }
  for (const b of blockedBy) {
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

const filenames = slices.map((slice) => {
  const slug = uniqueSlug(slugify(slice.title), takenSlugs);
  const filename = `${String(nextNumber).padStart(3, "0")}-${slug}.md`;
  nextNumber += 1;
  return filename;
});

slices.forEach((slice, i) => {
  const blockedByFilenames = (slice.blockedBy || []).map((b) => filenames[b]);
  const body = renderBody(slice, blockedByFilenames);
  fs.writeFileSync(path.join(dir, filenames[i]), body, { flag: "wx" });
});

const map = sync(projectDir);
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
    `${Object.keys(map).length} task(s): ${counts.done} done, ${counts.ready} ready, ${counts.blocked} blocked\n`
);
