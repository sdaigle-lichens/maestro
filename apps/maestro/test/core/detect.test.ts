// Tests for the repo detection that replaced the hardcoded `["backend"]` seed.
//
// One fixture layout per signal class, because the classes fail independently: a repo can be
// classified from npm dependencies, from a workspace's member manifests, from a non-JavaScript
// language manifest, or from nothing at all — and the last of those (the fallback) is the one a
// test suite that only covers the happy classes would let regress into an empty chain.
//
// Two properties beyond "did it pick the right agents":
//   • the evidence names what matched, since a heuristic the user cannot check is a heuristic the
//     user cannot correct;
//   • the work is bounded by the number of packages, not the number of files, because this runs on
//     the first open of every project.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { detectImplAgents } from "../../src/core/detect.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-detect-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Write a fixture repo from a map of project-relative path → contents. */
function repo(files: Record<string, string | object>): string {
  const root = fs.mkdtempSync(path.join(tmp, "repo-"));
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  return root;
}

const pkg = (deps: Record<string, string>, extra: object = {}) => ({
  name: "fixture",
  version: "1.0.0",
  dependencies: deps,
  ...extra,
});

/** The evidence as one blob — assertions read better against the text the user is shown. */
const evidenceText = (root: string) => detectImplAgents(root).evidence.join("\n");

describe("JavaScript dependency signals", () => {
  it("detects a frontend-only repo", () => {
    const root = repo({ "package.json": pkg({ react: "^19", "react-dom": "^19", next: "^15" }) });
    expect(detectImplAgents(root).implAgents).toEqual(["frontend"]);
  });

  it("detects a backend-only repo", () => {
    const root = repo({ "package.json": pkg({ express: "^4", "@prisma/client": "^6" }) });
    expect(detectImplAgents(root).implAgents).toEqual(["backend"]);
  });

  it("detects a repo that is both, backend first", () => {
    const root = repo({ "package.json": pkg({ "react-dom": "^19", express: "^4" }) });
    const { implAgents, fallback } = detectImplAgents(root);
    expect(implAgents).toEqual(["backend", "frontend"]);
    expect(fallback).toBe(false);
  });

  it("reads devDependencies too — a framework is often not a runtime dependency", () => {
    const root = repo({
      "package.json": { name: "f", devDependencies: { svelte: "^5", "@sveltejs/kit": "^2" } },
    });
    expect(detectImplAgents(root).implAgents).toEqual(["frontend"]);
  });

  it("survives a malformed package.json instead of throwing on first open", () => {
    const root = repo({ "package.json": "{ this is not json", "go.mod": "module x\n" });
    expect(detectImplAgents(root).implAgents).toEqual(["backend"]);
  });
});

describe("mobile vs. frontend", () => {
  it("calls an Expo app mobile, not frontend, despite its react dependency", () => {
    const root = repo({ "package.json": pkg({ expo: "~52", react: "^19", "react-native": "0.76" }) });
    expect(detectImplAgents(root).implAgents).toEqual(["mobile"]);
  });

  it("detects an app.json only when it actually carries an expo key", () => {
    const plain = repo({ "app.json": { name: "something else" }, "package.json": pkg({ express: "^4" }) });
    expect(detectImplAgents(plain).implAgents).toEqual(["backend"]);

    const expo = repo({ "app.json": { expo: { name: "app" } } });
    expect(detectImplAgents(expo).implAgents).toEqual(["mobile"]);
  });

  it("keeps a react-native app and a web app apart in one repo", () => {
    const root = repo({
      "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
      "apps/mobile/package.json": pkg({ expo: "~52", react: "^19" }),
      "apps/web/package.json": pkg({ "react-dom": "^19" }),
    });
    expect(detectImplAgents(root).implAgents).toEqual(["frontend", "mobile"]);
  });
});

describe("workspace and monorepo layouts", () => {
  it("classifies from pnpm workspace members, not just the root manifest", () => {
    const root = repo({
      "package.json": { name: "monorepo", private: true, devDependencies: { turbo: "^2" } },
      "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
      "apps/web/package.json": pkg({ "react-dom": "^19", next: "^15" }),
      "apps/api/package.json": pkg({ fastify: "^5" }),
      "packages/ui/package.json": pkg({}),
    });
    const { implAgents } = detectImplAgents(root);
    expect(implAgents).toEqual(["backend", "frontend"]);
    expect(evidenceText(root)).toContain("apps/api/package.json");
    expect(evidenceText(root)).toContain("apps/web/package.json");
  });

  it("classifies from npm/yarn `workspaces` globs", () => {
    const root = repo({
      "package.json": { name: "monorepo", private: true, workspaces: ["services/*"] },
      "services/orders/package.json": pkg({ "@nestjs/core": "^11" }),
    });
    expect(detectImplAgents(root).implAgents).toEqual(["backend"]);
  });

  it("finds packages under an apps/ layout that declares no workspace at all", () => {
    const root = repo({
      "apps/dashboard/package.json": pkg({ vue: "^3" }),
      "apps/worker/pyproject.toml": "[project]\nname = 'worker'\n",
    });
    expect(detectImplAgents(root).implAgents).toEqual(["backend", "frontend"]);
  });

  it("never classifies a repo from its dependencies' own manifests", () => {
    // A `*` glob expands over real directories, and node_modules is full of package.json files
    // declaring react. Reading them would classify every repo as frontend.
    const root = repo({
      "package.json": { name: "lib", workspaces: ["*"], dependencies: { express: "^4" } },
      "node_modules/react-dom/package.json": pkg({ react: "^19" }),
      "dist/package.json": pkg({ next: "^15" }),
    });
    expect(detectImplAgents(root).implAgents).toEqual(["backend"]);
  });
});

describe("repos with no JavaScript manifest", () => {
  // The class the old constant papered over: these repos have nothing npm can see, so a
  // dependency-only detector would fall through to a default that ignores them entirely.
  const cases: Array<[string, Record<string, string>]> = [
    ["Python", { "pyproject.toml": "[project]\nname = 'svc'\n" }],
    ["Go", { "go.mod": "module example.com/svc\n\ngo 1.23\n" }],
    ["Rust", { "Cargo.toml": "[package]\nname = 'svc'\n" }],
    ["C#", { "Svc.csproj": "<Project Sdk='Microsoft.NET.Sdk' />" }],
    ["Java", { "pom.xml": "<project></project>" }],
    ["Ruby", { Gemfile: "source 'https://rubygems.org'\n" }],
  ];

  for (const [language, files] of cases) {
    it(`detects a ${language} repo rather than ignoring it`, () => {
      const root = repo({ ...files, "README.md": "# svc\n" });
      const result = detectImplAgents(root);
      expect(result.implAgents).toEqual(["backend"]);
      // Same chain as the fallback, but NOT the fallback: it matched something, and says what.
      expect(result.fallback).toBe(false);
      expect(result.evidence.join("\n")).toContain(Object.keys(files)[0]);
    });
  }

  it("combines a Python service with a JavaScript frontend", () => {
    const root = repo({
      "pyproject.toml": "[project]\nname = 'api'\n",
      "web/package.json": pkg({ "react-dom": "^19" }),
      "package.json": { name: "root", workspaces: ["web"] },
    });
    expect(detectImplAgents(root).implAgents).toEqual(["backend", "frontend"]);
  });
});

describe("unrecognised repos", () => {
  it("falls back to a chain that runs, and says it is a fallback", () => {
    const root = repo({ "README.md": "# notes\n", "docs/index.md": "hello\n" });
    const result = detectImplAgents(root);
    expect(result.implAgents).toEqual(["backend"]);
    expect(result.fallback).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.join("\n")).toMatch(/default/i);
  });

  it("returns the fallback for a directory that does not exist", () => {
    expect(detectImplAgents(path.join(tmp, "nope")).implAgents).toEqual(["backend"]);
  });

  it("never returns an empty chain", () => {
    for (const root of [repo({}), repo({ "package.json": pkg({ lodash: "^4" }) })]) {
      expect(detectImplAgents(root).implAgents.length).toBeGreaterThan(0);
    }
  });
});

describe("evidence", () => {
  it("names the dependencies it matched and the agent they imply", () => {
    const root = repo({ "package.json": pkg({ "react-dom": "^19", express: "^4" }) });
    const text = evidenceText(root);
    expect(text).toContain("`express`");
    expect(text).toContain("`react-dom`");
    expect(text).toContain("→ backend");
    expect(text).toContain("→ frontend");
    expect(text).toContain("package.json");
  });

  it("names the file for a non-JavaScript marker", () => {
    const root = repo({ "go.mod": "module x\n" });
    expect(evidenceText(root)).toMatch(/`go\.mod` in the repo root → backend/);
  });

  it("orders evidence the way the chain is ordered", () => {
    const root = repo({ "package.json": pkg({ "react-dom": "^19", express: "^4" }) });
    const { implAgents, evidence } = detectImplAgents(root);
    expect(implAgents).toEqual(["backend", "frontend"]);
    expect(evidence[0]).toContain("→ backend");
  });

  it("stays readable on a repo that matches everything", () => {
    const files: Record<string, string | object> = {
      "package.json": { name: "big", private: true, workspaces: ["apps/*"] },
    };
    for (let i = 0; i < 30; i++) files[`apps/svc-${i}/package.json`] = pkg({ express: "^4", "react-dom": "^19" });
    const { evidence } = detectImplAgents(repo(files));
    expect(evidence.length).toBeLessThanOrEqual(7);
    expect(evidence.at(-1)).toMatch(/more matching files/);
  });
});

describe("cost", () => {
  it("is bounded by the number of packages, not the number of files", () => {
    // 12 packages inside a tree of ~3,000 files. A detector that walked the repo would read every
    // one of them on the first open of a project; this one reads a manifest per package.
    const files: Record<string, string | object> = {
      "package.json": { name: "big", private: true, workspaces: ["packages/*"] },
    };
    for (let p = 0; p < 12; p++) {
      files[`packages/p${p}/package.json`] = pkg({ express: "^4" });
      for (let d = 0; d < 10; d++) {
        for (let f = 0; f < 25; f++) files[`packages/p${p}/src/mod-${d}/file-${f}.ts`] = "export const x = 1;\n";
      }
    }
    const root = repo(files);

    const started = performance.now();
    const result = detectImplAgents(root);
    const elapsed = performance.now() - started;

    expect(result.implAgents).toEqual(["backend"]);
    expect(elapsed).toBeLessThan(250);
  });
});
