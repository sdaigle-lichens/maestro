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
import SkillTemplatePreview from "../components/skill-template-preview";
import { getCreateOptions, useCreateFlow } from "../utils/create-flow";

// ── Schema ─────────────────────────────────────────────────────────
// The renderer's copy of the rules `validateCreateRequest` enforces in the main process. Both
// exist on purpose: this one puts the message under the field as the user types, and that one
// decides, because main does not assume a renderer ran.
const skillSchema = z
  .object({
    mode: z.enum(["auto", "manual"]),
    target: z.enum(["marketplace", "project"]),
    name: z.string().refine((v) => v === "" || /^[a-z][a-z0-9-]*$/.test(v), {
      message: "Use kebab-case: lowercase letters, numbers, and dashes.",
    }),
    idea: z.string().min(1, "Tell Claude what this skill should do."),
    useWhen: z.array(z.string()),
    marketplace: z.string(),
    plugin: z.string(),
  })
  .refine((v) => v.mode === "auto" || v.name.trim().length > 0, {
    message: "Manual mode requires a name.",
    path: ["name"],
  })
  .refine((v) => v.target === "project" || (v.marketplace.length > 0 && v.plugin.length > 0), {
    message: "Pick a marketplace and plugin, or switch to Project.",
    path: ["marketplace"],
  });

type SkillForm = z.infer<typeof skillSchema>;

export const Route = createFileRoute("/create-skill")({
  loader: () => getCreateOptions(),
  component: CreateSkill,
});

const SHORTCUTS: ShortcutSection[] = [
  {
    title: "Navigation",
    items: [
      ["Jump to field 1–5", "⌘1–5"],
      ["Next / previous field", "Tab / ⇧Tab"],
    ],
  },
  {
    title: "Actions",
    items: [
      ["Toggle Auto / Manual", "⌘M"],
      ["Create skill", "⌘↵"],
      ["Show this help", "?"],
      ["Close overlay", "Esc"],
    ],
  },
];

const FIELD_IDS = ["cs-name", "cs-idea", "cs-useWhen", "cs-marketplace", "cs-plugin"];
const ROW_IDS = ["cs-row-1", "cs-row-2", "cs-row-3", "cs-row-4", "cs-row-5"];

function CreateSkill() {
  const { marketplaces, projectRoot } = Route.useLoaderData();
  const [helpOpen, setHelpOpen] = useState(false);
  const flow = useCreateFlow("Skill");

  const first = marketplaces[0];
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<SkillForm>({
    resolver: zodResolver(skillSchema),
    defaultValues: {
      mode: "auto",
      // Marketplace unless there is none registered — offering a target the user cannot fill in
      // would make the first thing they see an error about their own machine.
      target: first ? "marketplace" : "project",
      name: "",
      idea: "",
      useWhen: [],
      marketplace: first?.name ?? "",
      plugin: first?.plugins[0] ?? "",
    },
  });

  const [mode, target, name, idea, useWhen, marketplace, plugin] = watch([
    "mode",
    "target",
    "name",
    "idea",
    "useWhen",
    "marketplace",
    "plugin",
  ]);

  const selected = marketplaces.find((m) => m.name === marketplace);

  const submit = () =>
    void handleSubmit(
      (values) =>
        flow.create({ kind: "create-skill", ...values }, () =>
          // Back to blank for the next artifact, keeping the destination the user chose — the
          // result card above the form still names what was just written.
          reset({ ...values, name: "", idea: "", useWhen: [] })
        ),
      (errs) => {
        if (errs.idea) jumpToField(FIELD_IDS, ROW_IDS, 2);
        else if (errs.name) jumpToField(FIELD_IDS, ROW_IDS, 1);
        else if (errs.marketplace) jumpToField(FIELD_IDS, ROW_IDS, 4);
      }
    )();

  return (
    <>
      <CreateShell
        title="New skill"
        subtitle={
          mode === "auto"
            ? "Describe your idea — the file is scaffolded now, and Claude writes the body when you confirm."
            : "Provide name, description and triggers — the complete skeleton is written immediately."
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
            {/*
              The target toggle survived the migration; only its Docker-specific half did not.
              Writing into a marketplace versus the open project is a real choice about where a
              skill lives, and the path ambiguity that used to come with it existed only because
              the container could not reach outside its mount.
            */}
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
        submitLabel="Create skill"
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
          <SkillTemplatePreview
            mode={mode}
            target={target}
            name={name}
            idea={idea}
            useWhen={useWhen}
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
                <strong className="text-(--ink)">Auto.</strong> The frontmatter is written now; Claude fills in the body
                from your idea + triggers.
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
          id="cs-row-1"
          label="Skill name"
          hint={
            mode === "auto"
              ? "kebab-case. Leave blank and one is derived from your idea."
              : "kebab-case, e.g. migration-reviewer."
          }
          error={errors.name?.message ?? null}
        >
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <Input id="cs-name" {...field} mono placeholder="my-skill" error={errors.name?.message ?? null} />
            )}
          />
        </Field>

        <Field
          id="cs-row-2"
          label={mode === "auto" ? "Skill idea" : "Description"}
          hint={
            mode === "auto"
              ? 'Describe what the skill does. Best descriptions start with a verb ("Reviews…", "Writes…", "Extracts…").'
              : "Used as the docstring. First sentence: what it does."
          }
          error={errors.idea?.message ?? null}
        >
          <Controller
            name="idea"
            control={control}
            render={({ field }) => (
              <Textarea
                id="cs-idea"
                {...field}
                rows={4}
                placeholder={
                  mode === "auto"
                    ? "Reviews database migrations for safety issues. Checks for missing rollbacks, destructive operations on large tables, and missing indexes on foreign keys."
                    : "A short, focused description of what this skill does and when it applies."
                }
                error={errors.idea?.message ?? null}
              />
            )}
          />
        </Field>

        <Field
          id="cs-row-3"
          label="Use when…"
          hint="Specific triggers that tell Claude when to load this skill. Press Enter to add each."
        >
          <Controller
            name="useWhen"
            control={control}
            render={({ field }) => (
              <ChipInput
                id="cs-useWhen"
                values={field.value}
                onChange={field.onChange}
                placeholder="e.g. user shares a .sql file"
              />
            )}
          />
        </Field>

        {target === "marketplace" ? (
          <>
            <Field
              id="cs-row-4"
              label="Marketplace"
              hint={
                marketplaces.length === 0
                  ? "No local marketplaces are registered with Claude Code — create one, or switch to Project."
                  : "The workspace this skill belongs to."
              }
              error={errors.marketplace?.message ?? null}
            >
              <Controller
                name="marketplace"
                control={control}
                render={({ field }) => (
                  <Select
                    id="cs-marketplace"
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

            <Field id="cs-row-5" label="Plugin" hint="Which plugin group to file the skill under.">
              <Controller
                name="plugin"
                control={control}
                render={({ field }) => (
                  <Select
                    id="cs-plugin"
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
            id="cs-row-4"
            label="Project location"
            hint="The skill will be created at <project>/.claude/skills/<name>/."
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
