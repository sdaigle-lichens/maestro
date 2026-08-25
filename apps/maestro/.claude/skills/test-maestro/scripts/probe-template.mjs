// Worked example: drive the packaged Maestro build and assert on what the window actually does.
//
// Runnable as-is — it creates its own fixture, so it is also the fastest way to check that the
// harness still works after an app change:
//
//   node .claude/skills/test-maestro-desktop/scripts/probe-template.mjs
//
// Copy it to the scratchpad and edit it for whatever you are actually testing. Keep the shape:
// one `record()` line per claim, a summary, and a non-zero exit when something fails — a probe
// that prints a wall of state and leaves you to eyeball it will quietly stop being run.

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { withApp, openProjectAt, overlaps } from "./cdp.mjs";

const REPO = "/home/superadmin/gits/ai-dev-tools";
const APP = `${REPO}/apps/maestro`;
const ELECTRON = `${APP}/node_modules/.bin/electron`;
// Fixture roots live under ~/gits and nowhere else — opening a project GRANTS its root to a live
// Claude session, so the fixture path is a permission decision, not a temp-file convenience. See
// the Fixtures section of SKILL.md. `PROBE_DIR` is honoured, but keep it under ~/gits too.
const TMP = process.env.PROBE_DIR ?? `${homedir()}/gits/maestro-probe`;
const PROJ = `${TMP}/fixture`;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (detail !== undefined) console.log("      " + JSON.stringify(detail));
}

// ── Fixture: a workflow whose nodes carry NO positions, so dagre has to lay it out ──────────
rmSync(TMP, { recursive: true, force: true });
mkdirSync(`${PROJ}/.claude`, { recursive: true });
writeFileSync(
  `${PROJ}/.claude/maestro.json`,
  JSON.stringify(
    {
      version: 3,
      agents_available: ["backend", "frontend", "reviewer"],
      skills_available: ["tdd"],
      workflow_instances: [
        { name: "impl", agent: "backend", loaded_skills: ["tdd"], referenced_skills: [] },
        { name: "ui", agent: "frontend", loaded_skills: [], referenced_skills: [] },
        { name: "review", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
      ],
      workflows: [
        {
          name: "unpositioned",
          nodes: [
            { id: "n1", type: "agent", instance: "impl" },
            { id: "n2", type: "agent", instance: "ui" },
            { id: "n3", type: "human_review" },
            { id: "n4", type: "agent", instance: "review" },
          ],
          edges: [
            { from: "n1", to: "n2", kind: "success" },
            { from: "n2", to: "n3", kind: "success" },
            { from: "n3", to: "n4", kind: "condition", label: "approved" },
          ],
        },
      ],
      rules: [],
    },
    null,
    2,
  ),
);

// ── Pass 1: first paint, dagre layout, drag, label edit, save ───────────────────────────────
const pass1 = await withApp(
  { appDir: APP, electron: ELECTRON, port: 9422, userDataDir: `${TMP}/udd`, sampler: true },
  async (cdp, { errors }) => {
    await openProjectAt(cdp, PROJ, "#/workflows");
    await cdp.waitFor(`!!document.querySelector(".react-flow__node")`, { label: "canvas nodes" });
    await new Promise((r) => setTimeout(r, 700)); // let fitView settle

    const g = await cdp.geometry();
    // Summarise in the page — never ship the raw sample array over CDP (see sampleSummary).
    const samples = await cdp.sampleSummary();

    // dragNode picks a safe grab point and throws if the node didn't actually move.
    const dragged = await cdp.dragNode("n2", 130, 110);

    // Edit the condition-edge label via the ✎ button beside it.
    await cdp.clickElement(`
      const span = [...document.querySelectorAll(".react-flow__edgelabel-renderer span")]
        .find(s => s.textContent.trim() === "approved");
      return span?.parentElement.querySelector('button[title="Edit label"]');
    `);
    await cdp.waitFor(`!!document.body.innerText.match(/Edit condition label/)`, {
      label: "label modal",
    });
    await cdp.setInputValue("textarea", "ship it");
    await cdp.clickElement(`
      return [...document.querySelectorAll("button")]
        .find(b => b.innerText.trim() === "Save" && b.closest(".absolute.inset-0"));
    `);
    await new Promise((r) => setTimeout(r, 300));

    // Save, and wait for the toast rather than a fixed sleep. jsClick, not clickElement: the
    // left pane scrolls, and this button is below the fold whenever the agent list is long.
    await cdp.jsClick(`
      return [...document.querySelectorAll("button")].find(b => /Save workflows/.test(b.innerText));
    `);
    await cdp.waitFor(`!!document.body.innerText.match(/Saved to/)`, { label: "save toast" });

    return { g, samples, dragged, errors };
  },
);

{
  const real = pass1.g.nodes.filter((n) => n.id !== "main-session");
  const distinct = new Set(real.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`));
  record("dagre lays unpositioned nodes at distinct positions", distinct.size === real.length, {
    nodes: real.length,
    distinct: distinct.size,
  });

  const pairs = [];
  for (let i = 0; i < pass1.g.nodes.length; i++)
    for (let j = i + 1; j < pass1.g.nodes.length; j++)
      if (overlaps(pass1.g.nodes[i], pass1.g.nodes[j]))
        pairs.push([pass1.g.nodes[i].id, pass1.g.nodes[j].id]);
  record("dagre produces no overlapping nodes", pairs.length === 0, { overlapping: pairs });

  // Assert the sampler actually sampled BEFORE asserting anything about the frames it captured —
  // otherwise "no frame showed X" is trivially true over an empty array and proves nothing.
  const s = pass1.samples;
  record("the frame sampler captured frames", s.frames > 0 && s.framesWithNodes > 0, {
    frames: s.frames,
    framesWithNodes: s.framesWithNodes,
  });
  record("no frame ever showed a zero-size container", s.zeroSizeContainerFrames === 0, {
    bad: s.zeroSizeContainerFrames,
  });
  record("no frame ever showed a zero-size node", s.zeroSizeNodeFrames === 0, {
    bad: s.zeroSizeNodeFrames,
  });
  record("no frame ever showed nodes stacked on one another", s.stackedFrames === 0, {
    bad: s.stackedFrames,
  });
  record("the node was dragged to a new position", pass1.dragged.after !== pass1.dragged.before, {
    ...pass1.dragged,
  });
  record("console was clean", pass1.errors.length === 0, pass1.errors);
}

// ── Pass 2: reopen, and confirm the edits are on disk and back on screen ────────────────────
const onDisk = JSON.parse(readFileSync(`${PROJ}/.claude/maestro.json`, "utf8"));
const wf = onDisk.workflows.find((w) => w.name === "unpositioned");
const savedN2 = wf.nodes.find((n) => n.id === "n2").position;
record("the drag reached maestro.json", !!savedN2, { position: savedN2 });
record(
  "the label edit reached maestro.json",
  wf.edges.find((e) => e.from === "n3" && e.to === "n4")?.label === "ship it",
);

const pass2 = await withApp(
  { appDir: APP, electron: ELECTRON, port: 9423, userDataDir: `${TMP}/udd` },
  async (cdp) => {
    await openProjectAt(cdp, PROJ, "#/workflows");
    await cdp.waitFor(`!!document.querySelector(".react-flow__node")`);
    await new Promise((r) => setTimeout(r, 600));
    const g = await cdp.geometry();
    const labels = await cdp.eval(`
      return [...document.querySelectorAll(".react-flow__edgelabel-renderer span")]
        .map(s => s.textContent.trim());
    `);
    return { g, labels };
  },
);

{
  const n2 = pass2.g.nodes.find((n) => n.id === "n2");
  record(
    "after close and reopen, the node is where it was left",
    n2 && Math.abs(n2.x - savedN2.x) < 1.5 && Math.abs(n2.y - savedN2.y) < 1.5,
    { expected: savedN2, got: { x: n2?.x, y: n2?.y } },
  );
  record("after close and reopen, the label survived", pass2.labels.includes("ship it"), {
    labels: pass2.labels,
  });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
