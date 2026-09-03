// IPC handlers — the whole node-side surface of the app.
//
// Every handler is a thin adapter over ../core. Deliberately so: the logic is tested under
// test/core/ without an Electron runtime, and this file stays readable as a list of what the
// renderer is allowed to ask for.

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  readConfig,
  blankConfig,
  defaultV3Config,
  seededAgentNames,
  detectImplAgents,
  saveConfig,
  discoverAgents,
  discoverSkills,
  readAllSkillTags,
  setSkillProjectTags,
  setSkillAgentTypes,
  skillMapFromTags,
  getAvatar,
  setAvatar,
  readAllAvatars,
  setAgentDescription,
  forkAgent,
  computeAgentSync,
  applyAgentSync,
  discoverProjectRules,
  discoverRuleLibrary,
  discoverProjectTree,
  discoverVibeRules,
  hasVibeRules,
  listTasks,
  closeTask,
  listMarketplaces,
  scaffoldCreate,
  nodeGit,
  tailSessionLog,
  installStatus,
  installRuntime,
  refreshStaleRuntime,
  uninstallPlan,
  uninstallRuntime,
  listInstalledPlugins,
  readProjectMarketplace,
  listCuratedPlugins,
  readClaudeCommands,
  listDocs,
  readDoc,
  docSections,
  globalDocsData,
  readGlobalDoc,
  previewClaudeRun,
  nodeSettings,
  runPreviewedClaude,
  cancelClaudeRun,
  disposeClaudeRuns,
  clearInvocations,
  previewUsageStats,
  runUsageStats,
  getResolvedReport,
  saveProjectReportOverride,
  readAllAgentReportDefaults,
  writeAgentReportDefault,
  readAllAgentTypes,
  setAgentType,
  readAllProjectTags,
  addProjectTag,
  removeProjectTag,
  readAllAgentProjectTags,
  setAgentProjectTag,
  agentsForProjectTags,
  GLOBAL_TAG,
  type AgentAttrs,
} from "../core/index.js";
import { IPC, IPC_EVENTS } from "../shared/ipc.js";
import type {
  PermissionChoice,
  QuestionChoice,
  ResumableSession,
  ResumeDisclosure,
  SessionEffort,
  SessionInfo,
  ClaudePreview,
  ClaudeRequest,
  CreateOptions,
  CreateRequest,
  DocContent,
  DocsData,
  GlobalDocsData,
  ScaffoldResult,
  ClaudeRunResult,
  MaestroConfigV3,
  AvatarLayers,
  DiscoveredDefinition,
  ToolsData,
  InstallReport,
  InstallStatus,
  UninstallPlan,
  UninstallReport,
  ProjectState,
  ResolvedReport,
  ReportDefault,
  AgentType,
  AgentDescriptionResult,
  AgentForkResult,
  AgentSyncAction,
  AgentSyncApplyResult,
  AgentSyncSummary,
  ProjectTagsData,
  RulesData,
  SaveInput,
  UsageStatsPreview,
  UsageStatsResult,
  UsageStatsView,
  WorkflowsData,
} from "../shared/ipc.js";
import { bundledAgentsDir, bundledPluginDir, bundledPluginVersion, maestroAppDocsDir } from "./bundled-assets.js";
import {
  answerPermission,
  answerQuestion,
  continueSession,
  describeResume,
  disposeSessions,
  endAllSessions,
  endSession,
  handoffToSession,
  listResumableSessions,
  resumeSession,
  revokeGrant,
  saySession,
  sessionInfo,
  setSessionEffort,
  setSessionModel,
  startSession,
  stopSession,
} from "./claude-session.js";
import { currentRoot, forgetProject, getState, openProject } from "./project-store.js";

/**
 * Active log tails, keyed by the webContents id that asked for one.
 *
 * One tail per window, not per subscriber: `startTail` stops any existing tail for the id first.
 * That makes `log.subscribe` single-owner — a second subscriber in the same renderer would steal
 * the tail, and the first unsubscribe would stop it for both. `SessionLogProvider` is that owner
 * (mounted once in `__root.tsx`) and a test in test/isolation.test.ts holds it to one call site.
 * Refcounting would be the alternative; with a single owner it would be unexercised code.
 */
const tails = new Map<number, () => void>();

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function stopTail(webContentsId: number): void {
  tails.get(webContentsId)?.();
  tails.delete(webContentsId);
}

/**
 * Restart every open tail against the current project. Called on a project switch — without it a
 * window would keep streaming the previously-opened repo's session log.
 */
function retargetTails(): void {
  for (const id of [...tails.keys()]) {
    stopTail(id);
    const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.id === id)?.webContents;
    if (wc) startTail(wc.id);
  }
}

function startTail(webContentsId: number): void {
  const root = currentRoot();
  const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.id === webContentsId)?.webContents;
  if (!wc) return;
  if (!root) {
    wc.send(IPC_EVENTS.logInit, []);
    return;
  }
  stopTail(webContentsId);
  tails.set(
    webContentsId,
    tailSessionLog(root, {
      init: (entries) => !wc.isDestroyed() && wc.send(IPC_EVENTS.logInit, entries),
      entry: (entry) => !wc.isDestroyed() && wc.send(IPC_EVENTS.logEntry, entry),
      reset: () => !wc.isDestroyed() && wc.send(IPC_EVENTS.logReset),
    })
  );
}

/**
 * Resolve the project root a "viewing" channel should read, when the renderer names one.
 *
 * `projectRoot` is a renderer-side VIEWING parameter, never a switch — see the plan's §6. It is
 * honoured only when it names the currently open project or one from the recent list; anything
 * else (stale, forged, a path that was since forgotten) degrades silently to the open project
 * rather than throwing, so a renderer bug here can only ever narrow back to today's behaviour, not
 * read an arbitrary directory on disk.
 */
function resolveProjectRoot(projectRoot?: string): string {
  if (!projectRoot) return currentRoot();
  const state = getState();
  const allowed = state.current
    ? [state.current.root, ...state.recent.map((r) => r.root)]
    : state.recent.map((r) => r.root);
  if (allowed.includes(projectRoot)) return projectRoot;
  console.warn(`[ipc] ignoring unrecognised projectRoot "${projectRoot}"; falling back to the open project`);
  return currentRoot();
}

/**
 * Every seeded agent name's own two classifications — agent-types.ts's type and
 * agent-project-tags.ts's project tag — for exactly the agents `implAgents`'s seed will have
 * instances for. What a skill's `projectTags`/`agentTypes` get matched against; see
 * `skill-tags.ts`'s `AgentAttrs`. Falls back to `"developer"`/`GLOBAL_TAG` for a name neither
 * store has ever seen (e.g. a custom impl-agent stack), which matches nothing more specific than a
 * skill explicitly tagged `global` on that axis.
 */
function seededAgentAttrs(implAgents: string[]): Record<string, AgentAttrs> {
  const types = readAllAgentTypes();
  const projectTags = readAllAgentProjectTags();
  const attrs: Record<string, AgentAttrs> = {};
  for (const name of seededAgentNames(implAgents)) {
    attrs[name] = { type: types[name] ?? "developer", projectTag: projectTags[name] ?? GLOBAL_TAG };
  }
  return attrs;
}

/**
 * The `SkillMap` a seed for `implAgents` should carry, built from the global skill-tags store —
 * deterministic, no Claude session involved. Bounded to `skills` (this project's discovered set)
 * and to `implAgents`'s seeded agents' own attributes, per `skillMapFromTags`'s guards.
 */
function skillMapForSeed(implAgents: string[], skills: DiscoveredDefinition[]) {
  return skillMapFromTags(
    readAllSkillTags(),
    skills.map((s) => s.id),
    seededAgentAttrs(implAgents)
  );
}

function announce(state: ProjectState): ProjectState {
  broadcast(IPC_EVENTS.projectChanged, state);
  retargetTails();
  // Outstanding previews name the OUTGOING project's working directory. A modal left open across
  // a project switch would otherwise still hold a runnable token, and pressing Run would spawn
  // Claude against the repo the window is no longer showing — the same class of bug the workflow
  // store's projectRoot key exists for. Runs already in flight keep their own cwd and are left alone.
  clearInvocations();
  // A live session ENDS on a switch, and nothing is started against the new project. Not a
  // retarget, unlike the tails above: a tail has no state to lose and a conversation does, so
  // silently re-pointing a transcript about repository A at repository B would be worse than
  // losing it — and starting one implicitly would spend the user's subscription on a project they
  // have only just opened. Same failure class as `seedWorkflowStore`'s keying; both prior
  // instances of it were silent.
  endAllSessions();
  return state;
}

export function registerIpc(): void {
  // ── project ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.projectGet, (): ProjectState => getState());

  ipcMain.handle(IPC.projectPick, async (): Promise<ProjectState | null> => {
    const res = await dialog.showOpenDialog({
      title: "Open project",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return announce(openProject(res.filePaths[0]));
  });

  ipcMain.handle(IPC.projectOpen, (_e, root: string): ProjectState => announce(openProject(root)));
  ipcMain.handle(IPC.projectForget, (_e, root: string): ProjectState => announce(forgetProject(root)));

  // ── loaders ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.workflowsData, async (): Promise<WorkflowsData> => {
    const projectRoot = currentRoot();
    if (!projectRoot) {
      return { projectRoot: "", config: blankConfig(), seeded: false, detection: null, agents: [], skills: [] };
    }
    const [agents, skills] = await Promise.all([
      discoverAgents(projectRoot, bundledAgentsDir()),
      discoverSkills(projectRoot),
    ]);
    const onDisk = readConfig(projectRoot);
    if (onDisk) return { projectRoot, config: onDisk, seeded: false, detection: null, agents, skills };

    // First open of an unconfigured project: hand back the starter workflows so the canvas isn't
    // empty — with the implementation chain READ OFF THE REPO rather than hardcoded to
    // ["backend"], which gave a frontend project a backend agent and made the first thing the
    // user saw wrong about their own codebase. The detection travels with the seed so the UI can
    // show what it matched and let the user correct the chain before anything is written.
    const detection = detectImplAgents(projectRoot);
    return {
      projectRoot,
      config: defaultV3Config(detection.implAgents, skillMapForSeed(detection.implAgents, skills)),
      seeded: true,
      detection,
      agents,
      skills,
    };
  });

  // The user amending the detection. Pure — nothing is written, so the chain can be corrected as
  // many times as it takes and the project stays unconfigured until Save.
  ipcMain.handle(IPC.workflowsReseed, async (_e, implAgents: string[]): Promise<MaestroConfigV3> => {
    const clean = (Array.isArray(implAgents) ? implAgents : []).map((a) => String(a).trim()).filter(Boolean);
    const projectRoot = currentRoot();
    const skills = projectRoot ? await discoverSkills(projectRoot) : [];
    return defaultV3Config(clean, skillMapForSeed(clean, skills));
  });

  ipcMain.handle(IPC.rulesData, async (): Promise<RulesData> => {
    const projectRoot = currentRoot();
    if (!projectRoot) {
      return {
        projectRoot: "",
        config: blankConfig(),
        seeded: false,
        tree: [],
        projectRules: [],
        vibeRules: [],
        vibeRulesAvailable: false,
      };
    }
    const [vibeRules, vibeRulesAvailable] = await Promise.all([discoverVibeRules(), hasVibeRules()]);
    const onDisk = readConfig(projectRoot);
    return {
      projectRoot,
      config: onDisk ?? blankConfig(),
      seeded: onDisk === null,
      tree: discoverProjectTree(projectRoot),
      projectRules: discoverProjectRules(projectRoot),
      vibeRules,
      vibeRulesAvailable,
    };
  });

  // `/maestro`'s post-install Project Tags section. No route loader — fetched imperatively, same
  // as that page's existing `install:status` call.
  ipcMain.handle(IPC.projectTagsData, (): ProjectTagsData => {
    const catalog = readAllProjectTags();
    const projectRoot = currentRoot();
    if (!projectRoot) return { catalog, selected: [] };
    return { catalog, selected: readConfig(projectRoot)?.project_tags ?? [] };
  });

  // ── the read-only surface folded in from help-server ──────────────────
  // Two loaders, four tabs and two doc views. help-server ran six server functions for the same
  // screens, two of which each re-read `installed_plugins.json` to compute their own `isInstalled`
  // column; here the machine is read once per view and the tabs cannot disagree.
  //
  // Neither of these rejects. Every part is optional in a real project — no `.claude-plugin/`, no
  // `rules/`, no `docs/` — so an absent directory is an empty section, and the route says which
  // parts are empty. `data:doc` below is the exception, and deliberately so.
  ipcMain.handle(IPC.toolsData, async (_e, viewingRoot?: string): Promise<ToolsData> => {
    const projectRoot = resolveProjectRoot(viewingRoot);
    const [installedPlugins, projectMarketplace, curated, agents, skills] = await Promise.all([
      listInstalledPlugins(),
      readProjectMarketplace(projectRoot),
      listCuratedPlugins(),
      discoverAgents(projectRoot, bundledAgentsDir()),
      discoverSkills(projectRoot),
    ]);
    return {
      projectRoot,
      installedPlugins,
      projectMarketplace,
      curated,
      ruleLibrary: discoverRuleLibrary(projectRoot),
      commands: readClaudeCommands(projectRoot),
      marketplaces: listMarketplaces({ includeRemote: true }),
      projectRules: discoverProjectRules(projectRoot),
      agents,
      skills,
    };
  });

  ipcMain.handle(IPC.docsData, (): DocsData => {
    const projectRoot = currentRoot() ?? "";
    return { projectRoot, docs: listDocs(projectRoot), sections: docSections(projectRoot) };
  });

  // Throws on an invalid slug, a missing file and an unreadable one — three states a reader that
  // returned "" would render identically, as an empty page with no explanation. `readDoc` also
  // refuses any slug carrying a separator or a dot, so the only file this can open is one directly
  // inside the open project's `docs/`.
  ipcMain.handle(IPC.docContent, (_e, slug: string): DocContent => {
    const root = currentRoot();
    if (!root) throw new Error("No project is open.");
    return readDoc(root, slug);
  });

  // ── the global docs page ────────────────────────────────────────────
  // NOT gated on `currentRoot()` — the corpus is read from a directory the app SHIPS, resolved
  // fresh on every call (never cached at module load) so an env override set between calls, e.g. in
  // a test, is honoured immediately.
  ipcMain.handle(IPC.globalDocsData, (): GlobalDocsData => {
    return globalDocsData({ app: maestroAppDocsDir() });
  });

  // Throws on an invalid slug, a missing file, and an unreadable one — same discipline as `data:doc`
  // above.
  ipcMain.handle(IPC.globalDocContent, (_e, group: "app", slug: string): DocContent => {
    return readGlobalDoc(group, slug, { app: maestroAppDocsDir() });
  });

  // ── save ─────────────────────────────────────────────────────────────
  // The milestone in one handler: write maestro.json, re-render the orchestrator, apply the rule
  // placements. No Claude session, no result file, no container.
  ipcMain.handle(IPC.configSave, async (_e, input: SaveInput) => {
    const projectRoot = currentRoot();
    if (!projectRoot) throw new Error("No project is open.");
    return saveConfig(projectRoot, input);
  });

  // `/maestro`'s Project Tags checkboxes. Saves the project-tags slice, then unions in any bundled
  // agent whose stored `agent-project-tags.ts` assignment newly matches one of the ADDED tags —
  // never on an unchecked one, so unchecking a tag can't silently rip an agent out of a graph the
  // user has already wired up; that stays a manual /workflows edit.
  ipcMain.handle(IPC.projectTagsSet, async (_e, tags: string[]): Promise<string[]> => {
    const projectRoot = currentRoot();
    if (!projectRoot) throw new Error("No project is open.");
    const before = new Set(readConfig(projectRoot)?.project_tags ?? []);
    await saveConfig(projectRoot, { sliceType: "project-tags", slice: { project_tags: tags } });

    const newlyAdded = tags.filter((t) => !before.has(t));
    if (newlyAdded.length > 0) {
      // Scoped to THIS project (030): otherwise a project-tier agent belonging to some other
      // project, sharing both this agent's name and the newly-added tag, could get pulled into a
      // graph it has nothing to do with.
      const matchingAgents = agentsForProjectTags(newlyAdded, undefined, projectRoot);
      const current = readConfig(projectRoot);
      if (current) {
        const agentsAvailable = new Set(current.agents_available);
        let changed = false;
        for (const agent of matchingAgents) {
          if (!agentsAvailable.has(agent)) {
            agentsAvailable.add(agent);
            changed = true;
          }
        }
        if (changed) {
          await saveConfig(projectRoot, {
            sliceType: "workflows",
            slice: {
              agents_available: Array.from(agentsAvailable),
              skills_available: current.skills_available,
              workflow_instances: current.workflow_instances,
              workflows: current.workflows,
            },
          });
        }
      }
    }

    return tags;
  });

  // ── reports (/agents page) ──────────────────────────────────────────
  // Resolution reads whatever project is open; a plain read, never rejects on no project (an
  // agent with no project open just resolves against the global tier alone).
  ipcMain.handle(IPC.reportGet, (_e, agentName: string): ResolvedReport => {
    const projectRoot = currentRoot();
    return getResolvedReport(projectRoot ?? "", agentName);
  });
  // Plain file write — no Claude session, no claude:preview/run, no token. Always writes a
  // PROJECT override keyed by the agent's own name (see saveProjectReportOverride's header).
  ipcMain.handle(IPC.reportSave, (_e, agentName: string, content: string): ResolvedReport => {
    const projectRoot = currentRoot();
    if (!projectRoot) throw new Error("No project is open.");
    return saveProjectReportOverride(projectRoot, agentName, content);
  });

  // ── templates (/templates page — the GLOBAL tier's write path — AND /agents' per-agent
  //    classification, which shares these same three stores with a different intent) ──────
  //
  // `/templates` never sends `projectScoped`, so it always sees/edits the machine-wide fallback —
  // no `currentRoot()` involved on that path, and nothing on that page needs a project open.
  // `/agents` sends `projectScoped: true` only for a `project`-tier agent (never for a
  // `user`/`maestro`/plugin one, which still resolves to the one shared global row from any
  // project — `030`). The renderer never sends a path: `projectScoped` is a plain flag, and main
  // resolves it against ITS OWN `currentRoot()`, the same "a caller states intent, never nominates
  // a directory" discipline `scaffold.ts`'s create-* flows already follow.
  ipcMain.handle(IPC.templateReportsList, (): Record<string, ReportDefault> => readAllAgentReportDefaults());
  ipcMain.handle(IPC.templateReportSave, (_e, agentName: string, content: string): ReportDefault => {
    return writeAgentReportDefault(agentName, content);
  });
  ipcMain.handle(IPC.templateAgentTypesList, (_e, projectScoped?: boolean): Record<string, AgentType> => {
    return readAllAgentTypes(undefined, projectScoped ? (currentRoot() ?? undefined) : undefined);
  });
  ipcMain.handle(
    IPC.templateAgentTypeSave,
    (_e, agentName: string, tag: AgentType, projectScoped?: boolean): AgentType => {
      return setAgentType(agentName, tag, undefined, projectScoped ? (currentRoot() ?? undefined) : undefined);
    }
  );
  ipcMain.handle(IPC.templateProjectTagsList, (): string[] => readAllProjectTags());
  ipcMain.handle(IPC.templateProjectTagAdd, (_e, tag: string): string[] => addProjectTag(tag));
  ipcMain.handle(IPC.templateProjectTagRemove, (_e, tag: string): string[] => removeProjectTag(tag));
  ipcMain.handle(IPC.templateAgentProjectTagsList, (_e, projectScoped?: boolean): Record<string, string> => {
    return readAllAgentProjectTags(undefined, projectScoped ? (currentRoot() ?? undefined) : undefined);
  });
  ipcMain.handle(
    IPC.templateAgentProjectTagSave,
    (_e, agentName: string, tag: string, projectScoped?: boolean): string => {
      return setAgentProjectTag(agentName, tag, undefined, projectScoped ? (currentRoot() ?? undefined) : undefined);
    }
  );

  // ── skill tags ───────────────────────────────────────────────────────
  // Global, keyed by skill id — no project involved. Two independent dimensions, two independent
  // setters (mirroring the two independent pill rows in the Skills tab), each returning the stored
  // (deduped, sorted) values back so the tab renders what's actually on disk rather than its own
  // optimistic guess.
  ipcMain.handle(IPC.skillProjectTagsSet, (_e, skillId: string, tags: string[]): string[] => {
    return setSkillProjectTags(skillId, tags);
  });
  ipcMain.handle(IPC.skillAgentTypesSet, (_e, skillId: string, tags: string[]): string[] => {
    return setSkillAgentTypes(skillId, tags);
  });

  // ── agent avatars ───────────────────────────────────────────────────
  // Global by default, keyed by agent name, no token: purely cosmetic. Same `projectScoped`
  // discipline as the templates handlers above — `/agents` and `create-subagent`'s `target:
  // "project"` field pass it for a project-tier agent; everything else (including `/templates`,
  // were it ever to grow an avatar tab) omits it and stays global.
  ipcMain.handle(IPC.avatarGet, (_e, agentName: string): AvatarLayers | null => {
    return getAvatar(agentName);
  });
  ipcMain.handle(
    IPC.avatarSet,
    (_e, agentName: string, layers: AvatarLayers, projectScoped?: boolean): AvatarLayers => {
      return setAvatar(agentName, layers, undefined, projectScoped ? (currentRoot() ?? undefined) : undefined);
    }
  );
  ipcMain.handle(IPC.avatarList, (_e, projectScoped?: boolean): Record<string, AvatarLayers> => {
    return readAllAvatars(undefined, projectScoped ? (currentRoot() ?? undefined) : undefined);
  });

  // ── agent descriptions ──────────────────────────────────────────────
  // The one handler that edits a subagent definition in place. `currentRoot()` matters here even
  // though the other per-agent attributes ignore it: the project tier outranks the user, bundled
  // and plugin ones, so which file this writes depends on which project is open — exactly as the
  // list the user is looking at does. Every refusal is a throw with a reason (see
  // `setAgentDescription`), so a read-only or plugin-owned agent reports why rather than appearing
  // to save.
  ipcMain.handle(IPC.agentDescribe, (_e, agentName: string, description: string): Promise<AgentDescriptionResult> => {
    return setAgentDescription(currentRoot() ?? "", bundledAgentsDir(), agentName, description);
  });

  // "Fork into this project" — the card's escape hatch for the three tiers `agent:describe`
  // refuses. Same `currentRoot()` discipline as above: which project's `.claude/agents/` the copy
  // lands in depends on which project is open.
  ipcMain.handle(IPC.agentFork, (_e, agentName: string, newName?: string): Promise<AgentForkResult> => {
    return forkAgent(currentRoot() ?? "", bundledAgentsDir(), bundledPluginVersion(), agentName, newName);
  });

  // ── forked-agent sync (031) ─────────────────────────────────────────
  // A read and a write, deliberately two channels: `agent:sync` runs on every project selection
  // and must be incapable of touching `.claude/agents/`, while `agent:sync:apply` writes one file
  // for one named action the user pressed a button for.
  //
  // `bundled` is this build's own `plugins/maestro`, handed in so a dev checkout resolves the
  // `maestro` plugin's templates even when no marketplace ever installed it; every other plugin
  // falls through to `~/.claude/plugins/installed_plugins.json` — which is what a bare terminal
  // session reads too, so the two paths compare against the same files.
  const agentSyncOptions = () => ({ bundled: { agentsDir: bundledAgentsDir(), version: bundledPluginVersion() } });
  ipcMain.handle(IPC.agentSync, (): Promise<AgentSyncSummary> => {
    return computeAgentSync(currentRoot() ?? "", agentSyncOptions());
  });
  ipcMain.handle(
    IPC.agentSyncApply,
    (_e, agentName: string, action: AgentSyncAction): Promise<AgentSyncApplyResult> => {
      return applyAgentSync(currentRoot() ?? "", agentName, action, agentSyncOptions());
    }
  );

  // ── tasks ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.tasksList, () => listTasks(currentRoot()));
  ipcMain.handle(IPC.tasksClose, (_e, filename: string) => closeTask(currentRoot(), filename));

  // ── create-* ─────────────────────────────────────────────────────────
  // The deterministic half of the four create forms. `create:scaffold` is the ONLY channel in the
  // app that writes an artifact from a form, and it cannot reach a model — `scaffoldCreate` is a
  // pure function of the request plus the filesystem. Whatever it leaves unfinished goes back out
  // through `claude:preview` below, so the model half is confirmed like every other one.
  //
  // Note what does not cross this wire: a destination path. The renderer sends a marketplace NAME
  // it picked out of `create:options`, and `target: "project"` means the project THIS process has
  // open — so main resolves every path it writes to. The one exception is create-marketplace's
  // target directory, which is the whole point of that form and is validated as absolute and shown
  // in the scaffold's report.
  ipcMain.handle(IPC.createOptions, async (): Promise<CreateOptions> => ({
    marketplaces: listMarketplaces(),
    projectRoot: currentRoot() ?? "",
    agentTemplates: await discoverAgents(currentRoot() ?? "", bundledAgentsDir()),
  }));

  // Throws on an invalid request or a failed write, so the caller must go through `callMain` —
  // "the write failed and here is why" has to reach the user, not an unhandled rejection.
  //
  // `nodeGit()` is the composition root for the one create step that is not `fs`: a new marketplace
  // is initialised as a repository and committed here, rather than by asking a model to run `git`.
  // The scaffold takes it as a port so its import graph stays spawn-free (see `GitPort`), which
  // means THIS line is what makes a new marketplace a repository — `test/isolation.test.ts` pins it.
  ipcMain.handle(IPC.createScaffold, (_e, request: CreateRequest): ScaffoldResult => {
    const result = scaffoldCreate(currentRoot() ?? "", request, { git: nodeGit() });
    if (!result.scaffolded) throw new Error(result.reason ?? "Nothing was written.");
    return result;
  });

  // ── install ──────────────────────────────────────────────────────────
  // The other half of the milestone: a project's Maestro runtime — the orchestrator skill, the
  // hook scripts, and the hook registrations in the project's OWN .claude/settings.json — is
  // installed and updated from here rather than by /maestro-install in a Claude session.
  ipcMain.handle(IPC.installStatus, async (_e, viewingRoot?: string): Promise<InstallStatus> => {
    const root = resolveProjectRoot(viewingRoot);
    if (!root) throw new Error("No project is open.");
    return installStatus(root);
  });

  ipcMain.handle(IPC.installRun, async (_e, viewingRoot?: string): Promise<InstallReport> => {
    const root = resolveProjectRoot(viewingRoot);
    if (!root) throw new Error("No project is open.");
    return installRuntime(root);
  });

  // Task 027. Called on project selection (see ProjectProvider/InstallProvider on the renderer
  // side) rather than folded into installStatus above: status stays a pure read, this is the one
  // channel allowed to write as a side effect of "the user looked at a project."
  ipcMain.handle(IPC.installAutoRefresh, async (_e, viewingRoot?: string): Promise<InstallReport | null> => {
    const root = resolveProjectRoot(viewingRoot);
    if (!root) return null;
    return refreshStaleRuntime(root);
  });

  ipcMain.handle(IPC.installUninstallPlan, (_e, viewingRoot?: string): UninstallPlan => {
    const root = resolveProjectRoot(viewingRoot);
    if (!root) throw new Error("No project is open.");
    return uninstallPlan(root);
  });

  // Two levels, and the destructive one is opt-in on this side of the boundary as well: `purge`
  // and `deleteMaestroTasks` both come off the payload with an explicit `=== true`, so a malformed
  // or absent argument can only ever produce the level that keeps maestro.json and the task queue.
  ipcMain.handle(
    IPC.installUninstall,
    async (
      _e,
      opts?: { purge?: boolean; deleteMaestroTasks?: boolean },
      viewingRoot?: string
    ): Promise<UninstallReport> => {
      const root = resolveProjectRoot(viewingRoot);
      if (!root) throw new Error("No project is open.");
      return uninstallRuntime(root, {
        purge: opts?.purge === true,
        deleteMaestroTasks: opts?.deleteMaestroTasks === true,
      });
    }
  );

  // ── the claude -p bridge ─────────────────────────────────────────────
  // Two handlers, and which one can spawn is the point. `previewClaudeRun` comes from a module
  // that imports no child_process (asserted by test/core/claude.test.ts), so the channel the
  // renderer calls to BUILD a prompt has no path to a process. `runPreviewedClaude` takes the
  // token that preview issued and nothing else — there is no argument on this channel by which a
  // renderer could describe a different run, which is why "the only executable prompts are ones
  // the user was shown" is a property of the wiring rather than of the UI behaving itself.
  //
  // `nodeSettings()` is the second capability this file supplies, alongside `nodeGit()` above and
  // for the same structural reason: resolving the settings cascade lives in the Agent SDK, which
  // can start processes, and `claude-preview.ts` may import nothing that can. Injected here, the
  // preview reports what a run will ACTUALLY be able to read — including directories and permission
  // rules contributed by settings files the app never chose — instead of echoing its own arguments.
  // Drop this argument and the disclosure does not break: it correctly starts saying the settings
  // were not consulted, which is a quieter regression than a missing repository, so
  // `test/isolation.test.ts` pins this line too.
  ipcMain.handle(IPC.claudePreview, async (_e, request: ClaudeRequest): Promise<ClaudePreview> => {
    const root = currentRoot();
    if (!root) throw new Error("No project is open.");
    return previewClaudeRun(root, request, { settings: nodeSettings() });
  });

  ipcMain.handle(IPC.claudeRun, async (e, token: string): Promise<ClaudeRunResult> =>
    runPreviewedClaude(token, {
      // Chunk by chunk, as it arrives. The token identifies the run on both sides, so the renderer
      // can route output from the first byte without waiting for this handler to resolve.
      output: (chunk) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC_EVENTS.claudeOutput, { token, ...chunk });
      },
      // The same plugin the pane loads, for the same reason and with the same caveat: without it
      // the create-* skills the prompt names resolve to nothing at all. `026` deleted the inlined
      // copies of that guidance, so this line is what a headless run finishes an artifact with.
      pluginDir: bundledPluginDir(),
    })
  );

  ipcMain.handle(IPC.claudeCancel, (_e, token: string): void => {
    cancelClaudeRun(token);
  });

  // ── the session pane ─────────────────────────────────────────────────
  // The app's second way to reach a model, and the difference from the bridge above is who wrote
  // the prompt. A turn needs no preview and no token, because there is nothing for main to have
  // authored: `session:say` forwards TEXT THE USER TYPED and the SDK is told so
  // (`origin: { kind: "human" }`). What the session may do is decided entirely in main — the cwd
  // comes from the open project and the readable directories from `known_marketplaces.json`.
  //
  // The write scope starts empty and ONE channel can append to it: `session:handoff`, which takes a
  // preview token and continues a create-* form's work here. It borrows the bridge's token for the
  // bridge's reason — the directory that becomes writable is the one main resolved and the
  // confirmation displayed, and no argument on this surface can name another.
  //
  // One session per window, ended on a project switch (see `announce`) and reaped on quit.
  ipcMain.handle(IPC.sessionStart, async (e): Promise<SessionInfo> => {
    // The window going away is the case that leaves a detached `claude` running against the user's
    // repo with nothing left to stop it from — a reload counts, and there is no prompt timeout to
    // rescue it.
    e.sender.once("destroyed", () => endSession(e.sender.id));
    return startSession(e.sender.id, currentRoot() ?? "");
  });

  // The one channel that can widen what a session may WRITE, and it takes a preview token exactly
  // as `claude:run` does. Everything it opens comes off the invocation main recorded when it built
  // that preview — the artifact's own directory, resolved by the same `resolveCreateTarget` the
  // scaffold wrote with — so the renderer nominates no directory here any more than it nominates a
  // prompt above. Claiming the token consumes it: a preview is spent headlessly or in the pane.
  ipcMain.handle(IPC.sessionHandoff, async (e, token: string): Promise<SessionInfo> => {
    e.sender.once("destroyed", () => endSession(e.sender.id));
    return handoffToSession(e.sender.id, currentRoot() ?? "", token);
  });

  ipcMain.handle(IPC.sessionInfo, async (e): Promise<SessionInfo> => sessionInfo(e.sender.id, currentRoot() ?? ""));

  ipcMain.handle(IPC.sessionSay, (e, id: string, text: string): boolean => saySession(e.sender.id, id, text));

  ipcMain.handle(IPC.sessionStop, async (e, id: string): Promise<boolean> => stopSession(e.sender.id, id));

  // A parked permission request, answered. The renderer sends a CHOICE — allow, deny, stop, or a
  // grant's scope word, plus the reason the model is told — and `answerPermission` builds the
  // SDK-shaped result from it, so no permission RULE, mode or destination can be authored on this
  // side of the wire. A grant's one permitted update is `addDirectories` with
  // `destination: "session"`, which never reaches disk.
  ipcMain.handle(
    IPC.sessionPermission,
    async (e, id: string, requestId: string, choice: PermissionChoice): Promise<boolean> =>
      answerPermission(e.sender.id, id, requestId, choice)
  );

  // A parked question, answered. The renderer sends a SELECTION — which question, which of the
  // labels it offered, or a freeform reply — and nothing on this path builds the payload the tool
  // reads: `answerQuestion` forwards, and the session validates every label against the options the
  // model actually sent before writing them into the call.
  ipcMain.handle(
    IPC.sessionQuestion,
    async (e, id: string, requestId: string, choice: QuestionChoice): Promise<boolean> =>
      answerQuestion(e.sender.id, id, requestId, choice)
  );

  // A grant taken back. It removes an entry main is already holding and can only ever NARROW what
  // the session may read — which is why a path is allowed to cross here while granting sends a
  // scope word and lets main resolve the path from the prompt it asked.
  ipcMain.handle(IPC.sessionRevoke, async (e, id: string, target: string): Promise<boolean> =>
    revokeGrant(e.sender.id, id, target)
  );

  // The door in the spend ceiling. A session that reached it ended cleanly and kept its record —
  // the id to resume, what it had spent, what it had been given — so continuing takes the session
  // id and nothing else, and the allowance it gets is `paneBudget()`'s, never a caller's.
  ipcMain.handle(IPC.sessionContinue, async (e, id: string): Promise<SessionInfo> => {
    e.sender.once("destroyed", () => endSession(e.sender.id));
    return continueSession(e.sender.id, id);
  });

  // Picking up a conversation this app did not start (`025`) — the list, the disclosure, the attach.
  // Each takes what main published: the list takes nothing (the project is main's own state), and
  // the other two take an id that must have been on a list this window was given. That check is the
  // whole difference from `session:continue`, where an id is a key into main's own record and here
  // it names a file in the CLI's store.
  ipcMain.handle(IPC.sessionResumable, async (e): Promise<ResumableSession[]> =>
    listResumableSessions(e.sender.id, currentRoot() ?? "")
  );

  ipcMain.handle(IPC.sessionResumeDetail, async (e, id: string): Promise<ResumeDisclosure> =>
    describeResume(e.sender.id, currentRoot() ?? "", id)
  );

  // The attach itself, and the one call on this surface that opens a session against a transcript
  // the app never wrote. It forks, so the terminal session the user started keeps its own history.
  ipcMain.handle(IPC.sessionResume, async (e, id: string): Promise<SessionInfo> => {
    e.sender.once("destroyed", () => endSession(e.sender.id));
    return resumeSession(e.sender.id, currentRoot() ?? "", id);
  });

  // The two header controls that change a LIVE session without ending it. Both values are checked
  // in main against a list main itself produced — the effort levels the query is configured from,
  // and the models the CLI reported — so neither can put an arbitrary string into the session.
  ipcMain.handle(IPC.sessionEffort, async (e, id: string, effort: SessionEffort): Promise<boolean> =>
    setSessionEffort(e.sender.id, id, effort)
  );

  ipcMain.handle(IPC.sessionModel, async (e, id: string, model: string | null): Promise<boolean> =>
    setSessionModel(e.sender.id, id, model)
  );

  ipcMain.handle(IPC.sessionEnd, (e): void => endSession(e.sender.id));

  // ── usage stats ──────────────────────────────────────────────────────
  // The same two-handler shape, and for a reason of its own: with no `ccusage` installed locally,
  // answering this question DOWNLOADS A PACKAGE FROM NPM AND EXECUTES IT. help-server did that on
  // every view of its Stats tab, silently, on `@latest`. Here `stats:preview` reads the machine
  // and reports what would run — including `network: true` and the pinned version — without
  // spawning, and `stats:run` accepts only the token it issued. src/core/ccusage.ts has the
  // decision in full.
  //
  // Never rejects: a machine with neither ccusage nor npx is a normal machine, and the tab says so
  // rather than handing the renderer an error boundary.
  ipcMain.handle(IPC.statsPreview, (_e, view: UsageStatsView): UsageStatsPreview =>
    previewUsageStats(currentRoot() ?? "", view)
  );

  ipcMain.handle(IPC.statsRun, async (_e, token: string, view: UsageStatsView): Promise<UsageStatsResult> =>
    runUsageStats(token, view)
  );

  // ── session log ──────────────────────────────────────────────────────
  // No separate snapshot channel: `subscribe` emits the full snapshot as its first `init`, so a
  // second way to ask for the same bytes is surface with no consumer.
  ipcMain.handle(IPC.logSubscribe, (e) => {
    startTail(e.sender.id);
    e.sender.once("destroyed", () => stopTail(e.sender.id));
  });

  ipcMain.handle(IPC.logUnsubscribe, (e) => stopTail(e.sender.id));

  // ── shell ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.revealInFolder, (_e, target: string) => {
    if (target) shell.showItemInFolder(target);
  });
}

export function disposeIpc(): void {
  for (const id of [...tails.keys()]) stopTail(id);
  // A cancelled run's child is spawned detached, so it outlives us by design unless it is killed.
  // Without this, quitting the app leaves Claude running against the user's repo with no window
  // left to stop it from.
  disposeClaudeRuns();
  // And the pane's sessions, which are detached for the same reason and outlive us the same way.
  disposeSessions();
}
