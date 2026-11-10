// `174`: the dedicated row for an `interim_settled` log entry (written by `169` when handoff-issues
// settles an interim stop). Rendered with renderToStaticMarkup, like the other renderer component
// tests; the row model and the log-view wiring are checked through the pure helpers they use.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import InterimSettledRow from "../../src/renderer/src/components/interim-settled-row.js";
import SessionLogView from "../../src/renderer/src/components/session-log-view.js";
import { buildInstances, humanizeLog, interimSettledRow, logRows } from "../../src/renderer/src/utils/session-log.js";
import type { SessionLogEntry } from "../../src/renderer/src/utils/maestro-session-log.js";

const STOP_TS = "2026-03-04T10:15:00.000Z";
const SETTLE_TS = "2026-03-04T10:20:00.000Z";
const RUN_ID = "run-7f3a";

const clockOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

/** Visible text of a rendered fragment: tags dropped, React's text-node comments dropped, spaces collapsed. */
const textOf = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const missingEntry = (): SessionLogEntry => ({
  ts: SETTLE_TS,
  origin: "main_session",
  kind: "interim_settled",
  agent: "backend",
  agent_id: RUN_ID,
  stop_ts: STOP_TS,
  settled_as: "missing",
  label: null,
  log: "interim settled",
  handoff_issue: { kind: "missing", verdict: null, label: null, message: "no hand-off arrived after the stop" },
});

const lateEntry = (over: Partial<SessionLogEntry> = {}): SessionLogEntry => ({
  ts: SETTLE_TS,
  origin: "main_session",
  kind: "interim_settled",
  agent: "backend",
  agent_id: RUN_ID,
  stop_ts: STOP_TS,
  settled_as: "late_handback",
  label: "tests_failed",
  log: "interim settled",
  ...over,
});

const render = (row: Parameters<typeof InterimSettledRow>[0]["row"]) =>
  renderToStaticMarkup(createElement(InterimSettledRow, { row }));

describe("InterimSettledRow — missing shape", () => {
  const entry = missingEntry();
  const row = interimSettledRow(entry)!;
  const html = render(row);

  it("is marked with its settled_as and styled as a problem", () => {
    expect(html).toContain('data-interim-settled="missing"');
    expect(html).toContain("border-maestro-danger-strong");
    expect(html).toContain("text-maestro-danger");
    expect(textOf(html)).toContain("missing hand-off");
  });

  it("shows agent, run id, stop time and settle time from the entry", () => {
    const text = textOf(html);
    expect(text).toContain("@backend");
    expect(text).toContain(`run ${RUN_ID}`);
    expect(text).toContain(`stopped ${clockOf(STOP_TS)}`);
    expect(text).toContain(`settled ${clockOf(SETTLE_TS)}`);
    expect(html).toContain(`dateTime="${STOP_TS}"`);
    expect(html).toContain(`dateTime="${SETTLE_TS}"`);
  });

  it("shows the label as none, since a missing settlement has no hand-back label", () => {
    expect(textOf(html)).toContain("missing hand-off · HANDOFF: none");
  });

  it("shows a non-null label when the entry carries one (the row reads the label, it does not assume none)", () => {
    const text = textOf(render(interimSettledRow({ ...missingEntry(), label: "tests_failed" })!));
    expect(text).toContain("missing hand-off · HANDOFF: tests_failed");
    expect(text).not.toContain("HANDOFF: none");
  });

  it("lists the judged issue of a missing settlement when present", () => {
    const text = textOf(html);
    expect(text).toContain("missing — no hand-off arrived after the stop");
    expect(html).toContain("text-maestro-danger");
  });

  it("a missing settlement without a judged issue renders no issue block", () => {
    const bare = { ...missingEntry(), handoff_issue: undefined } as SessionLogEntry;
    const bareHtml = render(interimSettledRow(bare)!);
    expect(bareHtml).toContain('data-interim-settled="missing"');
    expect(bareHtml).not.toContain("no hand-off arrived");
    expect(bareHtml).not.toContain("<ul");
  });
});

describe("InterimSettledRow — late_handback shape", () => {
  it("without a judged issue: shows the label, styled as a success, no issue block", () => {
    const html = render(interimSettledRow(lateEntry())!);
    expect(html).toContain('data-interim-settled="late_handback"');
    expect(html).not.toContain("border-maestro-danger-strong");
    const text = textOf(html);
    expect(text).toContain("late hand-back · HANDOFF: tests_failed");
    expect(text).toContain("@backend");
    expect(text).toContain(`run ${RUN_ID}`);
    expect(text).toContain(`stopped ${clockOf(STOP_TS)}`);
    expect(text).toContain(`settled ${clockOf(SETTLE_TS)}`);
    expect(html).not.toContain("verdict");
    expect(html).not.toContain("<ul");
  });

  it("a late hand-back with a null label shows HANDOFF: none", () => {
    const text = textOf(render(interimSettledRow(lateEntry({ label: null }))!));
    expect(text).toContain("late hand-back · HANDOFF: none");
  });

  it("with a judged issue: lists kind, verdict, label, message and files, styled as a problem", () => {
    const html = render(
      interimSettledRow(
        lateEntry({
          handoff_issue: {
            kind: "unrouted",
            verdict: "FAIL",
            label: "nope",
            message: "no edge for this label",
            files: ["notes/a.md", "notes/b.md"],
          },
        })
      )!
    );
    expect(html).toContain("border-maestro-danger-strong");
    const text = textOf(html);
    expect(text).toContain("unrouted");
    expect(text).toContain("verdict FAIL");
    expect(text).toContain("label nope");
    expect(text).toContain("no edge for this label");
    expect(text).toContain("notes/a.md");
    expect(text).toContain("notes/b.md");
  });

  it("an issue with no files renders no file list", () => {
    const html = render(
      interimSettledRow(
        lateEntry({ handoff_issue: { kind: "wrong_verdict", verdict: "SUCCESS", label: null, message: "judged bad" } })
      )!
    );
    expect(textOf(html)).toContain("judged bad");
    expect(html).not.toContain("<ul");
  });
});

describe("interimSettledRow — every value comes from the entry", () => {
  it("reads each displayed field off the one entry, ignoring the rest of the log", () => {
    const row = interimSettledRow(lateEntry({ agent: "maestro:frontend", agent_id: "run-XYZ" }))!;
    expect(row).toEqual({
      agent: "maestro:frontend",
      agentId: "run-XYZ",
      stopTs: STOP_TS,
      settledTs: SETTLE_TS,
      settledAs: "late_handback",
      label: "tests_failed",
      issue: null,
    });
    expect(textOf(render(row))).toContain("@frontend");
  });

  it("a settlement log does not pull the run id from another run of the same agent", () => {
    const entries: SessionLogEntry[] = [
      {
        ts: STOP_TS,
        origin: "backend",
        kind: "handoff",
        agent_id: "other-run",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
      lateEntry(),
    ];
    const rows = logRows(entries);
    expect(rows).toHaveLength(2);
    const settled = rows[1];
    expect(typeof settled).toBe("object");
    expect(textOf(render(settled as Parameters<typeof render>[0]))).toContain(`run ${RUN_ID}`);
    expect(textOf(render(settled as Parameters<typeof render>[0]))).not.toContain("other-run");
  });

  it("an unknown settled_as is not a row: it falls back to a plain humanized line", () => {
    const odd = { ...missingEntry(), settled_as: "something_new" } as unknown as SessionLogEntry;
    expect(interimSettledRow(odd)).toBeNull();
    expect(logRows([odd])).toEqual([humanizeLog(odd, "")]);
  });
});

describe("log view — interim_settled entries", () => {
  it("a missing settlement renders its dedicated row inside the instance that holds it", () => {
    const entries: SessionLogEntry[] = [
      {
        ts: STOP_TS,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: RUN_ID,
        input: "go",
        log: "→ backend",
      },
      missingEntry(),
    ];
    const instances = buildInstances(entries);
    const html = renderToStaticMarkup(
      createElement(SessionLogView, {
        instances,
        activeId: null,
        onSelect: () => {},
        sectionRefs: { current: {} },
        connected: true,
        cwd: "",
      })
    );
    expect(html).toContain('data-interim-settled="missing"');
    expect(textOf(html)).toContain(`run ${RUN_ID}`);
  });

  it("a log with no interim_settled entry renders its lines unchanged and no settled row", () => {
    const entries: SessionLogEntry[] = [
      {
        ts: STOP_TS,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "build",
        log: "→ backend",
      },
      { ts: STOP_TS, origin: "backend", log: "Read(/x)" },
      {
        ts: STOP_TS,
        origin: "backend",
        kind: "handoff",
        agent_id: "a1",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const expectedLines = entries.map((e) => humanizeLog(e, "")).filter((l): l is string => l !== null);
    expect(logRows(entries, "")).toEqual(expectedLines);

    const html = renderToStaticMarkup(
      createElement(SessionLogView, {
        instances: buildInstances(entries),
        activeId: null,
        onSelect: () => {},
        sectionRefs: { current: {} },
        connected: true,
        cwd: "",
      })
    );
    expect(html).not.toContain("data-interim-settled");
    expect(html).not.toContain("interim stop settled");
    for (const line of expectedLines) {
      expect(textOf(html)).toContain(line);
    }
  });
});
