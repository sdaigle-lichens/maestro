// The session pane's state — the transcript, the pane's geometry, and the one path to `session:*`.
//
// WHY THIS IS A PROVIDER AND NOT COMPONENT STATE. `TopNav` renders per route, and the pane's toggle
// lives on it. A transcript held in the panel would be discarded the moment the user opened another
// route to look something up — and worse, the session id is the only handle on a turn in flight, so
// losing it leaves Claude running with no Stop to press. This is the same lesson the help chat's
// `ChatProvider` recorded before this replaced it (`CLAUDE.md:407`), applied to a surface where the
// state is now a live session in another process rather than a list of strings.
//
// WHAT IT IS ALLOWED TO SEND. `session:say` with the user's text, and nothing else. This module
// composes no prompt, prepends no instructions and appends no history — main stamps each turn as
// human-authored at the SDK boundary, which is only meaningful if what arrives there is what the
// user typed. That is the pane's version of the bridge's invariant, and `test/isolation.test.ts`
// pins the call site here and the absence of any other one.
//
// SINGLE-OWNER SUBSCRIBER, like `SessionLogProvider`. Main keys one session per `webContents.id`,
// so a second subscriber would be reading another owner's transcript.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { callMain } from "./call-main";
import { useProject } from "./project-context";
import type {
  PermissionChoice,
  SessionEffort,
  PermissionOutcome,
  PermissionPrompt,
  QuestionChoice,
  QuestionPrompt,
  ResumableSession,
  ResumeDisclosure,
  SessionEvent,
  SessionInfo,
} from "../../../shared/ipc";

/** One entry in the transcript. User turns are local; everything else arrives as a `SessionEvent`. */
export type TranscriptEntry =
  | { seq: number; kind: "user"; text: string }
  | Extract<SessionEvent, { kind: "assistant" }>
  | Extract<SessionEvent, { kind: "tool" }>
  | Extract<SessionEvent, { kind: "refusal" }>
  | Extract<SessionEvent, { kind: "permission" }>
  | Extract<SessionEvent, { kind: "question" }>
  | Extract<SessionEvent, { kind: "context" }>
  | Extract<SessionEvent, { kind: "notice" }>
  | Extract<SessionEvent, { kind: "turn" }>
  | Extract<SessionEvent, { kind: "ended" }>;

interface SessionContextValue {
  open: boolean;
  setOpen(open: boolean): void;
  /** Pane width in px. The pane SHIFTS the layout, so this is a real column, not an overlay. */
  width: number;
  setWidth(width: number): void;
  /** What the session can see and do — null until main has been asked. */
  info: SessionInfo | null;
  entries: TranscriptEntry[];
  /** A session is live and can take a turn. */
  live: boolean;
  /** A turn is in flight: Stop is available, Send is not. */
  busy: boolean;
  /**
   * Tool calls waiting on an answer, oldest first.
   *
   * Held here rather than in the pane for the reason the transcript is: this provider is mounted in
   * `__root.tsx`, so a prompt survives navigation and is answerable from whatever route the user
   * happens to be on. A prompt held in a route would be a wedged session the moment they moved.
   */
  pending: PermissionPrompt[];
  /**
   * Questions waiting on a person, oldest first — the OTHER kind of ask, kept in its own list.
   *
   * Not folded into `pending`: the two render as different things (a choice with options, versus
   * allow/deny/stop) and answer down different channels, so one array holding both would be a list
   * every consumer has to re-discriminate. What they share is `outcomes` below and `waiting`, which
   * is what the badge and the header actually ask about.
   */
  questions: QuestionPrompt[];
  /** Asks of either kind still on screen. What "the user has something to answer" means. */
  waiting: number;
  /** How each answered request ended, so the transcript entry can say which way it went. */
  outcomes: Record<string, PermissionOutcome>;
  starting: boolean;
  error: string | null;
  /** Start a session against the open project. Nothing starts implicitly — the user asks. */
  start(): Promise<void>;
  /**
   * Continue a create-\* form's work in the pane, with the token its confirmation was built from.
   *
   * The only call in this module that widens anything, and it names nothing: a token crosses, and
   * main resolves the artifact, the directory and the seeded context from the preview it recorded.
   * Starts a session if there is none, and opens the pane, because a handoff whose result is
   * invisible is a scope that grew where the user was not looking.
   */
  handoff(token: string): Promise<boolean>;
  /** Send one turn, exactly as typed. Starts a session first if there is none. */
  say(text: string): Promise<void>;
  /** Answer one parked request. A choice crosses the wire; main builds the permission result. */
  answer(requestId: string, choice: PermissionChoice): Promise<void>;
  /**
   * Answer one parked question with a SELECTION — which question, which labels — or a typed reply.
   *
   * Never the payload the tool reads. This module cannot express one: `QuestionChoice` has no arm
   * carrying an answers map, and the labels it does carry are checked against the options the model
   * offered before anything is written into the call.
   */
  answerQuestion(requestId: string, choice: QuestionChoice): Promise<void>;
  /**
   * Take back a directory granted earlier in this session.
   *
   * The only call in this module that names a path, and it can only narrow: main matches it against
   * the grants it is holding. A grant goes the other way — `answer` sends a scope word and main
   * resolves the path from the prompt it asked.
   */
  revoke(path: string): Promise<void>;
  /**
   * Carry on a conversation that stopped at its spend or turn ceiling, with a fresh allowance.
   *
   * The transcript is kept: the session on the other side is RESUMED rather than restarted, so
   * clearing it here would throw away the thing the whole ceiling design exists to preserve.
   */
  continueSession(): Promise<void>;
  /** True while that round trip is in flight, so the button cannot be pressed twice. */
  continuing: boolean;
  /**
   * Conversations Claude Code's own store holds for this project — what the picker offers (`025`).
   *
   * Empty until `loadResumable()` is called, and re-read every time it is: a session the user was in
   * a minute ago belongs on the list. Nothing here is a path — main published these rows, and the
   * only thing that goes back is an `id` off one of them.
   */
  resumable: ResumableSession[];
  loadingResumable: boolean;
  loadResumable(): Promise<void>;
  /**
   * What one of them already read, and what replaying it costs. Null when main refused the id.
   *
   * Fetched on selection rather than with the list because it walks a whole transcript — and because
   * the user is entitled to browse the list without the app parsing every conversation they own.
   */
  resumeDetail(id: string): Promise<ResumeDisclosure | null>;
  /**
   * Attach to it, forking. The transcript on screen is CLEARED, unlike a Continue.
   *
   * The opposite decision from `continueSession`, and for the same underlying reason: a Continue is
   * the conversation above the composer carrying on, so wiping it would throw away what the user is
   * reading. This is a DIFFERENT conversation arriving — one whose turns were never in this pane —
   * so leaving the old ones on screen would show two conversations as one.
   */
  resume(id: string): Promise<boolean>;
  resuming: boolean;
  /** Change how hard the model thinks, from the next turn. The conversation is untouched. */
  setEffort(effort: SessionEffort): Promise<void>;
  /** Change the model mid-conversation, choosing from `info.models`. Null is the CLI's default. */
  setModel(model: string | null): Promise<void>;
  /** Interrupt the turn in flight, leaving the session usable. */
  stop(): Promise<void>;
  /** End the session and clear the transcript. */
  end(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Pane width bounds. Narrow enough to keep a route usable, wide enough to read a code block in. */
export const MIN_PANE_WIDTH = 320;
export const MAX_PANE_WIDTH = 900;
const DEFAULT_PANE_WIDTH = 460;

/** User turns get their own descending sequence, so they cannot collide with main's ascending one. */
let userSeq = 0;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_PANE_WIDTH);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [resumable, setResumable] = useState<ResumableSession[]>([]);
  const [loadingResumable, setLoadingResumable] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PermissionPrompt[]>([]);
  const [questions, setQuestions] = useState<QuestionPrompt[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, PermissionOutcome>>({});

  /** The live session id. A ref as well as state because `say` must not close over a stale one. */
  const sessionId = useRef<string | null>(null);
  const [live, setLive] = useState(false);

  const { current } = useProject();
  const projectRoot = current?.root ?? "";

  const append = useCallback((entry: TranscriptEntry) => setEntries((prev) => [...prev, entry]), []);

  // THE SINGLE SUBSCRIPTION. Mounted once, for the life of the window.
  useEffect(() => {
    return window.maestro.session.subscribe((event) => {
      if (event.kind === "permission-resolved") {
        // Not a transcript entry: it is the state of one that is already there. The prompt card
        // renders its outcome from this rather than from what the user clicked, so a request the
        // session resolved on its own — a window closing, a project switch — stops asking too.
        setPending((prev) => prev.filter((p) => p.requestId !== event.requestId));
        // ONE EVENT, BOTH LISTS. There is one registry behind the two kinds of ask, so a question is
        // resolved by exactly the same message — including by the teardown that denies everything
        // outstanding, which is what stops a closed pane leaving a question on screen forever.
        setQuestions((prev) => prev.filter((q) => q.requestId !== event.requestId));
        setOutcomes((prev) => ({ ...prev, [event.requestId]: event.outcome }));
        return;
      }
      if (event.kind === "spend" || event.kind === "settings") {
        // NOT TRANSCRIPT ENTRIES, for the reason `scope` is not one: they are the header's answer
        // changing underneath it. A spend line per turn would be a running total nobody reads
        // pushed between the turns they do; the figure belongs in one place, kept current.
        setInfo((prev) =>
          prev
            ? event.kind === "spend"
              ? { ...prev, spend: event.spend }
              : { ...prev, effort: event.effort, model: event.model, models: event.models }
            : prev
        );
        return;
      }
      if (event.kind === "scope") {
        // NOT A TRANSCRIPT ENTRY: it is the header's answer changing underneath it. The read scope
        // became mutable the moment a grant existed, and the WRITE scope the moment a form could be
        // handed off; both have to follow the boundary or the pane goes on describing a session that
        // no longer exists. Main re-derives all of it from one place; this only records what it sent.
        setInfo((prev) =>
          prev
            ? { ...prev, read: event.read, grants: event.grants, writable: event.writable, writes: event.writes }
            : prev
        );
        return;
      }
      append(event);
      if (event.kind === "permission") {
        // IMPOSSIBLE TO MISS. A prompt can arrive while the user is reading the docs three routes
        // away, and a tool call parked behind a closed pane waits forever — there is no timeout
        // anywhere below this. Opening the pane is the whole of "answerable from wherever they are".
        setPending((prev) =>
          prev.some((p) => p.requestId === event.request.requestId) ? prev : [...prev, event.request]
        );
        setOpen(true);
      }
      if (event.kind === "question") {
        // Same reasoning as a prompt, and one degree stronger: a permission request can at least be
        // guessed at from the transcript, while a question the model is blocked on says nothing at
        // all until it is on screen with its options.
        setQuestions((prev) =>
          prev.some((q) => q.requestId === event.request.requestId) ? prev : [...prev, event.request]
        );
        setOpen(true);
      }
      if (event.kind === "turn") setBusy(false);
      if (event.kind === "ended") {
        sessionId.current = null;
        setLive(false);
        setBusy(false);
        // THE ENDING'S REASON IS WHAT THE PANE BRANCHES ON. A ceiling is not an error — it produces
        // no red banner and it leaves the transcript exactly where it is, because the next thing the
        // user does with it is press Continue. The id is kept in `info` so that button has something
        // to send; `sessionId.current` is cleared because no turn can go down this session.
        setInfo((prev) =>
          prev
            ? {
                ...prev,
                spend: event.spend ?? prev.spend,
                endReason: event.reason,
                canContinue: event.canContinue,
              }
            : prev
        );
        if (event.error) setError(event.error);
      }
    });
  }, [append]);

  /**
   * A project switch ends the session — main does it, and this clears what described it.
   *
   * Nothing is started against the new project. That is a decision, not an omission: a session
   * costs the user's subscription, and opening a repository is not asking a question about it.
   */
  useEffect(() => {
    sessionId.current = null;
    setLive(false);
    setBusy(false);
    setEntries([]);
    setError(null);
    setInfo(null);
    setPending([]);
    setQuestions([]);
    setOutcomes({});
    // The store's rows are per PROJECT. Keeping them across a switch would offer conversations
    // recorded somewhere the window has moved off — the same failure the preview tokens are dropped
    // for, and the pane would happily resume one.
    setResumable([]);
    if (!projectRoot) return;
    // What a session WOULD be able to see, so the header can disclose it before one exists.
    void callMain(() => window.maestro.session.info()).then((res) => {
      if (res.ok) setInfo(res.value);
    });
  }, [projectRoot]);

  const start = useCallback(async () => {
    if (!projectRoot || starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await callMain(() => window.maestro.session.start());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInfo(res.value);
      sessionId.current = res.value.id;
      setLive(res.value.id !== null);
      if (res.value.id === null) setError(res.value.unavailable);
    } finally {
      setStarting(false);
    }
  }, [projectRoot, starting]);

  /**
   * Continue a create-\* form's work here.
   *
   * The pane is opened FIRST and unconditionally: this is the app's one path to a wider write
   * scope, and a widening the user cannot see is not one they agreed to. The rest is main's — the
   * session it starts or reuses, the directory it opens, the context it seeds — and all this
   * records is the `SessionInfo` that came back, which already describes every one of those.
   */
  const handoff = useCallback(async (token: string) => {
    setOpen(true);
    setError(null);
    const res = await callMain(() => window.maestro.session.handoff(token));
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setInfo(res.value);
    sessionId.current = res.value.id;
    setLive(res.value.id !== null);
    if (res.value.id === null) setError(res.value.unavailable);
    return res.value.id !== null;
  }, []);

  const say = useCallback(
    async (text: string) => {
      const turn = text.trim();
      if (!turn || busy) return;

      if (!sessionId.current) {
        await start();
        if (!sessionId.current) return;
      }

      // Echoed locally rather than waiting for main to reflect it: the user has to see their own
      // turn land immediately, and main has no reason to send back a string it was just given.
      append({ seq: --userSeq, kind: "user", text: turn });
      setBusy(true);
      setError(null);

      const id = sessionId.current;
      const res = await callMain(() => window.maestro.session.say(id, turn));
      if (!res.ok || res.value === false) {
        setBusy(false);
        setError(res.ok ? "That session is no longer running — start a new one." : res.error);
      }
    },
    [append, busy, start]
  );

  /**
   * Answer one parked request.
   *
   * The optimistic removal is deliberate and is not the source of truth: main emits
   * `permission-resolved` for every request it settles, including the ones nobody clicked, and the
   * subscriber above is what records the outcome. This just stops the buttons being clickable twice
   * while the round trip is in flight.
   */
  const answer = useCallback(async (requestId: string, choice: PermissionChoice) => {
    const id = sessionId.current;
    if (!id) return;
    setPending((prev) => prev.filter((p) => p.requestId !== requestId));
    const res = await callMain(() => window.maestro.session.answer(id, requestId, choice));
    if (!res.ok) setError(res.error);
  }, []);

  /**
   * Answer one parked question.
   *
   * The card is removed optimistically, like a prompt's buttons — but a question can also be
   * REFUSED at the far end (a label nobody offered, a question answered twice), and a refusal leaves
   * the promise parked with the card gone. That is why the false return is treated as an error here
   * and why main writes a notice into the transcript saying which label it was: the two together are
   * how a rejected answer is visible rather than silent.
   */
  const answerQuestion = useCallback(async (requestId: string, choice: QuestionChoice) => {
    const id = sessionId.current;
    if (!id) return;
    setQuestions((prev) => prev.filter((q) => q.requestId !== requestId));
    const res = await callMain(() => window.maestro.session.answerQuestion(id, requestId, choice));
    if (!res.ok) setError(res.error);
  }, []);

  const revoke = useCallback(async (target: string) => {
    const id = sessionId.current;
    if (!id) return;
    // No optimistic removal. Unlike a pending prompt — where the buttons have to stop being
    // clickable immediately — a grant's whole point is that the header and the boundary agree, so
    // the list is only ever redrawn from the `scope` event main sends after it has actually moved.
    const res = await callMain(() => window.maestro.session.revoke(id, target));
    if (!res.ok) setError(res.error);
  }, []);

  /**
   * Carry on a conversation that stopped at its ceiling.
   *
   * The transcript is deliberately NOT cleared: continuing resumes the same conversation on the
   * other side, and a pane that wiped what the user was reading would make the ceiling feel like
   * the loss it exists to avoid. The id sent is the stopped session's, which is the only thing main
   * needs — everything the continuation inherits is already its own record.
   */
  const continueSession = useCallback(async () => {
    const id = info?.id;
    if (!id || continuing) return;
    setContinuing(true);
    setError(null);
    try {
      const res = await callMain(() => window.maestro.session.continue(id));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInfo(res.value);
      sessionId.current = res.value.id;
      setLive(res.value.id !== null);
    } finally {
      setContinuing(false);
    }
  }, [continuing, info?.id]);

  /**
   * Re-read what the store holds for this project.
   *
   * Reads only, and costs nothing — no session is started and no transcript is parsed. The list is
   * short-lived state rather than something kept in step: it is fetched when the picker opens, so a
   * conversation the user just left in their terminal is on it.
   */
  const loadResumable = useCallback(async () => {
    if (!projectRoot) return;
    setLoadingResumable(true);
    try {
      const res = await callMain(() => window.maestro.session.resumable());
      if (!res.ok) {
        setError(res.error);
        setResumable([]);
        return;
      }
      setResumable(res.value);
    } finally {
      setLoadingResumable(false);
    }
  }, [projectRoot]);

  /** The disclosure for one row. The id came off the list main published; nothing else is sent. */
  const resumeDetail = useCallback(async (id: string) => {
    const res = await callMain(() => window.maestro.session.resumeDetail(id));
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    return res.value;
  }, []);

  /**
   * Attach to a conversation this app did not start.
   *
   * The transcript is cleared FIRST: what is on screen belongs to whatever the pane was doing
   * before, and the arriving conversation's own turns are in the model's context rather than in this
   * scrollback — main writes one notice saying what was picked up and what it cost. Leaving the old
   * entries above that notice would render two conversations as one continuous one.
   */
  const resume = useCallback(
    async (id: string) => {
      if (resuming) return false;
      setResuming(true);
      setError(null);
      // CLEARED BEFORE THE CALL, NOT AFTER, and that ordering is the whole of a bug this cost a
      // window run to find: main resumes, then pushes the notice saying what was picked up and what
      // it cost — and that event arrives on the subscription BEFORE this promise resolves. Clearing
      // afterwards deletes it, leaving a session that looks like it started silently. Clearing first
      // is also honest about what has happened on the other side regardless: `resumeSession` ends
      // whatever session this window had before it opens the new one.
      setEntries([]);
      setPending([]);
      setQuestions([]);
      setOutcomes({});
      try {
        const res = await callMain(() => window.maestro.session.resume(id));
        if (!res.ok) {
          setError(res.error);
          return false;
        }
        setInfo(res.value);
        sessionId.current = res.value.id;
        setLive(res.value.id !== null);
        if (res.value.id === null) setError(res.value.unavailable);
        return res.value.id !== null;
      } finally {
        setResuming(false);
      }
    },
    [resuming]
  );

  /** Effort, from the next turn. Nothing is sent that is not one of the levels main published. */
  const setEffort = useCallback(async (effort: SessionEffort) => {
    const id = sessionId.current;
    if (!id) return;
    const res = await callMain(() => window.maestro.session.setEffort(id, effort));
    if (!res.ok) setError(res.error);
  }, []);

  /** Model, mid-conversation. The id comes from `info.models`, which main resolved from the CLI. */
  const setModel = useCallback(async (model: string | null) => {
    const id = sessionId.current;
    if (!id) return;
    const res = await callMain(() => window.maestro.session.setModel(id, model));
    if (!res.ok) setError(res.error);
  }, []);

  const stop = useCallback(async () => {
    const id = sessionId.current;
    if (!id) return;
    await callMain(() => window.maestro.session.stop(id));
    setBusy(false);
  }, []);

  const end = useCallback(async () => {
    await callMain(() => window.maestro.session.end());
    sessionId.current = null;
    setLive(false);
    setBusy(false);
    setEntries([]);
    setPending([]);
    setQuestions([]);
    setOutcomes({});
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      open,
      setOpen,
      width,
      setWidth,
      info,
      entries,
      live,
      busy,
      pending,
      questions,
      waiting: pending.length + questions.length,
      outcomes,
      starting,
      continuing,
      error,
      start,
      continueSession,
      resumable,
      loadingResumable,
      loadResumable,
      resumeDetail,
      resume,
      resuming,
      setEffort,
      setModel,
      handoff,
      say,
      answer,
      answerQuestion,
      revoke,
      stop,
      end,
    }),
    [
      answer,
      answerQuestion,
      busy,
      continuing,
      continueSession,
      end,
      entries,
      error,
      handoff,
      info,
      live,
      open,
      outcomes,
      pending,
      loadResumable,
      loadingResumable,
      questions,
      resumable,
      resume,
      resumeDetail,
      resuming,
      revoke,
      say,
      setEffort,
      setModel,
      start,
      starting,
      stop,
      width,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider> — it is mounted in __root.tsx.");
  return ctx;
}

export type {
  PermissionChoice,
  PermissionPrompt,
  QuestionChoice,
  QuestionPrompt,
  SessionEffort,
  SessionEvent,
  SessionInfo,
};
