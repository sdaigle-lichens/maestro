// The contextBridge. This is the only thing the renderer can reach node through.
//
// Note what is NOT exposed: no `invoke(channel, …)` escape hatch, no fs, no child_process. The
// renderer can call exactly the operations enumerated in ../shared/ipc.ts and nothing else.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, IPC_EVENTS } from "../shared/ipc.js";
import type {
  ClaudeOutputChunk,
  MaestroApi,
  ProjectState,
  SaveInput,
  SessionEvent,
  SessionLogEntry,
} from "../shared/ipc.js";

const api: MaestroApi = {
  project: {
    get: () => ipcRenderer.invoke(IPC.projectGet),
    pick: () => ipcRenderer.invoke(IPC.projectPick),
    open: (root) => ipcRenderer.invoke(IPC.projectOpen, root),
    forget: (root) => ipcRenderer.invoke(IPC.projectForget, root),
    onChanged: (cb) => {
      const listener = (_e: unknown, state: ProjectState) => cb(state);
      ipcRenderer.on(IPC_EVENTS.projectChanged, listener);
      return () => ipcRenderer.removeListener(IPC_EVENTS.projectChanged, listener);
    },
  },
  data: {
    workflows: () => ipcRenderer.invoke(IPC.workflowsData),
    reseed: (implAgents) => ipcRenderer.invoke(IPC.workflowsReseed, implAgents),
    rules: () => ipcRenderer.invoke(IPC.rulesData),
    // `projectRoot` is a VIEWING parameter, forwarded as-is; main validates it against the current
    // + recent project list and falls back to the open project on anything else, so this cannot be
    // steered at an arbitrary directory.
    tools: (projectRoot) => ipcRenderer.invoke(IPC.toolsData, projectRoot),
    docs: () => ipcRenderer.invoke(IPC.docsData),
    // A slug, never a path: main joins it onto the open project's docs directory and refuses
    // anything with a separator or a dot in it, so this cannot be steered at another file.
    doc: (slug) => ipcRenderer.invoke(IPC.docContent, slug),
    // NOT gated on an open project — both read from directories the app ships. See
    // `src/core/global-docs.ts`.
    globalDocs: () => ipcRenderer.invoke(IPC.globalDocsData),
    globalDoc: (group, slug) => ipcRenderer.invoke(IPC.globalDocContent, group, slug),
  },
  config: {
    save: (input: SaveInput) => ipcRenderer.invoke(IPC.configSave, input),
  },
  skillTags: {
    set: (skillId, tags) => ipcRenderer.invoke(IPC.skillTagsSet, skillId, tags),
  },
  tasks: {
    list: () => ipcRenderer.invoke(IPC.tasksList),
    close: (filename) => ipcRenderer.invoke(IPC.tasksClose, filename),
  },
  create: {
    options: () => ipcRenderer.invoke(IPC.createOptions),
    // A request, never a path and never prompt text — same discipline as the claude channels
    // below, because the create routes reach the model through exactly those.
    scaffold: (request) => ipcRenderer.invoke(IPC.createScaffold, request),
  },
  install: {
    // `projectRoot` on each of these four is the same VIEWING parameter as `data.tools` above —
    // forwarded as-is, validated on the main side against the current + recent project list.
    status: (projectRoot) => ipcRenderer.invoke(IPC.installStatus, projectRoot),
    run: (projectRoot) => ipcRenderer.invoke(IPC.installRun, projectRoot),
    uninstallPlan: (projectRoot) => ipcRenderer.invoke(IPC.installUninstallPlan, projectRoot),
    uninstall: (opts, projectRoot) => ipcRenderer.invoke(IPC.installUninstall, opts, projectRoot),
  },
  claude: {
    preview: (request) => ipcRenderer.invoke(IPC.claudePreview, request),
    // The token is the ONLY thing that crosses on a run — no prompt, no argv, no cwd. Whatever
    // this renderer believes it is running, what actually runs is the invocation main recorded
    // when it built the preview. Keep it that way: an extra argument here is the whole hole.
    run: (token, onOutput) => {
      // The token doubles as the run's id, so output can be routed before the invoke resolves —
      // there is no window in which a chunk arrives with nothing to attribute it to.
      const listener = (_e: unknown, payload: ClaudeOutputChunk & { token: string }) => {
        if (payload.token === token) onOutput({ stream: payload.stream, chunk: payload.chunk });
      };
      ipcRenderer.on(IPC_EVENTS.claudeOutput, listener);
      return ipcRenderer
        .invoke(IPC.claudeRun, token)
        .finally(() => ipcRenderer.removeListener(IPC_EVENTS.claudeOutput, listener));
    },
    cancel: (token) => ipcRenderer.invoke(IPC.claudeCancel, token),
  },
  session: {
    // No argument: the project comes from main's own state, exactly as `claude:preview` takes its
    // cwd from there. A renderer cannot start a session against a directory of its choosing.
    start: () => ipcRenderer.invoke(IPC.sessionStart),
    // THE TOKEN AND NOTHING ELSE, exactly as on `claude:run` above, and here it is the write scope
    // rather than the prompt that rides on it: the invocation main recorded names the artifact its
    // own resolution chose, so whatever this renderer believes it is handing over, what the session
    // is given is the directory the confirmation displayed. An extra argument here — a path, a name,
    // a "cwd" — is the whole hole, and it is the only hole this channel could have.
    handoff: (token) => ipcRenderer.invoke(IPC.sessionHandoff, token),
    info: () => ipcRenderer.invoke(IPC.sessionInfo),
    // The session id and the USER'S TEXT. Nothing else crosses — no system prompt, no history, no
    // tool list, no directory. Main stamps the turn as human-authored; a preload that let the
    // renderer send anything more would be the renderer authoring a prompt, which is the one thing
    // this app's whole Claude surface is built to prevent.
    say: (id, text) => ipcRenderer.invoke(IPC.sessionSay, id, text),
    stop: (id) => ipcRenderer.invoke(IPC.sessionStop, id),
    // The request id and one of four words (with a grant's scope). NOT a `PermissionResult`: its
    // allow arm carries
    // `updatedPermissions`, which can add allow rules, flip the permission mode or widen the read
    // scope permanently — and write any of that into the user's own settings files. Main builds
    // the answer from this choice, exactly as it builds a prompt from a request above. A `grant`
    // carries `file` or `directory` and NO PATH: main resolves it against the prompt being answered.
    answer: (id, requestId, choice) => ipcRenderer.invoke(IPC.sessionPermission, id, requestId, choice),
    // The request id and a SELECTION: which question, and which of the labels it offered. Never the
    // `answers` map the tool reads — that is built at the far end from the questions the model
    // asked, so a label this side invented is refused rather than delivered. The `reply` arm carries
    // typed text, which is what `say` already carries.
    answerQuestion: (id, requestId, choice) => ipcRenderer.invoke(IPC.sessionQuestion, id, requestId, choice),
    // Narrowing only — see MaestroApi.session.revoke. Main matches the path against the grants it
    // already holds, so nothing here can open a directory that was not opened by an answered prompt.
    revoke: (id, path) => ipcRenderer.invoke(IPC.sessionRevoke, id, path),
    // THE SESSION ID AND NOTHING ELSE. A continuation is the same conversation with a fresh
    // allowance, and every part of it — which transcript to resume, what has been spent so far,
    // what the session had been given — comes off main's own record of the session that stopped.
    // An extra argument here (a ceiling, a session to resume) is the only hole this channel could
    // have, and it is the same hole `claude:run` refuses by taking a token alone.
    continue: (id) => ipcRenderer.invoke(IPC.sessionContinue, id),
    // NO ARGUMENT, then A SESSION ID FROM THE LIST THAT ANSWERED IT (`025`). `resumable` takes
    // nothing for the reason `start` takes nothing — the project is main's — and the two calls that
    // follow carry an id main published on that list and nothing else. No path, no project, no
    // transcript file: this is the one place on the surface where an id names something main has no
    // record of, so main checks it against what it offered THIS window rather than resolving it.
    resumable: () => ipcRenderer.invoke(IPC.sessionResumable),
    resumeDetail: (id) => ipcRenderer.invoke(IPC.sessionResumeDetail, id),
    resume: (id) => ipcRenderer.invoke(IPC.sessionResume, id),
    // A word from a closed set, and a model id from the list main published with the session.
    setEffort: (id, effort) => ipcRenderer.invoke(IPC.sessionEffort, id, effort),
    setModel: (id, model) => ipcRenderer.invoke(IPC.sessionModel, id, model),
    end: () => ipcRenderer.invoke(IPC.sessionEnd),
    subscribe: (onEvent) => {
      const listener = (_e: unknown, event: SessionEvent) => onEvent(event);
      ipcRenderer.on(IPC_EVENTS.sessionEvent, listener);
      return () => ipcRenderer.removeListener(IPC_EVENTS.sessionEvent, listener);
    },
  },
  stats: {
    // A view name, never an argv: main resolves `ccusage` and builds the command, exactly as it
    // builds a prompt for the claude channels. The renderer picks a tab; it cannot pick a binary.
    preview: (view) => ipcRenderer.invoke(IPC.statsPreview, view),
    // The token decides what runs. `view` rides along only so the result can be filed against the
    // tab that asked — the invocation itself comes from the token, same as `claude:run`.
    run: (token, view) => ipcRenderer.invoke(IPC.statsRun, token, view),
  },
  log: {
    subscribe: (handlers) => {
      const onInit = (_e: unknown, entries: SessionLogEntry[]) => handlers.onInit(entries);
      const onEntry = (_e: unknown, entry: SessionLogEntry) => handlers.onEntry(entry);
      const onReset = () => handlers.onReset();

      ipcRenderer.on(IPC_EVENTS.logInit, onInit);
      ipcRenderer.on(IPC_EVENTS.logEntry, onEntry);
      ipcRenderer.on(IPC_EVENTS.logReset, onReset);
      void ipcRenderer.invoke(IPC.logSubscribe);

      return () => {
        ipcRenderer.removeListener(IPC_EVENTS.logInit, onInit);
        ipcRenderer.removeListener(IPC_EVENTS.logEntry, onEntry);
        ipcRenderer.removeListener(IPC_EVENTS.logReset, onReset);
        void ipcRenderer.invoke(IPC.logUnsubscribe);
      };
    },
  },
  shell: {
    reveal: (target) => ipcRenderer.invoke(IPC.revealInFolder, target),
  },
};

contextBridge.exposeInMainWorld("maestro", api);
