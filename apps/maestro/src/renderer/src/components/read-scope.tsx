import { AlertTriangle, Eye } from "lucide-react";
import type { ClaudeReadScope, SettingsTier } from "../../../shared/ipc";

/**
 * What a previewed run can SEE, next to what it may change.
 *
 * The section every confirmation in this app was missing. Writes announce themselves — a create-\*
 * prompt names its file, the writable paths are listed beside it, and the session refuses every
 * other one — while reads announce nothing at all: file reads and searches are auto-approved by the
 * permission system and never raise a prompt. The directory list a session starts with is therefore
 * the entire bound on
 * what the model can look at, and it is fully known before anything spawns, so saying nothing about
 * it was the app silently granting whatever it happened to pass.
 *
 * ONE component, two confirmations. `ClaudeRunDialog` (a form submit) and the chat's inline
 * `ConfirmCard` are different shapes for different moments, but the thing being consented to is the
 * same thing, and a second implementation is how one of them quietly stops matching the other.
 * `compact` changes the type scale, never the content.
 *
 * It renders and computes nothing else. Every path, every attribution and the summary sentence come
 * from `ClaudeReadScope`, built in the main process — the renderer nominating a directory here
 * would be the same defect as the renderer supplying a prompt.
 */
export default function ReadScope({ read, compact = false }: { read: ClaudeReadScope; compact?: boolean }) {
  const text = compact ? "text-[10px]" : "text-[11px]";
  const fromSettings = read.directories.filter((d) => d.origin === "settings").length;

  return (
    <div className="flex flex-col gap-1">
      <div
        className={`flex items-center gap-1.5 ${compact ? "text-[10px]" : "text-[11px]"} font-semibold text-subtle uppercase tracking-wide`}
      >
        <Eye size={compact ? 11 : 12} /> What it can read
      </div>

      <p data-testid="claude-read-summary" className={`m-0 ${text} text-(--ink-2)`}>
        {read.summary}
      </p>

      <ul data-testid="claude-read-dirs" className="list-none p-0 m-0 flex flex-col gap-0.5">
        {read.directories.map((d) => (
          <li key={d.path} data-origin={d.origin} className={`${text} text-(--ink-3)`}>
            {/* The one origin a PERSON authored, marked as such. A grant that reads like the app's
                own choice has lost the distinction it exists to make. */}
            {d.origin === "session" && <span className="mr-1 text-amber-500">●</span>}
            <span className="font-mono text-(--ink-2) break-all">{d.path}</span>
            <span> — {d.note}</span>
            {d.file && <span className="font-mono break-all"> ({d.file})</span>}
          </li>
        ))}
      </ul>

      {/* "The settings could not be read" and "the settings add nothing" are different answers, and
          only one of them is a guarantee. Never collapse them into an empty list. */}
      {read.unresolved && (
        <div
          data-testid="claude-read-unresolved"
          className={`flex items-start gap-2 px-2.5 py-2 rounded-lg ${text} bg-amber-500/10`}
        >
          <AlertTriangle size={13} className="shrink-0 mt-px text-amber-500" />
          <span className="text-(--ink-2)">{read.unresolved}</span>
        </div>
      )}

      {/* Provenance, collapsed. It is the answer to "says who?" rather than the disclosure itself,
          and an expanded wall of allow-rules would bury the few lines above that people do read. */}
      {!read.unresolved && (
        <details className={text}>
          <summary data-testid="claude-read-provenance" className="cursor-pointer text-(--ink-3)">
            Where this came from — {read.sources.length} settings {read.sources.length === 1 ? "file" : "files"}
            {fromSettings > 0 && `, ${fromSettings} added ${fromSettings === 1 ? "directory" : "directories"}`}
            {read.rules.length > 0 && `, ${read.rules.length + read.rulesOmitted} permission rules`}
          </summary>

          <div className="mt-1 max-h-40 overflow-y-auto flex flex-col gap-1.5">
            {read.sources.length === 0 && <div className="text-(--ink-3)">No settings files applied to this run.</div>}

            {read.sources.map((s) => (
              <div key={`${s.tier}:${s.path ?? ""}`} className="text-(--ink-3)">
                <span className="text-(--ink-2)">{TIER_LABEL[s.tier]}</span>
                {s.path && <span className="font-mono break-all"> — {s.path}</span>}
                <div className="font-mono text-[10px]">
                  {s.permissions.additionalDirectories.length} dir · {s.permissions.allow.length} allow ·{" "}
                  {s.permissions.deny.length} deny · {s.permissions.ask.length} ask
                  {s.permissions.defaultMode && ` · defaultMode ${s.permissions.defaultMode}`}
                </div>
              </div>
            ))}

            {read.defaultMode && (
              <div data-testid="claude-read-default-mode" className="text-(--ink-3)">
                Effective <span className="font-mono">permissions.defaultMode</span>:{" "}
                <span className="font-mono text-(--ink-2)">{read.defaultMode.mode}</span>
                {read.defaultMode.tier && ` (from ${TIER_LABEL[read.defaultMode.tier]})`}. The
                <span className="font-mono"> --permission-mode</span> flag in the command above takes precedence over
                it.
              </div>
            )}

            {read.rules.length > 0 && (
              <ul data-testid="claude-read-rules" className="list-none p-0 m-0 flex flex-col gap-0.5">
                {read.rules.map((r) => (
                  <li key={`${r.list}:${r.rule}:${r.tier ?? ""}`} className="text-(--ink-3)">
                    <span className="font-mono text-(--ink-2)">
                      {r.list}: {r.rule}
                    </span>
                    {r.tier && <span> — {TIER_LABEL[r.tier]}</span>}
                  </li>
                ))}
                {read.rulesOmitted > 0 && <li className="text-(--ink-3)">…and {read.rulesOmitted} more.</li>}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/** How one settings tier reads in a label. The file path is shown beside it, so this stays short. */
const TIER_LABEL: Record<SettingsTier, string> = {
  user: "user settings",
  project: "project settings",
  local: "local settings",
  managed: "managed settings",
  flag: "--settings file",
};
