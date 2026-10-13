// `/maestro` under `?project=maestro`: an installed, current runtime. The values mirror this repo's
// own install: its hook ids, `project_tags` and start/end skill lists.
import { maestroRoot } from "./projects";

const hooks = [
  "UserPromptExpansion:maestro-step0.cjs",
  "UserPromptExpansion:maestro-enable-task-routing.cjs",
  "UserPromptExpansion:maestro-post-mortem-context.cjs",
  "PreToolUse:maestro-step0.cjs",
  "PreToolUse:maestro-enable-task-routing.cjs",
  "PreToolUse:maestro-post-mortem-context.cjs",
  "PreToolUse:maestro-session-log.cjs",
  "SubagentStart:maestro-inject-agent-context.cjs",
  "SubagentStart:maestro-subagent-log.cjs",
  "SubagentStop:maestro-subagent-log.cjs",
  "PostToolUse:maestro-validate-tasks.cjs",
  "SessionEnd:maestro-session-cleanup.cjs",
];

// Mutable so the picker round-trips within a browser session, like a save to maestro.json would.
let skillLists = {
  start_skills: {
    maestro: ["confidence-check"],
    to_maestro_tasks: ["confidence-check"],
  },
  end_skills: { maestro: [] as string[] },
};

const sampleSkill = (id: string, source: string) => ({
  id,
  description: "",
  source,
  projectTags: [] as string[],
  agentTypes: [] as string[],
});

export const maestroInstall = {
  install: {
    status: async () => ({
      projectRoot: maestroRoot,
      installed: true,
      orchestratorSkill: true,
      scriptsDir: true,
      configFile: true,
      orchestratorSkillOutOfDate: false,
      scriptsMissing: [],
      scriptsOutOfDate: [],
      hooksRegistered: hooks,
      hooksMissing: [],
      shippedRuntimeId: "3f9a1c7e20b4",
      installedRuntimeId: "3f9a1c7e20b4",
      stale: false,
      appBehind: null,
      settingsUnreadable: false,
    }),
  },
  agents: {
    sync: async () => ({
      materialized: [],
      refreshed: [],
      staleCustomized: [],
      unchanged: ["backend", "frontend", "test", "reviewer"],
      diverged: [],
      entries: [],
    }),
  },
  data: {
    projectTags: async () => ({
      catalog: ["backend", "frontend", "mobile", "infra"],
      selected: ["backend", "frontend"],
    }),
    skillLists: async () => ({ skillLists }),
    tools: async () => ({
      skills: [
        sampleSkill("test-maestro", "project"),
        sampleSkill("scribe", "project"),
        sampleSkill("confidence-check", "maestro"),
        sampleSkill("concept-skills:scribe", "concept-skills"),
        sampleSkill("concept-skills:use-code-architecture-design-check", "concept-skills"),
        sampleSkill("design-sketch", "design"),
      ],
    }),
    taskRouting: async () => ({ useMaestroTasks: true }),
  },
  // Merged into `project` by index.ts, which already holds `project.get`.
  project: {
    skillLists: {
      set: async (next: typeof skillLists) => {
        skillLists = next;
        return skillLists;
      },
    },
  },
  channels: { pending: async () => [] },
};
