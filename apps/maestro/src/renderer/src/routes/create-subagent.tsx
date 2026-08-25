import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Field, Input, Textarea } from "@repo/ui/field";
import ChipInput from "@repo/ui/chip-input";
import Select from "@repo/ui/select";
import ModePill from "@repo/ui/mode-pill";
import { Sparkles, Pencil, Store, Folder } from "lucide-react";
import CreateShell, { jumpToField, type ShortcutSection } from "../components/create-shell";
import CreateResult from "../components/create-result";
import SubagentTemplatePreview from "../components/subagent-template-preview";
import { getCreateOptions, useCreateFlow } from "../utils/create-flow";

const subagentSchema = z
  .object({
    mode: z.enum(["auto", "manual"]),
    target: z.enum(["marketplace", "project"]),
    name: z.string().refine((v) => v === "" || /^[a-z][a-z0-9-]*$/.test(v), {
      message: "Use kebab-case: lowercase letters, numbers, and dashes.",
    }),
    idea: z.string(),
    description: z.string(),
    triggers: z.array(z.string()),
    tools: z.array(z.string()),
    marketplace: z.string(),
    plugin: z.string(),
  })
  .refine((v) => (v.mode === "auto" ? v.idea.trim().length > 0 : v.description.trim().length > 0), {
    message: "Tell Claude what this subagent should do.",
    path: ["idea"],
  })
  .refine((v) => v.mode === "auto" || v.name.trim().length > 0, {
    message: "Manual mode requires a name.",
    path: ["name"],
  })
  .refine((v) => v.target === "project" || (v.marketplace.length > 0 && v.plugin.length > 0), {
    message: "Pick a marketplace and plugin, or switch to Project.",
    path: ["marketplace"],
  });

type SubagentForm = z.infer<typeof subagentSchema>;

export const Route = createFileRoute("/create-subagent")({
  loader: () => getCreateOptions(),
  component: CreateSubagent,
});

const SHORTCUTS: ShortcutSection[] = [
  {
    title: "Navigation",
    items: [
      ["Jump to field 1–6", "⌘1–6"],
      ["Next / previous field", "Tab / ⇧Tab"],
    ],
  },
  {
    title: "Actions",
    items: [
      ["Toggle Auto / Manual", "⌘M"],
      ["Create subagent", "⌘↵"],
      ["Show this help", "?"],
      ["Close overlay", "Esc"],
    ],
  },
];

const FIELD_IDS = ["ca-name", "ca-idea", "ca-triggers", "ca-tools", "ca-marketplace", "ca-plugin"];
const ROW_IDS = ["ca-row-1", "ca-row-2", "ca-row-3", "ca-row-4", "ca-row-5", "ca-row-6"];

function CreateSubagent() {
  const { marketplaces, projectRoot } = Route.useLoaderData();
  const [helpOpen, setHelpOpen] = useState(false);
  const flow = useCreateFlow("Subagent");

  const first = marketplaces[0];
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<SubagentForm>({
    resolver: zodResolver(subagentSchema),
    defaultValues: {
      mode: "auto",
      target: first ? "marketplace" : "project",
      name: "",
      idea: "",
      description: "",
      triggers: [],
      tools: [],
      marketplace: first?.name ?? "",
      plugin: first?.plugins[0] ?? "",
    },
  });

  const [mode, target, name, idea, description, triggers, tools, marketplace, plugin] = watch([
    "mode",
    "target",
    "name",
    "idea",
    "description",
    "triggers",
    "tools",
    "marketplace",
    "plugin",
  ]);

  const selected = marketplaces.find((m) => m.name === marketplace);

  const submit = () =>
    void handleSubmit(
      (values) =>
        flow.create({ kind: "create-subagent", ...values }, () =>
          reset({ ...values, name: "", idea: "", description: "", triggers: [], tools: [] })
        ),
      (errs) => {
        if (errs.idea) jumpToField(FIELD_IDS, ROW_IDS, 2);
        else if (errs.name) jumpToField(FIELD_IDS, ROW_IDS, 1);
        else if (errs.marketplace) jumpToField(FIELD_IDS, ROW_IDS, 5);
      }
    )();

  return (
    <>
      <CreateShell
        title="New subagent"
        subtitle={
          mode === "auto"
            ? "Describe your idea — the agent file is scaffolded now, and Claude writes the body when you confirm."
            : "Provide name, description, triggers and tools — the complete skeleton is written immediately."
        }
        pills={
          <>
            <Controller
              name="mode"
              control={control}
              render={({ field }) => (
                <ModePill
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: "auto", label: "Auto", icon: <Sparkles size={12} /> },
                    { value: "manual", label: "Manual", icon: <Pencil size={12} /> },
                  ]}
                />
              )}
            />
            <Controller
              name="target"
              control={control}
              render={({ field }) => (
                <ModePill
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: "marketplace", label: "Marketplace", icon: <Store size={12} /> },
                    { value: "project", label: "Project", icon: <Folder size={12} /> },
                  ]}
                />
              )}
            />
          </>
        }
        fieldIds={FIELD_IDS}
        rowIds={ROW_IDS}
        shortcuts={SHORTCUTS}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        onSubmit={submit}
        onToggleMode={() => setValue("mode", getValues("mode") === "auto" ? "manual" : "auto")}
        submitLabel="Create subagent"
        busy={flow.busy}
        banner={
          flow.outcome && (
            <CreateResult
              outcome={flow.outcome}
              busy={flow.previewing || flow.dialogOpen}
              onFinish={() => void flow.finish(flow.outcome!.request, flow.outcome!.result.name)}
            />
          )
        }
        preview={
          <SubagentTemplatePreview
            mode={mode}
            target={target}
            name={name}
            idea={idea}
            description={description}
            triggers={triggers}
            tools={tools}
            marketplace={marketplace}
            marketplacePath={selected?.path ?? ""}
            plugin={plugin}
            projectRoot={projectRoot}
          />
        }
      >
        <div className="flex items-center gap-3 px-3.5 py-3 mb-1 bg-(--bg-elev) border border-(--line) rounded-lg text-[13px] text-(--ink-2)">
          <div className="w-7 h-7 rounded-[7px] bg-(--primary-dim) text-primary flex items-center justify-center">
            {mode === "auto" ? <Sparkles size={15} /> : <Pencil size={15} />}
          </div>
          <div className="flex-1 leading-normal">
            {mode === "auto" ? (
              <>
                <strong className="text-(--ink)">Auto.</strong> The frontmatter is written now; Claude fills in the
                role, workflow and output from your idea.
              </>
            ) : (
              <>
                <strong className="text-(--ink)">Manual.</strong> You provide every field — the file is complete as
                written, with no model involved.
              </>
            )}
          </div>
        </div>

        <Field
          id="ca-row-1"
          label="Subagent name"
          hint={
            mode === "auto"
              ? "kebab-case. Leave blank and one is derived from your idea."
              : "kebab-case, e.g. security-reviewer."
          }
          error={errors.name?.message ?? null}
        >
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <Input id="ca-name" {...field} mono placeholder="my-agent" error={errors.name?.message ?? null} />
            )}
          />
        </Field>

        <Field
          id="ca-row-2"
          label={mode === "auto" ? "Subagent idea" : "Role description"}
          hint={
            mode === "auto"
              ? 'Describe what the subagent does. Best descriptions start with a verb ("Reviews…", "Audits…", "Drafts…").'
              : "Used as the docstring. First sentence: what it does."
          }
          error={errors.idea?.message ?? null}
        >
          {/*
            One textarea bound to whichever field the mode is about. Two would mean the sentence
            the user typed disappearing the moment they flipped the toggle to see the other layout.
          */}
          <Controller
            name={mode === "auto" ? "idea" : "description"}
            control={control}
            render={({ field }) => (
              <Textarea
                id="ca-idea"
                {...field}
                rows={4}
                placeholder={
                  mode === "auto"
                    ? "Audits pull requests for security issues. Checks for hardcoded secrets, missing input validation, and unsafe dependencies."
                    : "A short, focused description of what this subagent does and when it applies."
                }
                error={errors.idea?.message ?? null}
              />
            )}
          />
        </Field>

        <Field
          id="ca-row-3"
          label="When to apply"
          hint="Specific triggers that tell Claude when to hand off to this subagent. Press Enter to add each."
        >
          <Controller
            name="triggers"
            control={control}
            render={({ field }) => (
              <ChipInput
                id="ca-triggers"
                values={field.value}
                onChange={field.onChange}
                placeholder="e.g. user asks to review a PR for security"
              />
            )}
          />
        </Field>

        <Field id="ca-row-4" label="Tools" hint="Tools this subagent is allowed to use. Press Enter to add each.">
          <Controller
            name="tools"
            control={control}
            render={({ field }) => (
              <ChipInput
                id="ca-tools"
                values={field.value}
                onChange={field.onChange}
                placeholder="e.g. Bash, Read, WebSearch"
              />
            )}
          />
        </Field>

        {target === "marketplace" ? (
          <>
            <Field
              id="ca-row-5"
              label="Marketplace"
              hint={
                marketplaces.length === 0
                  ? "No local marketplaces are registered with Claude Code — create one, or switch to Project."
                  : "The workspace this subagent belongs to."
              }
              error={errors.marketplace?.message ?? null}
            >
              <Controller
                name="marketplace"
                control={control}
                render={({ field }) => (
                  <Select
                    id="ca-marketplace"
                    value={field.value}
                    options={marketplaces.map((m) => ({ id: m.name, name: m.name }))}
                    onChange={(v) => {
                      field.onChange(v);
                      setValue("plugin", marketplaces.find((m) => m.name === v)?.plugins[0] ?? "");
                    }}
                  />
                )}
              />
            </Field>

            <Field id="ca-row-6" label="Plugin" hint="Which plugin group to file the subagent under.">
              <Controller
                name="plugin"
                control={control}
                render={({ field }) => (
                  <Select
                    id="ca-plugin"
                    value={field.value}
                    options={(selected?.plugins ?? []).map((p) => ({ id: p, name: p }))}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>
          </>
        ) : (
          <Field
            id="ca-row-5"
            label="Project location"
            hint="The subagent will be created at <project>/.claude/agents/<name>.md."
          >
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--bg-2) border border-(--line) font-mono text-[12px] text-(--ink-2)">
              <Folder size={13} className="text-(--ink-3)" />
              {projectRoot || "No project is open — choose one from the top bar."}
            </div>
          </Field>
        )}
      </CreateShell>
      {flow.dialog}
    </>
  );
}
