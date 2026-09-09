// The /templates page's Handoffs tab — the GLOBAL tier for a route's `handoff_details` payload
// protocol, and `global-reports-tab.tsx`'s twin: the same two-pane, disabled-until-dirty Save
// shape, so the two tabs read as the same app. What differs is that a handoff default has a full
// LIFECYCLE where a report default has none.
//
//   - CREATE is two dropdowns over a user-picked project's own agent roster plus the ordinary
//     upsert — writing an id with no row inserts it at version 1, so nothing new was needed in the
//     store. Sender and receiver must differ, and creating a pair that already exists SELECTS it
//     rather than clobbering the body somebody wrote.
//   - DELETE is offered only for a pair the user created.
//   - RESET TO DEFAULT replaces Delete for the 23 pairs Maestro ships, and is a plain save of
//     `SEED_HANDOFFS[id]`. That is not a nicety: `seedIfEmpty` only fires on a store that has never
//     been written to, so a plain delete of a shipped pair would be irreversible. Main refuses one
//     regardless of what this file renders — see `template:handoffs:delete`.
//
// THE PAIR PICKER READS A PROJECT'S OWN `agents_available` (`043`), via the tab's own LOCAL
// "which project am I viewing" state — `ProjectSelect`'s caller-supplied-`onChange` pattern from
// `/tools`, never `useProject().open()`/`pick()` — so picking one here never touches the app's
// globally-open project, ends the live session, or retargets any other route. `/templates` still
// threads no project context anywhere ELSE on the page; this tab is the one exception, because a
// global default's pair roster has to come from somewhere and the bundled 7 agent names Maestro
// ships aren't every agent a project may have. With no project picked (or the picked one has no
// `agents_available`), the roster is empty and Create stays disabled — never a bundled fallback.
//
// Both halves of an id are BARE agent names (`test`, never `maestro:test`): the id is joined
// straight into `.claude/handoffs/<sender>/<receiver>.md` and validated against
// `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$` before any `path.join`, so a qualified name fails every call.

import { useEffect, useState } from "react";
import { ArrowRight, FileText, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import Button from "@repo/ui/button";
import { Textarea } from "@repo/ui/field";
import { toast } from "@repo/ui/toast";
import { callMain } from "../../utils/call-main";
import { type HandoffDefaultsListing } from "../../../../shared/ipc";
import ProjectSelect from "../project-select";
import { useProject } from "../../utils/project-context";
import { resolveAgentPickerState } from "../../utils/handoff-picker";

type Phase = "idle" | "saving" | "deleting";

/**
 * The renderer's own split of a `"<sender>/<receiver>"` id. Deliberately not an import of
 * `splitHandoffId` — `handoff-seeds.ts` is behind the `src/core` boundary that only `contracts.ts`
 * and `text.ts` cross. Every id rendered here came back from main, which validated it.
 */
function endsOf(handoffId: string): [string, string] {
  const [sender, receiver] = handoffId.split("/");
  return [sender ?? handoffId, receiver ?? ""];
}

export default function GlobalHandoffsTab({ initial }: { initial: HandoffDefaultsListing }) {
  const [rows, setRows] = useState(initial.rows);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [dirty, setDirty] = useState(false);
  const [sender, setSender] = useState<string>("");
  const [receiver, setReceiver] = useState<string>("");

  // The Create row's own project — LOCAL to this tab, per the header comment: never the app's
  // globally-open project. `current` seeds it so a project already open shows its agents right
  // away, exactly as `/tools`'s `viewedRoot` does; a fresh window with nothing open leaves it null.
  const { current, recent } = useProject();
  const [viewedRoot, setViewedRoot] = useState<string | null>(current?.root ?? null);
  const [projectAgents, setProjectAgents] = useState<string[]>([]);

  // Adopt `current` whenever the viewed root is missing or no longer known — the same mount-time
  // race and fix as `/tools`' `viewedRoot` (see that route's comment): `ProjectProvider` starts
  // with `current: null` and resolves it asynchronously, so a tab rendered before that resolves
  // would otherwise show "No project" forever even once the real one is known.
  useEffect(() => {
    if (!current) return;
    const known = [current.root, ...recent.map((r) => r.root)];
    if (!viewedRoot || !known.includes(viewedRoot)) setViewedRoot(current.root);
  }, [viewedRoot, current, recent]);

  useEffect(() => {
    if (!viewedRoot) {
      setProjectAgents([]);
      return;
    }
    let cancelled = false;
    void callMain(() => window.maestro.templates.agentsAvailable(viewedRoot)).then((res) => {
      if (!cancelled && res.ok) setProjectAgents(res.value);
    });
    return () => {
      cancelled = true;
    };
  }, [viewedRoot]);

  const { options: agentOptions, createDisabled: noAgentsToPick } = resolveAgentPickerState(viewedRoot, projectAgents);

  // Keep the two dropdowns pointed at real options whenever the roster changes underneath them —
  // a new project's agents, or the same project's list resolving after the tab mounted.
  useEffect(() => {
    setSender((prev) => (agentOptions.includes(prev) ? prev : (agentOptions[0] ?? "")));
    setReceiver((prev) => (agentOptions.includes(prev) ? prev : (agentOptions[1] ?? agentOptions[0] ?? "")));
  }, [agentOptions]);

  // The shipped set never changes while the tab is open — it is a constant compiled into the app,
  // not a store read — so it stays on the loader payload rather than in state.
  const seeded = initial.seeded;
  const ids = Object.keys(rows).sort();
  const shipped = ids.filter((id) => id in seeded);
  const mine = ids.filter((id) => !(id in seeded));
  const isSeeded = selected !== null && selected in seeded;

  // Re-seed the editor whenever the selection changes, or after a save/delete updates `rows`.
  useEffect(() => {
    if (!selected) return;
    setContent(rows[selected]?.content ?? "");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  /**
   * One save path for three buttons — Save, Create and Reset to default — because they are one
   * store call. The upsert decides insert-at-1 vs. bump-the-version from whether a row exists, so
   * "create" is not a separate operation and never needed one.
   */
  async function saveDefault(handoffId: string, body: string, kind: "save" | "create" | "reset") {
    setPhase("saving");
    try {
      const res = await callMain(() => window.maestro.templates.handoffs.save(handoffId, body));
      if (!res.ok) {
        toast(<>Could not save the global default: {res.error}</>, { variant: "error" });
        return;
      }
      setRows((prev) => ({ ...prev, [handoffId]: res.value }));
      setSelected(handoffId);
      setContent(res.value.content);
      setDirty(false);
      toast(
        kind === "create" ? (
          <>
            Created <HandoffName id={handoffId} /> at version 1.
          </>
        ) : kind === "reset" ? (
          <>
            Reset <HandoffName id={handoffId} /> to Maestro&rsquo;s own protocol (version {res.value.version}).
          </>
        ) : (
          <>
            Saved as the global default for <HandoffName id={handoffId} /> (version {res.value.version}).
          </>
        )
      );
    } finally {
      setPhase("idle");
    }
  }

  function handleCreate() {
    if (sender === receiver) {
      toast(<>An agent cannot hand off to itself — pick two different agents.</>, { variant: "error" });
      return;
    }
    const id = `${sender}/${receiver}`;
    // Selecting rather than overwriting: the two dropdowns say nothing about the body already
    // stored, so treating Create as an upsert here would silently discard somebody's protocol.
    if (rows[id]) {
      setSelected(id);
      toast(
        <>
          <HandoffName id={id} /> already has a global default — selected it.
        </>
      );
      return;
    }
    void saveDefault(id, seeded[id] ?? "", "create");
  }

  async function handleDelete() {
    if (!selected || isSeeded) return;
    setPhase("deleting");
    try {
      const res = await callMain(() => window.maestro.templates.handoffs.remove(selected));
      if (!res.ok) {
        toast(<>Could not delete this global default: {res.error}</>, { variant: "error" });
        return;
      }
      setRows((prev) => {
        const next = { ...prev };
        delete next[selected];
        return next;
      });
      setSelected(null);
      toast(
        <>
          Deleted the global default for <HandoffName id={selected} />. Projects that already materialized it keep their
          own copy.
        </>
      );
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";

  return (
    <div
      className="grid overflow-hidden rounded-lg border border-(--line)"
      style={{ gridTemplateColumns: "280px 1fr", minHeight: 520 }}
    >
      <div className="border-r border-(--line) flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">
          {ids.length === 0 ? (
            <p className="text-[13px] text-subtle m-0 p-4">No route has a global default yet.</p>
          ) : (
            <>
              <Section label="Shipped by Maestro" ids={shipped} selected={selected} onSelect={setSelected} />
              <Section label="Yours" ids={mine} selected={selected} onSelect={setSelected} />
            </>
          )}
        </div>

        {/*
          The create row is pinned to the bottom of the LIST, not floated over the editor: it adds
          a row to the thing above it, and the editor pane is about whichever row is selected.
        */}
        <div className="flex-none border-t border-(--line) p-3 flex flex-col gap-2" data-testid="handoff-create">
          <div className="text-[11px] text-(--ink-3) uppercase tracking-wide">New route</div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-(--ink-3)">agents from</span>
            <ProjectSelect value={viewedRoot} onChange={setViewedRoot} />
          </div>
          <AgentPicker id="handoff-from" label="from" value={sender} onChange={setSender} options={agentOptions} />
          <AgentPicker id="handoff-to" label="to" value={receiver} onChange={setReceiver} options={agentOptions} />
          <Button
            icon={<Plus size={13} />}
            disabled={busy || noAgentsToPick || !sender || !receiver || sender === receiver}
            onClick={handleCreate}
          >
            Create
          </Button>
          {noAgentsToPick && (
            <p className="text-[11px] text-(--ink-3) m-0">
              {viewedRoot
                ? "This project has no configured agents to pick from."
                : "Pick a project above to choose which agents can hand off to each other."}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col p-4 gap-3">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center text-(--ink-2)">
            <FileText size={18} className="text-(--ink-3)" />
            <p className="text-[12px] m-0">Select a route on the left to edit its global default.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[13px]">
                  <HandoffName id={selected} />
                </div>
                <div className="text-[11px] text-(--ink-3)">
                  {isSeeded ? "Shipped by Maestro" : "Yours"} · version {rows[selected]?.version}
                </div>
              </div>
              <Button
                variant="primary"
                icon={phase === "saving" ? undefined : <Save size={13} />}
                loading={phase === "saving"}
                disabled={!dirty || busy}
                onClick={() => void saveDefault(selected, content, "save")}
              >
                Save
              </Button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <Textarea
                id="global-handoff-editor"
                value={content}
                onChange={(v) => {
                  setContent(v);
                  setDirty(true);
                }}
                rows={22}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              {/*
                Reset, never Delete, for a pair Maestro ships: `seedIfEmpty` only fires on a store
                that has never been written to, so no shipped route can be destroyed by a misclick.
              */}
              {isSeeded ? (
                <Button
                  icon={<RotateCcw size={13} />}
                  disabled={busy || content === seeded[selected]}
                  onClick={() => void saveDefault(selected, seeded[selected], "reset")}
                >
                  Reset to default
                </Button>
              ) : (
                <Button
                  icon={phase === "deleting" ? undefined : <Trash2 size={13} />}
                  loading={phase === "deleting"}
                  disabled={busy}
                  onClick={() => void handleDelete()}
                >
                  Delete
                </Button>
              )}
              <p className="text-[11px] text-(--ink-3) m-0 text-right max-w-md">
                {isSeeded
                  ? "Saving updates the machine-wide protocol every project without its own override receives for this route, and bumps its version — the next install or update in a project still on the old content refreshes it."
                  : "This route isn't one Maestro ships. Deleting it leaves any project that already materialized it with its own copy on disk; the project tier answers at the hook either way."}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** `sender → receiver`, the one place the arrow rendering lives. */
function HandoffName({ id }: { id: string }) {
  const [sender, receiver] = endsOf(id);
  return (
    <span className="inline-flex items-center gap-1 font-mono text-(--ink)">
      {sender}
      <ArrowRight size={11} className="text-(--ink-3)" />
      {receiver}
    </span>
  );
}

function Section({
  label,
  ids,
  selected,
  onSelect,
}: {
  label: string;
  ids: string[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <>
      <div className="px-4 pt-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-(--ink-3)">{label}</div>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className={`w-full text-left px-4 py-2 border-b border-(--line) last:border-0 text-[13px] cursor-pointer bg-transparent border-x-0 border-t-0 ${
            selected === id ? "bg-(--primary-dim) text-primary" : "text-(--ink) hover:bg-(--bg-elev)"
          }`}
        >
          <HandoffName id={id} />
        </button>
      ))}
    </>
  );
}

/**
 * A bare `<select>` rather than `@repo/ui`'s Select: two of these plus a button have to fit the
 * 280px list column, and that component is a fixed 40px-tall full-width trigger built for a form.
 */
function AgentPicker({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-[11.5px] text-(--ink-3)">
      <span className="w-8 shrink-0">{label}</span>
      <select
        id={id}
        value={value}
        disabled={options.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-[28px] px-2 rounded-md bg-(--bg-2) border border-(--line-2) text-(--ink) font-mono text-[12px] outline-none focus:border-(--primary) cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.length === 0 && <option value="">—</option>}
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
