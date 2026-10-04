// The global Docs page's corpus is two directories merged: the end-user docs shipped in the plugin
// (so `maestro-help` can read them from a marketplace install) and app-only pages kept in
// `apps/maestro/docs/app/`. What a merge of this shape loses is a whole directory, silently — the
// page still renders, just without the pages from one side.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { globalDocsData, readGlobalDoc } from "../../src/core/global-docs.js";

let root: string;
let pluginDocs: string;
let appDocs: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-global-docs-"));
  pluginDocs = path.join(root, "plugin");
  appDocs = path.join(root, "app");
  fs.mkdirSync(pluginDocs);
  fs.mkdirSync(appDocs);
  fs.writeFileSync(path.join(pluginDocs, "overview.md"), "# Overview\n\n## Opening a project\n\nbody\n");
  fs.writeFileSync(path.join(appDocs, "credits.md"), "# Art Credits\n\nbody\n");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("global docs", () => {
  it("lists and indexes both directories as one title-sorted corpus", () => {
    const data = globalDocsData({ app: [pluginDocs, appDocs] });
    expect(data.app.map((d) => d.title)).toEqual(["Art Credits", "Overview"]);
    expect(data.app.every((d) => d.group === "app")).toBe(true);
    expect(data.sections.map((s) => s.slug)).toEqual(expect.arrayContaining(["overview", "credits"]));
  });

  it("reads a doc from whichever directory holds it", () => {
    const dirs = { app: [pluginDocs, appDocs] };
    expect(readGlobalDoc("app", "overview", dirs).title).toBe("Overview");
    expect(readGlobalDoc("app", "credits", dirs).title).toBe("Art Credits");
  });

  it("refuses a slug that could name a file outside the corpus", () => {
    expect(() => readGlobalDoc("app", "../credits", { app: [pluginDocs] })).toThrow(/Invalid document name/);
  });

  it("degrades to an empty corpus, and a read error, when no directory resolved", () => {
    expect(globalDocsData({ app: [] })).toEqual({ app: [], sections: [] });
    expect(() => readGlobalDoc("app", "overview", { app: [] })).toThrow(/not available/);
  });
});
