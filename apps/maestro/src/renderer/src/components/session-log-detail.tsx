import { humanizeLog, unaccountedSkills } from "../utils/session-log";
import { stripNamespace } from "../utils/text";
import type { Instance } from "../utils/session-log";

interface SessionLogDetailProps {
  instance: Instance | null;
  cwd: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[12px] font-semibold text-(--ink) mb-2">{title}</div>
      <div className="text-[12px] text-(--ink-2) leading-[1.7]">{children}</div>
    </div>
  );
}

export default function SessionLogDetail({ instance, cwd }: SessionLogDetailProps) {
  if (!instance) {
    return (
      <div className="border-l border-(--line) flex items-center justify-center h-full">
        <p className="text-[12px] text-(--ink-3)">Select a step to view details</p>
      </div>
    );
  }

  const processLines = instance.entries.map((e) => humanizeLog(e, cwd)).filter((line): line is string => line !== null);

  const unaccounted = unaccountedSkills(instance);

  return (
    <div className="border-l border-(--line) flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-(--line) shrink-0">
        <span className="text-[13px] font-medium text-(--ink)">Logs: {instance.displayName}</span>
      </div>

      {/* Scrollable detail body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <Section title="Input">
          {instance.input ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] m-0">{instance.input}</pre>
          ) : (
            <span className="text-(--ink-3) italic">No input captured</span>
          )}
        </Section>

        <Section title="Process">
          {processLines.length > 0 ? (
            processLines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-words font-mono text-[11px]">
                -{" "}
                {instance.origin === "main_session" || instance.origin === "transition"
                  ? line
                  : `[${instance.displayName}]: ${line}`}
              </div>
            ))
          ) : (
            <span className="text-(--ink-3) italic">No tool calls recorded</span>
          )}
        </Section>

        {instance.skillsTriage && (
          <Section title="Skills Triage">
            {instance.skillsTriage.loaded.length > 0 && (
              <div className="mb-2">
                <div className="text-[11px] text-(--ink-3) mb-1">Loaded</div>
                <div className="flex flex-wrap gap-1">
                  {instance.skillsTriage.loaded.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center rounded-full border border-[var(--green)] text-(--green) px-2 py-0.5 text-[11px] font-mono"
                    >
                      {stripNamespace(id)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {unaccounted.length > 0 && (
              <div className="mb-2">
                <div className="text-[11px] text-(--red) mb-1">Unaccounted — offered but not reported</div>
                <div className="flex flex-wrap gap-1">
                  {unaccounted.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center rounded-full border border-[var(--red)] text-(--red) px-2 py-0.5 text-[11px] font-mono"
                    >
                      {stripNamespace(id)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {instance.skillsTriage.skipped.length > 0 && (
              <div>
                <div className="text-[11px] text-(--ink-3) mb-1">Skipped</div>
                <ul className="m-0 list-none p-0 flex flex-col gap-1">
                  {instance.skillsTriage.skipped.map((s) => {
                    // A hollow reason (empty or barely there) reads as a lazy skip —
                    // flag it yellow so it stands out from a justified skip.
                    const hollow = s.reason.trim().length < 8;
                    return (
                      <li key={s.id} className="font-mono text-[11px]">
                        <span className={hollow ? "text-(--yellow)" : "text-(--ink-2)"}>{stripNamespace(s.id)}</span>
                        <span className="text-(--ink-3)"> — {s.reason.trim() || "no reason given"}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Section>
        )}

        <Section title="Output">
          {instance.output ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] m-0">{instance.output}</pre>
          ) : (
            <span className="text-(--ink-3) italic">No output captured</span>
          )}
        </Section>
      </div>
    </div>
  );
}
