// The session pane's owner — one live Claude session per WINDOW, held in main.
//
// SAME OWNERSHIP SHAPE AS THE LOG TAIL, and for the same reasons. One entry per `webContents.id`;
// starting a second for a window stops the first; a project switch ends the session and starts
// NOTHING against the new project; `disposeSessions()` on quit. A renderer that reloads or a
// window that closes must not leave a `claude` running against the user's repo, and the child is
// deliberately a detached process-group leader, so it outlives us unless something kills it.
//
// WHAT THIS MODULE MAY NOT DO. It never composes a prompt. `say` forwards the user's text verbatim
// into the SDK's input stream, stamped `origin: { kind: "human" }` by `startPaneSession`, and
// there is no other way to add a TURN. `handoffToSession` is the near miss and is not an exception:
// it appends context the user has already been shown — a preview they confirmed, phrased by
// `session-handoff.ts` — with `shouldQuery: false`, so it starts no turn, carries no `origin`, and
// asks the model for nothing. What it can add comes off a claimed token; nothing about it is
// supplied by the renderer. That is the pane's restatement of the bridge's invariant:
// `claude:run` guarantees the only executable prompts are ones the user was SHOWN; here the only
// prompts are ones the user WROTE. It also resolves no path to the CLI itself (`paneSessionTarget`
// does, inside the SDK module) and imports no `child_process` (`spawnClaudeChild` does) — both so
// the two reviewed lists in `test/isolation.test.ts` stay the length they are.

import { BrowserWindow } from "electron";
import {
  applySkillTagsBlock,
  buildReadScope,
  ceilingEnding,
  claimInvocation,
  formatUsd,
  grantOptionFor,
  handoffNotice,
  handoffSeed,
  handoffTitle,
  isEffortLevel,
  listMarketplaces,
  listStoredSessions,
  newSpend,
  nodeSettings,
  paneBudget,
  paneSessionTarget,
  parseSkillTagsBlock,
  permissionReason,
  readStoredMessages,
  renewAllowance,
  resumableFrom,
  resumeDisclosure,
  resumedNotice,
  spawnClaudeChild,
  startPaneSession,
  terminateChildGroup,
  withinDirectory,
  writeScopeNote,
  DEFAULT_EFFORT,
  PACING_UNSUPPORTED_NOTICE,
  PANE_SKILLS,
  PANE_TOOLS,
  type PaneSession,
} from "../core/index.js";
import { bundledPluginDir } from "./bundled-assets.js";
import { IPC_EVENTS } from "../shared/ipc.js";
import type {
  ClaudeReadScope,
  PermissionAnswer,
  PermissionChoice,
  PermissionPrompt,
  QuestionChoice,
  ResumableSession,
  ResumeDisclosure,
  SessionEffort,
  SessionEndReason,
  SessionEvent,
  SessionGrant,
  SessionInfo,
  SessionModel,
  SessionSpend,
  SessionWrite,
} from "../shared/ipc.js";

/**
 * The child `spawnClaudeChild` produced.
 *
 * Derived from that function rather than imported as `ChildProcess` from `node:child_process`, and
 * that is not stylistic: `test/isolation.test.ts` keeps the list of modules that can start a
 * process short enough to read, and it decides membership by looking for the specifier. A
 * type-only import would put this module on that list while spawning nothing — a false entry on a
 * list whose whole value is that every entry is worth reading.
 */
type ClaudeChild = ReturnType<typeof spawnClaudeChild>;

interface LiveSession {
  id: string;
  projectRoot: string;
  session: PaneSession;
  /** The child the spawn function produced, so the whole GROUP can be signalled on teardown. */
  child: ClaudeChild | null;
  /**
   * The prompts still waiting on a person, by request id.
   *
   * WHY MAIN KEEPS ITS OWN COPY. A grant answers a question about a NAMED path, and the renderer
   * sends only the word `file` or `directory` — so the path has to be recovered on this side of the
   * wire, from the question that was actually asked. Reading it off the event main just sent is what
   * makes "the renderer never nominates a directory" true rather than merely intended.
   */
  prompts: Map<string, PermissionPrompt>;
  /** What a person has granted, in force. Never written anywhere; dies with the entry. */
  grants: SessionGrant[];
  /**
   * What a submitted create-\* form opened for writing, in force. Same lifetime, same absence from
   * disk — and one more property: it can only ever have been appended by a claimed preview token.
   */
  writes: SessionWrite[];
  /**
   * What the conversation has spent, across every allowance it has been given (`024`).
   *
   * Recorded from the session's own `spend` events rather than accumulated here: the session is
   * the only thing that knows which `result` messages were turns, and a second accumulator would
   * be a second answer to the same question.
   */
  spend: SessionSpend;
  effort: SessionEffort;
  model: string | null;
  models: SessionModel[];
  /**
   * The CLI's id for this conversation, which is what a Continue resumes against.
   *
   * Read off the session when it ends rather than when it starts — the id is only known once the
   * CLI has initialised, and the moment it matters is the moment the session is over.
   */
  resumeId: string | null;
  /**
   * Set when the session has ended. THE ENTRY OUTLIVES A CEILING ON PURPOSE.
   *
   * A session that ran out of allowance leaves a transcript on disk and a user entitled to carry on
   * from it, so its entry stays — holding the id to resume, the figures to show, and the scope the
   * conversation already had. Every other ending deletes it, and so does every teardown path there
   * has ever been: `endSession`, a project switch, and quit are unchanged.
   */
  endReason: SessionEndReason | null;
  /** False once a model has refused a pacing budget, so the reopen does not send another. */
  pacing: boolean;
}

/** A session that can still take a turn. An exhausted entry is a record, not a conversation. */
function isLive(entry: LiveSession | undefined): entry is LiveSession {
  return Boolean(entry) && entry!.endReason === null;
}

/**
 * The ceilings this app runs sessions under, with a way to lower them for a probe.
 *
 * WHY AN ENVIRONMENT VARIABLE EXISTS AT ALL. The one thing about this feature that cannot be
 * unit-tested is the only thing that matters: that the CLI actually stops at the ceiling, that the
 * ending says which one, and that continuing resumes the conversation. Demonstrating that against
 * the $0.50 default costs $0.50 of somebody's subscription every time, which is the kind of check
 * people run once and then stop running. `MAESTRO_SESSION_CEILING_USD=0.02` makes it a cent, in
 * exactly the way `MAESTRO_AGENT_SDK_SMOKE` exists so the SDK's packaging failures can be seen from
 * a real launch. It can only ever be read from the environment of the process the user started —
 * nothing on any channel reaches it — and `paneBudget` clamps a nonsense value back to the default.
 */
function sessionBudget(): ReturnType<typeof paneBudget> {
  const ceiling = Number(process.env.MAESTRO_SESSION_CEILING_USD);
  const turns = Number(process.env.MAESTRO_SESSION_MAX_TURNS);
  return paneBudget({
    maxBudgetUsd: Number.isFinite(ceiling) && ceiling > 0 ? ceiling : undefined,
    maxTurns: Number.isFinite(turns) && turns >= 1 ? turns : undefined,
  });
}

/** Keyed by the webContents that asked for it — one session per window, never one per subscriber. */
const sessions = new Map<number, LiveSession>();

let nextId = 0;

/**
 * Sequence numbers for events this module injects rather than reads off the session.
 *
 * Negative and descending, so they can never collide with the session's own ascending counter —
 * the renderer keys transcript entries on `seq`, and two entries sharing one is a dropped line.
 */
let injectedSeq = 0;

/**
 * The trees a session may read beyond its working directory.
 *
 * The open project is the cwd and therefore already in scope; these are the marketplaces the user
 * has registered with Claude Code as `source: "directory"` — the same list the create forms write
 * into, resolved out of `~/.claude/plugins/known_marketplaces.json` by `listMarketplaces()`. A
 * conversation about authoring a skill is a conversation about those repositories, and a session
 * that cannot see the marketplace it is being asked about is one that guesses.
 *
 * A NAME never crosses the process boundary to get here and neither does a path: main resolves the
 * whole list for itself, which is the rule `scaffold.ts` already states — a renderer describes an
 * artifact and never nominates a directory.
 */
function additionalDirectories(): Array<{ path: string; note: string }> {
  return listMarketplaces().map((m) => ({
    path: m.path,
    note: `The "${m.name}" marketplace, registered in ~/.claude/plugins/known_marketplaces.json. Opened by the app.`,
  }));
}

/**
 * What the session can see, in the shape the confirmation dialog already renders.
 *
 * Never throws, for the reason `claude-preview.ts` gives: a cascade that cannot be resolved still
 * produces a scope naming the working directory, with `unresolved` saying why the rest is unknown.
 * Failing here would cost the user the whole pane over a disclosure detail.
 */
async function readScopeFor(
  projectRoot: string,
  extra: Array<{ path: string; note: string }>,
  granted: Array<{ path: string; note: string }> = []
): Promise<ClaudeReadScope> {
  const base = { projectRoot, cwd: projectRoot, targets: [], additional: extra, granted };
  try {
    return buildReadScope({ ...base, settings: await nodeSettings().resolve(projectRoot) });
  } catch (err) {
    return buildReadScope({
      ...base,
      settings: null,
      unresolved: `The settings files on disk could not be read: ${err instanceof Error ? err.message : String(err)}.`,
    });
  }
}

/** What a window's session can see and do right now. Starts nothing; `id` is null when none runs. */
export async function sessionInfo(webContentsId: number, projectRoot: string): Promise<SessionInfo> {
  return describeSession(projectRoot, sessions.get(webContentsId) ?? null);
}

/** How one grant reads in the disclosure, next to the app's own directories. */
function grantNote(grant: SessionGrant): string {
  const what = grant.scope === "file" ? "this file" : "this folder";
  return `You opened ${what} during this session, answering a ${grant.tool} prompt about ${grant.target}. It lasts until the session ends and nothing was written to disk.`;
}

/** How a handed-off write scope reads in the disclosure. It is readable BECAUSE it is writable. */
function writeNote(write: SessionWrite): string {
  return (
    `Opened by the ${write.kind} form you submitted, which scaffolded ${write.artifact}. ` +
    `The session may write ${writeScopeNote(write.scope)} here, and reads it without asking for the same reason. ` +
    `It lasts until the session ends and nothing was written to your settings.`
  );
}

/**
 * The header's answer for a given session id — same fields whether or not one is running.
 *
 * The write scope reaches the disclosure as an `origin: "app"` directory as well as `writes`, and
 * only when nothing already in scope contains it: a skill written into a marketplace the pane
 * already opened is not a new place the session can look, and listing it twice would make the one
 * list that is supposed to answer "what can this see" answer it twice, differently.
 */
export async function describeSession(projectRoot: string, entry: LiveSession | null): Promise<SessionInfo> {
  const cli = paneSessionTarget();
  const grants: readonly SessionGrant[] = entry?.grants ?? [];
  const writes: readonly SessionWrite[] = entry?.writes ?? [];
  const extra = projectRoot ? additionalDirectories() : [];
  const covered = [projectRoot, ...extra.map((d) => d.path), ...grants.map((g) => g.path)].filter(Boolean);
  const fromWrites = writes
    .filter((w) => !covered.some((root) => withinDirectory(root, w.path)))
    .map((w) => ({ path: w.path, note: writeNote(w) }));
  // With no session, the figures describe the one the user WOULD get — which is how the header can
  // state the ceiling before anything has been spent against it.
  const spend = entry?.spend ?? newSpend(sessionBudget());

  return {
    id: entry?.id ?? null,
    projectRoot,
    spend,
    endReason: entry?.endReason ?? null,
    // The door. Open only when a ceiling ended the session AND there is a transcript to resume.
    canContinue: Boolean(
      entry?.endReason && entry.endReason !== "closed" && entry.endReason !== "error" && entry.resumeId
    ),
    effort: entry?.effort ?? DEFAULT_EFFORT,
    model: entry?.model ?? null,
    models: entry?.models ?? [],
    cwd: projectRoot,
    read: await readScopeFor(
      projectRoot,
      [...extra, ...fromWrites],
      grants.map((g) => ({ path: g.path, note: grantNote(g) }))
    ),
    grants: [...grants],
    // Empty until a create-* form hands its completed preview over, then one entry per submit.
    // Derived from `writes` rather than tracked beside it, so the flat list and the attributed one
    // cannot come apart.
    writable: writes.map((w) => w.path),
    writes: [...writes],
    tools: [...PANE_TOOLS],
    skills: [...PANE_SKILLS],
    available: cli.available,
    unavailable: cli.unavailable,
  };
}

function send(webContentsId: number, event: SessionEvent): void {
  const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.id === webContentsId)?.webContents;
  if (wc && !wc.isDestroyed()) wc.send(IPC_EVENTS.sessionEvent, event);
}

/**
 * The other half of the `update-skill-tags` flow (see `session-handoff.ts` and the skill of the
 * same name): that flow has no tool to call `setSkillTags` with — `agent-sdk.ts`'s tool surface is
 * fixed, built-in tools only — so its last message carries one fenced JSON block instead, and this
 * is where it gets applied. A no-op for every other session: it only fires once a handoff for this
 * kind has actually widened `entry.writes`, which is the same gate `writeNote`/`grantNote` use to
 * tell one kind of write scope from another.
 */
function applyUpdateSkillTagsIfAny(webContentsId: number, entry: LiveSession, text: string): void {
  const write = entry.writes.find((w) => w.kind === "update-skill-tags");
  if (!write) return;
  const parsed = parseSkillTagsBlock(text);
  if (!parsed) return;
  const applied = applySkillTagsBlock(parsed, write.path);
  if (applied.length === 0) return;
  send(webContentsId, {
    kind: "notice",
    seq: --injectedSeq,
    text: `Applied tags for ${applied.join(", ")}.`,
  });
}

/**
 * Start a session for one window against the open project.
 *
 * Idempotent per window in the useful sense: an existing session is ENDED first, rather than a
 * second one being started beside it. Two sessions in a window would mean two transcripts, which
 * is the thing the help chat's deletion exists to prevent.
 */
export async function startSession(webContentsId: number, projectRoot: string): Promise<SessionInfo> {
  endSession(webContentsId);
  return openSession(webContentsId, projectRoot, {});
}

/**
 * What a continued (or reopened) conversation carries into its next session.
 *
 * Everything here is main's OWN record. Nothing on this shape can be supplied by a renderer, which
 * is what lets a Continue keep the scope the conversation already had: the grants came from prompts
 * a person answered and the writes from a claimed preview token, and carrying them forward moves
 * neither of those decisions anywhere new.
 */
interface CarriedSession {
  /** The CLI session id to pick the transcript back up from. */
  resume?: string | null;
  /**
   * Resume into a COPY rather than into the conversation itself (`025`).
   *
   * True for exactly one caller — `resumeSession`, attaching to a session the user started
   * elsewhere — and false for the two that resume this app's own: a Continue and the pacing reopen
   * are the same conversation carrying on, and forking either would leave two records of it.
   */
  fork?: boolean;
  /** The lifetime figures, with a fresh allowance already applied. */
  spend?: SessionSpend;
  grants?: SessionGrant[];
  writes?: SessionWrite[];
  effort?: SessionEffort;
  model?: string | null;
  /** False when a model has already refused a pacing budget — see `PACING_UNSUPPORTED_NOTICE`. */
  pacing?: boolean;
}

/**
 * Open a session against the project — the one place a `startPaneSession` call is made.
 *
 * `startSession`, `continueSession` and the pacing reopen all land here, because the three differ
 * only in what they carry in. A second builder would be a second set of query options to keep in
 * step, which is exactly how a resumed session ends up with a different tool set or a different
 * boundary than the one it is continuing.
 */
async function openSession(webContentsId: number, projectRoot: string, carried: CarriedSession): Promise<SessionInfo> {
  if (!projectRoot) throw new Error("No project is open.");

  const cli = paneSessionTarget();
  if (!cli.available || !cli.bin) {
    // Not an exception: the pane renders the reason and keeps its Copy-the-command fallback, the
    // same way the confirmation dialog does with no CLI installed.
    return describeSession(projectRoot, null);
  }

  const extra = additionalDirectories();
  const id = `s${++nextId}`;
  const entry: LiveSession = {
    id,
    projectRoot,
    session: null as unknown as PaneSession,
    child: null,
    prompts: new Map(),
    grants: carried.grants ? [...carried.grants] : [],
    writes: carried.writes ? [...carried.writes] : [],
    spend: carried.spend ?? newSpend(sessionBudget()),
    effort: carried.effort ?? DEFAULT_EFFORT,
    model: carried.model ?? null,
    models: [],
    resumeId: carried.resume ?? null,
    endReason: null,
    pacing: carried.pacing !== false,
  };

  entry.session = startPaneSession({
    cwd: projectRoot,
    bin: cli.bin,
    additionalDirectories: extra.map((d) => d.path),
    // Without this the six names in `PANE_SKILLS` resolve to nothing at all — `settingSources: []`
    // means no installed plugin reaches the session, and the help skill the deleted chat asked for
    // by name is the whole reason `Skill` is in the pane's tool set.
    pluginDir: bundledPluginDir(),
    budget: sessionBudget(),
    spend: entry.spend,
    effort: entry.effort,
    model: entry.model,
    resume: entry.resumeId,
    // Only ever true on the picker's resume. `PaneSession.sessionId()` then reports the FORK's id,
    // which is what a later Continue resumes — so the terminal session's transcript is read once and
    // written never.
    fork: carried.fork === true,
    pacing: entry.pacing,
    // The model would not take a pacing budget. Reopening without one is the whole recovery — the
    // hard ceiling is untouched, so nothing is widened by it.
    onPacingRejected: () => void reopenWithoutPacing(webContentsId, entry),
    emit: (event) => {
      // Every question is kept until it is answered, because answering a GRANT needs the path the
      // question named and the renderer does not send one. Resolved requests are dropped so the map
      // is bounded by what is actually on screen.
      if (event.kind === "permission") entry.prompts.set(event.request.requestId, event.request);
      if (event.kind === "permission-resolved") entry.prompts.delete(event.requestId);
      // The session owns the figures — it is the only thing that knows which results were turns —
      // so this records them rather than deriving a second answer beside it.
      if (event.kind === "spend") entry.spend = event.spend;
      if (event.kind === "settings") {
        entry.effort = event.effort;
        entry.model = event.model;
        entry.models = event.models;
      }
      if (event.kind === "assistant") applyUpdateSkillTagsIfAny(webContentsId, entry, event.text);
      send(webContentsId, event);
    },
    spawn: (options) => {
      const child = spawnClaudeChild(options);
      entry.child = child;
      child.on("error", (err: NodeJS.ErrnoException) => {
        send(webContentsId, {
          kind: "notice",
          seq: --injectedSeq,
          text: `Could not run ${options.command}: ${err.message}`,
        });
      });
      return child;
    },
  });

  sessions.set(webContentsId, entry);
  // The child is detached, so a session that ends on its own still has to be reaped.
  void entry.session.ended.then((end) => {
    if (entry.child) terminateChildGroup(entry.child);
    entry.child = null;
    entry.spend = end.spend;
    entry.endReason = end.reason;
    entry.resumeId = entry.session.sessionId() ?? entry.resumeId;
    if (sessions.get(webContentsId) !== entry) return;
    // A CEILING KEEPS THE ENTRY. It is what Continue resumes from — the id, the figures, and the
    // scope the conversation already had — and it is deleted by the same three teardown paths as
    // any other session. Every other ending is gone here and now, exactly as before.
    const continuable = (end.reason === "budget" || end.reason === "turns") && entry.resumeId !== null;
    if (!continuable) sessions.delete(webContentsId);
    else {
      // The ending itself is already in the transcript; this is the sentence that says what was
      // spent and what the button does, written where the pure module keeps every other one.
      send(webContentsId, {
        kind: "notice",
        seq: --injectedSeq,
        text: ceilingEnding(end.spend.ended ?? "budget", end.spend).text,
      });
    }
  });

  return describeSession(projectRoot, entry);
}

// ── Picking up a conversation this app did not start (`025`) ─────────────────────────────
//
// THE ONE GENUINE DIFFERENCE FROM A CONTINUE, and everything below is arranged around it: the id
// names a session MAIN HAS NO ENTRY FOR. `session:continue` resolves everything about the
// conversation from its own `LiveSession`, so the id it takes is only ever a key into main's own
// record. Here the id names a file in the CLI's store, so it has to have come from a list this
// process built and published — the same discipline as a model id being checked against
// `entry.models` and a grant's scope word being resolved against the prompt main asked.

/**
 * The session ids this window has been OFFERED, per `webContents.id`.
 *
 * Not a cache: the rows are re-read from the store on every list, because a session the user was
 * working in a minute ago should be there. This holds only the ids, and only so `resumeSession` can
 * refuse one that was never on screen — a renderer that invents a UUID gets a refusal rather than a
 * transcript out of some other project.
 */
const offered = new Map<number, Set<string>>();

/**
 * What the picker may show for the open project, newest first.
 *
 * Reads only. The `exclude` list is this window's own conversation — the live one and any exhausted
 * entry kept for Continue — because resuming your own session would fork it beside itself and leave
 * two records of one conversation with one of them on screen.
 */
export async function listResumableSessions(webContentsId: number, projectRoot: string): Promise<ResumableSession[]> {
  if (!projectRoot) return [];
  const entry = sessions.get(webContentsId);
  const mine = [entry?.resumeId, entry?.session ? entry.session.sessionId() : null].filter(
    (id): id is string => typeof id === "string" && id !== ""
  );
  const rows = resumableFrom(await listStoredSessions(projectRoot), { projectRoot, exclude: mine });
  offered.set(webContentsId, new Set(rows.map((r) => r.id)));
  return rows;
}

/**
 * What that conversation already read, and what replaying it costs — before anything is resumed.
 *
 * THE DISCLOSURE THIS SLICE EXISTS FOR. A transcript produced under the terminal session's rules can
 * already contain the contents of files from anywhere on disk, and this app's boundary applies to
 * what happens NEXT. Showing the list is what keeps "this session cannot leave the selected
 * directory" from being true of every future turn and quietly false of the context it starts with.
 *
 * The id must be one this window was offered, for the reason above. Resolving the row from the store
 * again rather than trusting a shape the renderer sent is the rest of it.
 */
export async function describeResume(
  webContentsId: number,
  projectRoot: string,
  id: string
): Promise<ResumeDisclosure> {
  const session = await resumableById(webContentsId, projectRoot, String(id ?? ""));
  const extra = additionalDirectories();
  return resumeDisclosure({
    session,
    messages: await readStoredMessages(session.id, projectRoot),
    // What THIS pane's session may read, so `inScope` answers "would today's boundary have allowed
    // it". Grants are not in it and cannot be: a resumed session starts with none.
    directories: [projectRoot, ...extra.map((d) => d.path)],
  });
}

/**
 * Attach to it — forking, so the session the user started keeps its own history.
 *
 * A FOURTH CALLER OF `openSession`, and deliberately nothing more than that. The tool set, the read
 * boundary, `settingSources: []`, `permissionMode: "default"` and the preset prompt are composed in
 * one place for every caller, so a resumed session is subject to the same rules as a fresh one by
 * construction rather than by a second code path that has to be kept in step.
 *
 * What it carries in is the id and nothing else. No grants — they die with an entry and are written
 * nowhere, so there is nothing on disk for a resume to restore, and a path that conversation read
 * freely raises a prompt on the first turn here. No write scope, for the same reason plus a stronger
 * one: a write scope entry answers a form THIS user submitted in THIS app. And a fresh allowance,
 * because the spend on the other conversation was not measured against this app's ceiling.
 */
export async function resumeSession(webContentsId: number, projectRoot: string, id: string): Promise<SessionInfo> {
  const session = await resumableById(webContentsId, projectRoot, String(id ?? ""));
  // Built BEFORE the session starts, so the notice states what the user was shown rather than
  // re-deriving it afterwards from a transcript that now has a fork in it.
  const disclosure = await describeResume(webContentsId, projectRoot, session.id).catch(() => null);

  endSession(webContentsId);
  const info = await openSession(webContentsId, projectRoot, { resume: session.id, fork: true });
  // No CLI on this machine: `openSession` returned a description rather than a session, and there is
  // nothing to say a conversation was picked up into. The pane renders the reason it already has.
  if (info.id) send(webContentsId, { kind: "notice", seq: --injectedSeq, text: resumedNotice(session, disclosure) });
  return info;
}

/** The offered row for an id, or the refusal that says which of the two things went wrong. */
async function resumableById(webContentsId: number, projectRoot: string, id: string): Promise<ResumableSession> {
  if (!projectRoot) throw new Error("No project is open.");
  if (!offered.get(webContentsId)?.has(id)) {
    throw new Error("That conversation was not one of the ones offered for this project. Open the list again.");
  }
  // Re-read rather than trusting the id's membership alone: the transcript may have been deleted,
  // and the row is what the notice and the disclosure are written from.
  const row = resumableFrom(await listStoredSessions(projectRoot), { projectRoot }).find((r) => r.id === id);
  if (!row) throw new Error("That conversation is no longer in Claude Code's session store for this project.");
  return row;
}

/**
 * Reopen a session whose model refused the pacing budget, without one.
 *
 * NOT A CONTINUE, and the difference matters: no allowance is renewed and nothing was spent — the
 * turns that provoked this did no work at all, they came back as a 400. The conversation is resumed
 * so the user does not lose what they typed, and the notice says plainly what was given up.
 */
async function reopenWithoutPacing(webContentsId: number, entry: LiveSession): Promise<void> {
  if (sessions.get(webContentsId) !== entry || !entry.pacing) return;
  const resume = entry.session.sessionId();
  entry.pacing = false;
  send(webContentsId, { kind: "notice", seq: --injectedSeq, text: PACING_UNSUPPORTED_NOTICE });
  if (!resume) return;
  sessions.delete(webContentsId);
  entry.session.close();
  if (entry.child) terminateChildGroup(entry.child);
  await openSession(webContentsId, entry.projectRoot, {
    resume,
    spend: entry.spend,
    grants: entry.grants,
    writes: entry.writes,
    effort: entry.effort,
    model: entry.model,
    pacing: false,
  });
  const next = sessions.get(webContentsId);
  if (next) await announceScope(webContentsId, next);
}

/**
 * Give an exhausted conversation a fresh allowance and pick it up where it stopped.
 *
 * THE DOOR IN THE CEILING, and the reason the ceiling can be low enough to matter. Everything about
 * it is a deliberate pair:
 *
 *   • **The conversation is resumed, not restarted.** `resume` hands the CLI its own session id and
 *     the transcript comes back with it, so the user loses nothing by having been stopped.
 *   • **The allowance is fresh and the total is not.** `renewAllowance` zeroes what is measured
 *     against the ceiling and keeps the lifetime figure, because the user is agreeing to spend
 *     another ceiling's worth — not being told the conversation has cost nothing so far.
 *   • **The scope carries over.** The grants and the write scope are main's own records, from
 *     prompts a person answered and a preview token that was claimed; making the user re-answer all
 *     of them is exactly the friction that teaches people to raise the ceiling until it never fires.
 */
export async function continueSession(webContentsId: number, id: string): Promise<SessionInfo> {
  const entry = sessions.get(webContentsId);
  if (!entry || entry.id !== id) {
    throw new Error("That session is no longer here, so there is nothing to continue. Start a new one.");
  }
  if (!entry.endReason || !entry.resumeId) {
    throw new Error("That session did not stop at a ceiling, so it has nothing to continue from.");
  }

  sessions.delete(webContentsId);
  const spend = renewAllowance(entry.spend, sessionBudget());
  const info = await openSession(webContentsId, entry.projectRoot, {
    resume: entry.resumeId,
    spend,
    grants: entry.grants,
    writes: entry.writes,
    effort: entry.effort,
    model: entry.model,
    pacing: entry.pacing,
  });
  send(webContentsId, {
    kind: "notice",
    seq: --injectedSeq,
    text:
      // `formatUsd`, not `toFixed(2)` — a two-cent probe ceiling renders as `0.02 USD` one way and
      // `$0.02` the other, and every other figure in the pane comes from the pure module.
      `Continued with a fresh ceiling of ${formatUsd(spend.ceilingUsd)} (allowance ${spend.allowances}). ` +
      `The conversation was resumed rather than restarted, so everything above is still in front of the model` +
      `${entry.grants.length + entry.writes.length > 0 ? ", and what you had opened for it stays open" : ""}.`,
  });
  return info;
}

/**
 * Continue a create-\* form's work in the pane, with the token its confirmation was built from.
 *
 * A TOKEN AND NOTHING ELSE, exactly like `claude:run`, and for the reason the token exists: the
 * invocation names the artifact this process resolved when it built the preview, so a renderer
 * cannot describe a directory for the session to write in any more than it can describe a prompt
 * for the session to run. Claiming consumes it, so a preview is spent either headlessly or here,
 * never both, and never twice.
 *
 * Three things then happen, and they are the same three a grant does — widen the enforcement input,
 * tell the SDK, re-derive the disclosure — plus one that is this slice's own: the conversation is
 * seeded with what was scaffolded, WITHOUT a model turn.
 *
 *   1. `allowWrites` appends the artifact's own directory to the live write scope. Exactly one
 *      entry, whatever the form; a second submit appends a second.
 *   2. `seed` appends the context as a non-querying message. It costs nothing until the user types,
 *      and it is what stops the model re-asking for the name the form captured.
 *   3. The addition is announced inline in the transcript and the header re-reads the scope from
 *      the `scope` event, so what the boundary enforces and what the pane says cannot drift.
 *
 * Telling the SDK is the one step that cannot happen here: `updatedPermissions` rides on a
 * permission answer and there is no answer to ride on, so `startPaneSession` carries it to the
 * first tool call that lands inside the new directory. See `unannounced` there.
 */
export async function handoffToSession(
  webContentsId: number,
  projectRoot: string,
  token: unknown
): Promise<SessionInfo> {
  if (!projectRoot) throw new Error("No project is open.");
  // Throws `TokenRefused` on a forged, replayed, expired or mis-aimed token — the same refusal, with
  // the same reasons, that the run channel gives.
  const invocation = claimInvocation(token, "claude");
  const handoff = invocation.handoff;
  if (!handoff) {
    throw new Error(
      "That preview cannot be continued in the pane: it did not come from a create-* form, so there is no " +
        "artifact whose directory the session could be given."
    );
  }

  // Reuse the conversation the user already has, unless there is none or it belongs to a project
  // this window has moved off. A handoff is an addition to a session, not a new one — that is what
  // makes a second submit grow the scope by one rather than replace it.
  let entry = sessions.get(webContentsId);
  // An exhausted entry counts as no session here: it holds a transcript to continue, not a
  // conversation a form can be handed into, and starting fresh is what the user pressed the button
  // for. Continue is the other door and stays where it is.
  if (!isLive(entry) || entry.projectRoot !== projectRoot) {
    await startSession(webContentsId, projectRoot);
    entry = sessions.get(webContentsId);
  }
  if (!entry) {
    // No CLI on this machine: `startSession` returned a description rather than a session, and there
    // is nothing to hand off into. The artifact is still on disk and the dialog still copies the
    // prompt, which is the documented fallback in exactly this state.
    return describeSession(projectRoot, null);
  }

  const added = entry.session.allowWrites([handoff.writeScope]);

  // ONE STRING, TWO DESTINATIONS. What the model is given and what the transcript shows are the
  // same text, built once — a transcript that paraphrased what was actually seeded would be the
  // one thing worse than not showing it at all.
  const seed = handoffSeed(handoff, invocation.prompt);
  entry.session.seed(seed);
  send(webContentsId, { kind: "context", seq: --injectedSeq, title: handoffTitle(handoff), text: seed });

  if (added.length > 0) {
    entry.writes.push({
      path: handoff.writeScope,
      scope: handoff.scope,
      artifact: handoff.artifact,
      kind: handoff.kind,
      name: handoff.name,
      addedAt: Date.now(),
    });
    send(webContentsId, { kind: "notice", seq: --injectedSeq, text: handoffNotice(handoff) });
  } else {
    // A second submit for the same artifact. Saying so beats a silent no-op: the user pressed a
    // button that describes itself as opening a directory, and it did not open a second one.
    send(webContentsId, {
      kind: "notice",
      seq: --injectedSeq,
      text: `${handoff.writeScope} was already writable in this session, so nothing was added to the write scope.`,
    });
  }

  await announceScope(webContentsId, entry);
  return describeSession(projectRoot, entry);
}

/**
 * Tell the window the read scope moved.
 *
 * THE SECOND HALF OF A GRANT, and the one with nothing to make it happen automatically. `020`
 * resolved the readable set once at session start, so widening the boundary without re-deriving the
 * disclosure leaves the header describing a session that no longer exists — and nothing fails. This
 * is why a grant is an event rather than a return value: the pane's header re-reads what it can see
 * from the same derivation the boundary uses, not from what a button click implied.
 */
async function announceScope(webContentsId: number, entry: LiveSession): Promise<void> {
  const info = await describeSession(entry.projectRoot, entry);
  // The session may have gone away while the settings cascade was being resolved.
  if (sessions.get(webContentsId) !== entry) return;
  send(webContentsId, {
    kind: "scope",
    seq: --injectedSeq,
    read: info.read,
    grants: info.grants,
    writable: info.writable,
    writes: info.writes,
  });
}

/**
 * Add a turn.
 *
 * The text is the user's, verbatim — this function's entire job is to not be a prompt builder.
 * Returns false when the id names no live session, which is what the renderer shows rather than
 * silently dropping a message the user typed.
 */
export function saySession(webContentsId: number, id: string, text: string): boolean {
  const entry = sessions.get(webContentsId);
  // `isLive` rather than an existence check: an entry kept for Continue still answers to its id, and
  // a turn typed into an exhausted session must be refused rather than dropped into a closed pump.
  if (!isLive(entry) || entry.id !== id) return false;
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  return entry.session.say(trimmed);
}

/**
 * Change how hard the model thinks, mid-conversation.
 *
 * A WORD FROM A CLOSED SET, checked here rather than trusted: `isEffortLevel` is the same list the
 * query is configured from, so a renderer cannot put an arbitrary string into the CLI's flag layer.
 * Applied from the next turn, with the transcript untouched — which is the whole reason this is a
 * header control and not a reason to start a new session.
 */
export async function setSessionEffort(webContentsId: number, id: string, effort: unknown): Promise<boolean> {
  const entry = sessions.get(webContentsId);
  if (!isLive(entry) || entry.id !== id || !isEffortLevel(effort)) return false;
  return entry.session.setEffort(effort);
}

/**
 * Change the model, mid-conversation.
 *
 * THE ID IS CHECKED AGAINST THE LIST MAIN PUBLISHED. `entry.models` came from the CLI's own
 * `supportedModels()`, so what crosses the wire is a choice from a list this process produced
 * rather than a model name a renderer invented — the same discipline as a grant's scope word.
 * `null` is the one value that names no model: it resets to the CLI's own default.
 */
export async function setSessionModel(webContentsId: number, id: string, model: unknown): Promise<boolean> {
  const entry = sessions.get(webContentsId);
  if (!isLive(entry) || entry.id !== id) return false;
  if (model === null) return entry.session.setModel(null);
  if (typeof model !== "string" || !entry.models.some((m) => m.id === model)) return false;
  return entry.session.setModel(model);
}

/** Interrupt the turn in flight. The session stays usable — this is not Stop-the-session. */
export async function stopSession(webContentsId: number, id: string): Promise<boolean> {
  const entry = sessions.get(webContentsId);
  if (!isLive(entry) || entry.id !== id) return false;
  const { stillQueued } = await entry.session.stop();
  // A Stop that left messages queued is not the Stop the user pressed the button for: each one runs
  // as its own turn the moment the interrupt lands. Saying so beats a pane that goes quiet and then
  // starts talking again for no visible reason.
  if (stillQueued.length > 0) {
    send(webContentsId, {
      kind: "notice",
      seq: --injectedSeq,
      text: `Stopped the turn in flight. ${stillQueued.length} queued message${
        stillQueued.length === 1 ? "" : "s"
      } survived the interrupt and will still run.`,
    });
  }
  return true;
}

/**
 * The main process authors the answer; the renderer sends a choice.
 *
 * The narrow wire shape (`PermissionChoice`) is what keeps `updatedPermissions` — blanket allow
 * rules, `bypassPermissions`, a permanently widened read scope, written to the user's own settings
 * files — unreachable from the renderer. What crosses is one of three words plus a sentence, and
 * this function is the only place a `PermissionAnswer` is built from it.
 *
 * The reason is never empty. The UI is written not to send one, and this is the second half of that
 * promise rather than a restatement of it: a deny whose message is `""` reaches the model as a bare
 * refusal, and the model reads denial messages to decide what to do instead.
 */
export async function answerPermission(
  webContentsId: number,
  id: string,
  requestId: string,
  choice: PermissionChoice
): Promise<boolean> {
  const entry = sessions.get(webContentsId);
  if (!entry || entry.id !== id) return false;

  if (choice?.choice === "grant") return grantAndAllow(webContentsId, entry, String(requestId ?? ""), choice.scope);

  const answer: PermissionAnswer =
    choice?.choice === "allow"
      ? { behavior: "allow" }
      : {
          behavior: "deny",
          message: permissionReason(
            choice?.reason,
            choice?.choice === "stop"
              ? "The user stopped this turn rather than allowing that call."
              : "The user declined this call. Do not retry it; say what you needed it for instead."
          ),
          // Deny and Stop are two controls: a plain deny lets the model adapt and finish the job,
          // and this one ends the turn. Only a person ever sets it.
          interrupt: choice?.choice === "stop",
        };

  return entry.session.answer(String(requestId ?? ""), answer);
}

/**
 * Forward a selection to the session, which is the only thing that can turn it into an answer.
 *
 * NOTE WHAT THIS FUNCTION DOES NOT DO, because it is the whole design: it does not build the
 * `answers` map, it does not touch `updatedInput`, and it keeps no copy of the question. A grant
 * needs main's own copy of the prompt to resolve a path the renderer never sent; a question needs
 * the opposite — validation against the tool input **as the SDK delivered it**, which only
 * `startPaneSession` is holding. Rebuilding the payload here would mean checking the labels against
 * a copy that had already crossed two process boundaries, so the check lives one layer deeper and
 * this hop stays a forwarder.
 *
 * A REJECTION IS SAID OUT LOUD. `answerQuestions` refuses a selection that names an unoffered label,
 * answers a question twice, or leaves one blank — and the promise stays parked, so without a word in
 * the transcript the card would simply appear not to work. The notice names the reason the pure
 * module wrote, which is written for whoever has to fix the thing that sent it.
 */
export async function answerQuestion(
  webContentsId: number,
  id: string,
  requestId: string,
  choice: QuestionChoice
): Promise<boolean> {
  const entry = sessions.get(webContentsId);
  if (!entry || entry.id !== id) return false;

  const result = entry.session.answerQuestion(String(requestId ?? ""), choice);
  // A null error is the ordinary miss — a late click, or a question the session ended under.
  if (!result.ok && result.error) {
    send(webContentsId, {
      kind: "notice",
      seq: --injectedSeq,
      text: `That answer was not sent: ${result.error}`,
    });
  }
  return result.ok;
}

/**
 * Allow this call, and stop asking about this path for the rest of the session.
 *
 * THREE THINGS HAPPEN HERE, and leaving out any one of them produces a boundary that is wrong in a
 * way nothing reports:
 *
 *   1. **The hook's list is widened.** It runs before the permission flow and would otherwise route
 *      the same path into a prompt on the very next call — the grant would appear to have done
 *      nothing.
 *   2. **The answer carries `updatedPermissions`.** `destination: "session"` and nothing else: the
 *      CLI stops prompting for the tree, and NO FILE IS WRITTEN. `localSettings` would land a rule
 *      in the user's repository, `userSettings` on their whole machine, and both would outlive the
 *      conversation the user was actually asked about. `SessionPermissionUpdate` cannot express
 *      either, which is where that guarantee lives.
 *   3. **The disclosure is re-derived.** The header and the boundary have to agree, and the header
 *      has no other way to learn that they stopped agreeing.
 *
 * The PATH comes from the prompt this answers, never from the renderer. A `scope` naming no option
 * on that prompt grants nothing and falls back to letting the one call through, which is the safe
 * direction to be wrong in: the user pressed a button meaning "yes".
 */
async function grantAndAllow(
  webContentsId: number,
  entry: LiveSession,
  requestId: string,
  scope: string
): Promise<boolean> {
  const prompt = entry.prompts.get(requestId);
  const option = grantOptionFor(prompt?.grants ?? [], scope);
  if (!option) return entry.session.answer(requestId, { behavior: "allow" });

  const added = entry.session.grant([option.path]);
  const answered = entry.session.answer(requestId, {
    behavior: "allow",
    updatedPermissions: [{ type: "addDirectories", directories: [option.path], destination: "session" }],
  });

  if (!answered) {
    // The request was already resolved — a double click, or the session going away underneath it.
    // The boundary must not stay widened for a question nobody answered.
    for (const path of added) entry.session.revoke(path);
    return false;
  }

  entry.grants.push({
    path: option.path,
    scope: option.scope,
    target: prompt?.target ?? option.path,
    tool: prompt?.tool ?? "a tool",
    grantedAt: Date.now(),
  });
  send(webContentsId, {
    kind: "notice",
    seq: --injectedSeq,
    text: `${option.path} is readable for the rest of this session. Nothing was written to disk; revoke it from the scope panel (the eye icon) at any time.`,
  });
  await announceScope(webContentsId, entry);
  return true;
}

/**
 * Take a grant back.
 *
 * The renderer sends a PATH here and that is not a hole: this call can only ever REMOVE an entry
 * that is already in `entry.grants`, so a path it does not recognise does nothing at all. There is
 * no shape of argument by which it could widen anything.
 *
 * What it can actually undo is this app's own boundary — the SDK has no API for withdrawing a
 * `PermissionUpdate` — and that is enough, because the hook runs first: a path the hook stops
 * recognising is routed back into a prompt before the CLI's permission system is ever consulted.
 */
export async function revokeGrant(webContentsId: number, id: string, target: string): Promise<boolean> {
  const entry = sessions.get(webContentsId);
  if (!entry || entry.id !== id) return false;

  const at = entry.grants.findIndex((g) => g.path === target);
  if (at < 0) return false;

  entry.grants.splice(at, 1);
  entry.session.revoke(target);
  send(webContentsId, {
    kind: "notice",
    seq: --injectedSeq,
    text: `${target} is out of scope again. The session can no longer read it without asking.`,
  });
  await announceScope(webContentsId, entry);
  return true;
}

/**
 * End a window's session and reap its child.
 *
 * Three steps, exactly as `cancelClaudeRun` documents and for the same reason: closing the query
 * ends the conversation and releases the child the SDK is holding, signalling the process GROUP is
 * what reaches the CLI's own children, and SIGKILL follows if anything is still there.
 */
export function endSession(webContentsId: number): void {
  const entry = sessions.get(webContentsId);
  if (!entry) return;
  sessions.delete(webContentsId);
  entry.session.close();
  if (entry.child) terminateChildGroup(entry.child);
}

/**
 * A project switch ends every session and starts nothing.
 *
 * NOT a retarget, unlike the log tail beside it. A tail has no state to lose and a conversation
 * does: silently re-pointing a transcript about repository A at repository B would be worse than
 * losing it, and starting a session implicitly would spend the user's subscription on a project
 * they have only just opened.
 *
 * IT IS ALSO WHAT CLEARS THE WRITE SCOPE. The accumulated directories live on the entry and in the
 * session's own closure, so ending the session is the only way they go — there is no revoke, and
 * none is owed: each entry answers a form the user submitted, and the way to withdraw that consent
 * is to end the conversation it was given to. A switch does both at once.
 */
export function endAllSessions(): void {
  for (const id of [...sessions.keys()]) endSession(id);
  // AND THE OFFERS GO WITH THEM (`025`). Every id on that map names a conversation recorded for the
  // project the window has just moved off. `resumableById` would refuse one anyway — it re-reads the
  // store for the CURRENT project and the row would not be there — but a list of ids belonging to a
  // repository this app is no longer showing is exactly what `clearInvocations()` drops preview
  // tokens for, and keeping it would leave that refusal as the only thing standing between the two.
  offered.clear();
}

/** Called when the app quits. A detached process group outlives its parent unless it is killed. */
export function disposeSessions(): void {
  endAllSessions();
}
