// `180`: the epic manager's cleanup after a finished worker: the prune selection, the finished-worker
// record, `--init` on the launcher's docker run, and the marketplace copy leaving out epic data.

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { addWorker, createEpic, finishWorker, formatEpic, readEpicState, showEpic } from "../../src/core/epics.js";
import {
  PROJECT_LABEL,
  dockerfileFor,
  formatPrune,
  isMarketplaceExcluded,
  planPrune,
  projectLabelFor,
  workerRunArgs,
  writeBuildContext,
  imageTagInputs,
  type ImageSpec,
  type PruneContainer,
  type PruneImage,
} from "../../src/core/worker-runtime.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-180-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const GB = 1024 ** 3;
const MINE = "maestro-worker-proj";
const LABEL = projectLabelFor("/work/proj");
const img = (ref: string, id: string, bytes = GB, label: string | null = LABEL): PruneImage => ({
  ref,
  id,
  bytes,
  label,
});

describe("planPrune (180)", () => {
  const current = img(`${MINE}:cur`, "sha256:cur0000");
  const old1 = img(`${MINE}:old1`, "sha256:old10000", 2 * GB);
  const old2 = img(`${MINE}:old2`, "sha256:ab200000", GB);
  const other = img("maestro-worker-other:abc", "sha256:oth00000", GB, projectLabelFor("/work/other"));
  const nonWorker = img("node:22-bookworm-slim", "sha256:node0000");
  const base = {
    currentTag: `${MINE}:cur`,
    projectLabel: LABEL,
    images: [current, old1, old2, other, nonWorker],
    containers: [] as PruneContainer[],
  };

  it("keeps the current tag, removes superseded images, and totals the space", () => {
    const plan = planPrune(base);
    expect(plan.removeImages.map((i) => i.ref)).toEqual([old1.ref, old2.ref]);
    expect(plan.bytes).toBe(3 * GB);
    expect(plan.kept).toEqual([{ ref: current.ref, reason: "current tag" }]);
  });

  it("never touches another project's worker image or a non-worker image", () => {
    const refs = planPrune(base).removeImages.map((i) => i.ref);
    expect(refs).not.toContain(other.ref);
    expect(refs).not.toContain(nonWorker.ref);
  });

  it("never removes an unlabelled or foreign-labelled image of this repository; an unlabelled one is skipped with its docker rmi", () => {
    const unlabelled = img(`${MINE}:old3`, "sha256:old30000", GB, null);
    const foreign = img(`${MINE}:old4`, "sha256:old40000", GB, projectLabelFor("/elsewhere/proj"));
    const plan = planPrune({ ...base, images: [current, unlabelled, foreign] });
    expect(plan.removeImages).toEqual([]);
    expect(plan.bytes).toBe(0);
    expect(plan.skipped).toEqual([{ ref: unlabelled.ref, bytes: GB, command: `docker rmi ${unlabelled.ref}` }]);
    for (const dry of [false, true]) {
      const text = formatPrune(plan, dry);
      expect(text).toContain(`skipped ${unlabelled.ref}`);
      expect(text).toContain(`docker rmi ${unlabelled.ref}`);
      expect(text).not.toContain(foreign.ref);
      expect(text).not.toMatch(/(removed|would remove) image/);
    }
  });

  it("does not list the current tag or an unlabelled image a running container uses as skipped", () => {
    const unlabCurrent = img(`${MINE}:cur`, "sha256:cc000000", GB, null);
    const busy = img(`${MINE}:busy`, "sha256:bb000000", GB, null);
    const plan = planPrune({
      ...base,
      images: [unlabCurrent, busy],
      containers: [{ name: "maestro-worker-a", image: busy.ref, running: true }],
    });
    expect(plan.skipped).toEqual([]);
    expect(plan.removeImages).toEqual([]);
  });

  it("keeps a superseded image a running container uses, by ref or by short id", () => {
    const byRef = planPrune({ ...base, containers: [{ name: "maestro-worker-a", image: old1.ref, running: true }] });
    expect(byRef.removeImages.map((i) => i.ref)).toEqual([old2.ref]);
    expect(byRef.kept).toContainEqual({ ref: old1.ref, reason: "in use by a running container" });
    const byId = planPrune({ ...base, containers: [{ name: "x", image: "ab2000", running: true }] });
    expect(byId.removeImages.map((i) => i.ref)).toEqual([old1.ref]);
  });

  it("removes stopped worker containers of this project only, never a running one", () => {
    const plan = planPrune({
      ...base,
      containers: [
        { name: "maestro-worker-done", image: old1.ref, running: false },
        { name: "maestro-worker-live", image: current.ref, running: true },
        { name: "maestro-worker-theirs", image: other.ref, running: false },
        { name: "postgres", image: old1.ref, running: false },
      ],
    });
    expect(plan.removeContainers.map((c) => c.name)).toEqual(["maestro-worker-done"]);
  });

  it("an image shared with the current tag by id is kept, and a shared id counts once", () => {
    const alias = img(`${MINE}:alias`, current.id);
    expect(planPrune({ ...base, images: [current, alias] }).removeImages).toEqual([]);
    const twin = img(`${MINE}:twin`, old1.id, 2 * GB);
    expect(planPrune({ ...base, images: [current, old1, twin] }).bytes).toBe(2 * GB);
  });

  // DEFECT (180, found by the QA re-test): with only skipped images, formatPrune prints "nothing needed
  // removing" and then a line telling the user to run `docker rmi`. Those two contradict each other.
  // Expected: no "nothing needed removing" line when a skipped image is listed; the skipped line stands.
  it("skipped-only output does not say nothing needed removing next to a docker rmi suggestion", () => {
    const plan = planPrune({ ...base, images: [current, img(`${MINE}:unl`, "sha256:uu000000", GB, null)] });
    for (const dry of [false, true]) {
      const text = formatPrune(plan, dry);
      expect(text).toContain(`docker rmi ${MINE}:unl`);
      expect(text).not.toContain("nothing needed removing");
    }
  });

  it("removes nothing when the current tag is unknown", () => {
    const plan = planPrune({ ...base, currentTag: null });
    expect(plan.removeImages).toEqual([]);
    expect(plan.removeContainers).toEqual([]);
  });

  it("formats removals with the freed space, a dry run as 'would', and an empty plan as nothing to remove", () => {
    const plan = planPrune(base);
    const real = formatPrune(plan, false);
    expect(real).toContain(`removed image ${old1.ref}`);
    expect(real).toContain("freed 3.0 GB");
    const dry = formatPrune(plan, true);
    expect(dry).toContain(`would remove image ${old1.ref}`);
    expect(dry).toContain("dry run");
    expect(dry).not.toMatch(/^removed /m);
    expect(formatPrune(planPrune({ ...base, images: [], containers: [] }), false)).toContain("nothing needed removing");
  });
});

describe("prune through the real launcher script (180)", () => {
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../plugins/maestro/scripts/maestro-worker-runtime.cjs"
  );
  it("with no docker on PATH it reports nothing needed removing and exits 0, dry run or not", () => {
    const project = tmp();
    const emptyBin = tmp();
    for (const args of [["prune"], ["prune", "--dry-run"]]) {
      const r = spawnSync(process.execPath, [script, ...args], {
        encoding: "utf8",
        env: { PATH: emptyBin, HOME: project, CLAUDE_PROJECT_DIR: project },
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("nothing needed removing");
    }
  });
});

describe("finished-worker record (180)", () => {
  function epic() {
    const root = tmp();
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    createEpic(root, "e1");
    addWorker(root, "e1", "e1-177", "177-x.md", "1-2");
    addWorker(root, "e1", "e1-178", "178-y.md", "1-3");
    return root;
  }

  it("finishing a worker drops it and its pane from the active list and keeps the record", () => {
    const root = epic();
    finishWorker(root, "e1", "e1-177");
    const view = showEpic(root, "e1");
    expect(view.workers.map((w) => w.name)).toEqual(["e1-178"]);
    expect(view.finishedWorkers.map((w) => w.name)).toEqual(["e1-177"]);
    const text = formatEpic(view);
    expect(text).not.toContain("1-2");
    expect(text).toContain("e1-178 (pane 1-3)");
    expect(text).toContain("finished:  e1-177");
    const rec = readEpicState(root, "e1")!.workers.find((w) => w.name === "e1-177")!;
    expect(rec.pane).toBeUndefined();
    expect(rec.finished_at).toBeTruthy();
  });

  it("finishing twice keeps the first time, and an unknown worker or epic is refused", () => {
    const root = epic();
    finishWorker(root, "e1", "e1-177");
    const first = readEpicState(root, "e1")!.workers[0]!.finished_at;
    finishWorker(root, "e1", "e1-177");
    expect(readEpicState(root, "e1")!.workers[0]!.finished_at).toBe(first);
    expect(() => finishWorker(root, "e1", "nope")).toThrow(/no worker/);
    expect(() => finishWorker(root, "zz", "e1-177")).toThrow(/no epic/);
  });
});

describe("--init and the marketplace copy (180)", () => {
  it("every docker run has --init, ahead of the image and the claude command", () => {
    const args = workerRunArgs({ tag: "img:1", name: "w", taskRel: "t.md", repoRoot: "/r", mounts: [] });
    const init = args.indexOf("--init");
    expect(init).toBeGreaterThan(-1);
    expect(init).toBeLessThan(args.indexOf("img:1"));
  });

  it("the marketplace copy leaves out .claude/epics (inbox included) and keeps plugin files", () => {
    expect(isMarketplaceExcluded(".claude/epics/e1/inbox/r001.md")).toBe(true);
    expect(isMarketplaceExcluded(".claude/epics")).toBe(true);
    expect(isMarketplaceExcluded("plugins/maestro/.claude/epics/x/EPIC.md")).toBe(true);
    expect(isMarketplaceExcluded(".claude/epics/e1/state.json")).toBe(true);
    expect(isMarketplaceExcluded("plugins/maestro/skills/a/SKILL.md")).toBe(false);
    expect(isMarketplaceExcluded(".claude/epics-notes/x.md")).toBe(false);

    const market = tmp();
    fs.mkdirSync(path.join(market, ".claude", "epics", "e1", "inbox"), { recursive: true });
    fs.writeFileSync(path.join(market, ".claude", "epics", "e1", "inbox", "r001.md"), "report");
    fs.mkdirSync(path.join(market, "plugins", "p"), { recursive: true });
    fs.writeFileSync(path.join(market, "plugins", "p", "plugin.json"), "{}");
    const ctx = path.join(tmp(), "ctx");
    const spec: ImageSpec = {
      projectRoot: "/work/proj",
      uid: 1000,
      gid: 1000,
      claudeVersion: "1.0.0",
      plugins: [],
      marketplaces: [{ name: "m", entry: { source: {} }, dir: market }],
      npmPackages: {},
    };
    writeBuildContext(ctx, spec);
    const copied = path.join(ctx, "marketplaces", "m");
    expect(fs.existsSync(path.join(copied, "plugins", "p", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(copied, ".claude", "epics"))).toBe(false);
  });

  it("the image layout changed, so existing tags rebuild", () => {
    const inputs = imageTagInputs({
      projectRoot: "/work/proj",
      uid: 1,
      gid: 1,
      claudeVersion: "1.0.0",
      plugins: [],
      npmPackages: {},
    });
    expect(inputs.layout).toBeGreaterThanOrEqual(7);
    expect(PROJECT_LABEL).toBe("maestro.worker.project");
    expect(dockerfileFor).toBeTypeOf("function");
  });
});
