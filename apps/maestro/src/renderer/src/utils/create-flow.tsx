import { useCallback, useState } from "react";
import { toast } from "@repo/ui/toast";
import ClaudeRunDialog from "../components/claude-run-dialog";
import { callMain } from "./call-main";
import type { ClaudePreview, CreateOptions, CreateRequest, ScaffoldResult } from "../../../shared/ipc";

export type { CreateOptions, CreateRequest, ScaffoldResult };

export function getCreateOptions(): Promise<CreateOptions> {
  return window.maestro.create.options();
}

/** What the last submit wrote, and the request that wrote it — the request is what finishes it. */
export interface CreateOutcome {
  request: CreateRequest;
  result: ScaffoldResult;
}

/**
 * The submit path all four create routes share: scaffold deterministically, then offer the bridge
 * for whatever a model still has to write.
 *
 * The ordering is the design. The artifact is on disk before Claude is mentioned, so a user who
 * cancels the confirmation — or has no CLI installed at all — still got the thing they asked for,
 * with its frontmatter, its manifest and its marketplace registration. What the model adds is
 * prose inside a file that already exists.
 *
 * There is no spawn here and there is no prompt here. `finish` calls `claude.preview`, which builds
 * the prompt in the main process from the same request, and hands the result to `ClaudeRunDialog`.
 * A route that wanted to "just run it" would have to add a channel to do so, which is the friction
 * that keeps the preview → confirm → run path the only one.
 */
export function useCreateFlow(label: string) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CreateOutcome | null>(null);
  const [preview, setPreview] = useState<{ preview: ClaudePreview; title: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  /**
   * Build the invocation and open the confirmation. Spawns nothing — preview cannot.
   *
   * `name` is the one the scaffold RESOLVED, not the one the form holds: a blank name is derived
   * from the idea, and the dialog naming the artifact "Skill" instead of the file it is about to
   * edit is the difference between a confirmation and a formality.
   */
  const finish = useCallback(
    async (request: CreateRequest, name?: string) => {
      setPreviewing(true);
      try {
        const res = await callMain(() => window.maestro.claude.preview(request));
        if (!res.ok) {
          toast(<>Could not prepare the run: {res.error}</>, { variant: "error" });
          return;
        }
        setPreview({ preview: res.value, title: name ? `${label} ${name}` : label });
      } finally {
        setPreviewing(false);
      }
    },
    [label]
  );

  /**
   * Write the deterministic part, then open the confirmation if a model is genuinely needed.
   *
   * `onWritten` is where the route resets its form. It runs only on success: a rejected scaffold
   * has written nothing, and clearing the fields would throw away the input the user now has to
   * retype to fix whatever the reason said.
   */
  const create = useCallback(
    async (request: CreateRequest, onWritten?: () => void) => {
      setBusy(true);
      try {
        // callMain, not a bare await: the handler rejects when the request is invalid or the write
        // failed, and that reason is the whole point — an unhandled rejection would leave the
        // button spinning and the user with no idea why nothing appeared.
        const res = await callMain(() => window.maestro.create.scaffold(request));
        if (!res.ok) {
          toast(
            <>
              {label} not created: {res.error}
            </>,
            { variant: "error" }
          );
          return;
        }
        setOutcome({ request, result: res.value });
        onWritten?.();
        toast(
          <>
            {label} written to <span className="font-mono text-(--ink)">{res.value.path}</span>
          </>
        );
        // Only when something is actually left for a model. A manual skeleton and a plugin manifest
        // are finished as written, so opening a confirmation for them would be asking the user to
        // approve a run with nothing to do.
        if (res.value.needsModel) await finish(request, res.value.name);
      } finally {
        setBusy(false);
      }
    },
    [label, finish]
  );

  const dialog = preview ? (
    <ClaudeRunDialog preview={preview.preview} title={preview.title} onClose={() => setPreview(null)} />
  ) : null;

  return { busy, outcome, previewing, dialogOpen: preview !== null, create, finish, dialog };
}
