// `/maestro` under `?project=maestro`: an installed, current runtime. The values mirror this repo's
// own install: its hook ids, `project_tags` and `gates`.
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
    gates: async () => ({ gates: { confidence_check: true, use_code_architecture_design_check: true } }),
    taskRouting: async () => ({ useMaestroTasks: true }),
  },
  channels: { pending: async () => [] },
};
