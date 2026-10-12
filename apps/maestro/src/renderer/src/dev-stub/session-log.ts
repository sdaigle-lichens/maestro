// Session log (`/session-log`) under `?project=maestro`. The live session's tool lines are this
// repo's own log (paths shortened); the dispatch/handoff pair is invented, since the real logs here
// hold only main-session lines.
import { maestroRoot } from "./projects";

const logEntry = (ts: string, log: string, ctx_pct?: number) => ({
  ts: `2026-10-11T${ts}Z`,
  origin: "main_session",
  log,
  ...(ctx_pct ? { ctx_pct, ctx_model: "claude-sonnet-5-5" } : {}),
});

const liveSession = {
  projectRoot: maestroRoot,
  sessionId: "e6541355-c9b2-43ee-9c84-d19c6ae7dd50",
  entries: [
    logEntry("20:40:29.508", "Bash(git fetch origin main)"),
    logEntry("20:40:32.914", "Bash(git status -sb)"),
    logEntry("20:40:34.438", "Bash(git merge origin/main)", 8.6),
    logEntry("20:40:36.422", "Bash(git diff --diff-filter=U)", 8.7),
    logEntry("20:40:44.488", "Edit(apps/maestro/src/renderer/src/routes/maestro.tsx)", 11.5),
    logEntry("20:40:52.306", "Edit(apps/maestro/vitest.config.ts)", 12.6),
    {
      ts: "2026-10-11T20:41:00.000Z",
      origin: "subagent",
      kind: "dispatch",
      agent: "frontend",
      agent_id: "a1f3c9",
      log: "dispatch frontend",
      input: "Resolve the merge conflicts in the renderer routes, keeping both sides' dev-stub changes.",
      offered_skills: { loaded: ["electron-shell-invariants"], referenced: ["workflow-view"] },
      ctx_pct: 13.1,
      ctx_model: "claude-sonnet-5-5",
    },
    {
      ts: "2026-10-11T20:41:24.000Z",
      origin: "subagent",
      kind: "handoff",
      agent: "frontend",
      agent_id: "a1f3c9",
      status: "success",
      label: null,
      log: "handoff frontend",
      output: "Conflicts resolved in 3 files; typecheck passes.",
      ctx_pct: 15.2,
      ctx_model: "claude-sonnet-5-5",
    },
    logEntry("20:41:32.813", "Bash(pnpm --filter maestro format)", 15.9),
    logEntry("20:41:47.068", "Bash(pnpm --filter maestro typecheck)", 15.9),
    logEntry("20:42:05.454", "Bash(pnpm --filter maestro test)", 20.5),
  ],
  status: "live",
  firstSeenAt: Date.parse("2026-10-11T20:40:29Z"),
  endedAt: null,
};

const endedSession = {
  projectRoot: maestroRoot,
  sessionId: "c3ccc897-f530-488f-8ec6-24836ec5e25a",
  entries: [
    logEntry("20:35:24.577", "Bash(just ci-local)"),
    logEntry("20:35:30.618", "AskUserQuestion", 11),
    logEntry("20:37:29.533", "Bash(just ci-local)", 12.2),
    { ...logEntry("20:37:44.679", "transition", 13.4), kind: "transition", origin: "transition", output: "/sandbox" },
  ],
  status: "ended",
  firstSeenAt: Date.parse("2026-10-11T20:35:24Z"),
  endedAt: Date.parse("2026-10-11T20:37:50Z"),
};

export const sessionLog = {
  log: {
    subscribe: (h: {
      onInit: (p: { projectRoot: string; sessionId: string; entries: unknown[] }) => void;
      onEnd: (p: { projectRoot: string; sessionId: string }) => void;
      onReset: () => void;
    }) => {
      setTimeout(() => {
        h.onReset();
        for (const s of [liveSession, endedSession]) h.onInit(s);
        h.onEnd(endedSession);
      }, 0);
      return () => {};
    },
  },
  sessions: {
    deletable: async () => [],
    titles: async () => ({
      [`${maestroRoot}::${liveSession.sessionId}`]: "Merge origin/main into feat/use-design-plugin",
      [`${maestroRoot}::${endedSession.sessionId}`]: "Set up the sandbox",
    }),
  },
};
