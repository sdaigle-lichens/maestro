import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Field, Input } from "@repo/ui/field";
import ChipInput from "@repo/ui/chip-input";
import Select from "@repo/ui/select";
import CreateShell, { jumpToField, type ShortcutSection } from "../components/create-shell";
import CreateResult from "../components/create-result";
import PluginManifestPreview from "../components/plugin-manifest-preview";
import { getCreateOptions, useCreateFlow } from "../utils/create-flow";

const pluginSchema = z.object({
  name: z
    .string()
    .min(1, "Required.")
    .refine((v) => /^[a-z][a-z0-9-]*$/.test(v), {
      message: "Use kebab-case: lowercase letters, numbers, and dashes.",
    }),
  description: z.string().min(1, "Tell Claude what this plugin provides."),
  keywords: z.array(z.string()),
  marketplace: z.string().min(1, "Pick a marketplace to add the plugin to."),
});

type PluginForm = z.infer<typeof pluginSchema>;

export const Route = createFileRoute("/create-plugin")({
  loader: () => getCreateOptions(),
  component: CreatePlugin,
});

const SHORTCUTS: ShortcutSection[] = [
  {
    title: "Navigation",
    items: [
      ["Jump to field 1–4", "⌘1–4"],
      ["Next / previous field", "Tab / ⇧Tab"],
    ],
  },
  {
    title: "Actions",
    items: [
      ["Create plugin", "⌘↵"],
      ["Show this help", "?"],
      ["Close overlay", "Esc"],
    ],
  },
];

const FIELD_IDS = ["cp-name", "cp-description", "cp-keywords", "cp-marketplace"];
const ROW_IDS = ["cp-row-1", "cp-row-2", "cp-row-3", "cp-row-4"];

function CreatePlugin() {
  const { marketplaces } = Route.useLoaderData();
  const [helpOpen, setHelpOpen] = useState(false);
  const flow = useCreateFlow("Plugin");

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<PluginForm>({
    resolver: zodResolver(pluginSchema),
    defaultValues: { name: "", description: "", keywords: [], marketplace: marketplaces[0]?.name ?? "" },
  });

  const [name, description, keywords, marketplace] = watch(["name", "description", "keywords", "marketplace"]);
  const selected = marketplaces.find((m) => m.name === marketplace);

  const submit = () =>
    void handleSubmit(
      (values) =>
        flow.create({ kind: "create-plugin", ...values }, () =>
          reset({ ...values, name: "", description: "", keywords: [] })
        ),
      (errs) => {
        if (errs.name) jumpToField(FIELD_IDS, ROW_IDS, 1);
        else if (errs.description) jumpToField(FIELD_IDS, ROW_IDS, 2);
        else if (errs.marketplace) jumpToField(FIELD_IDS, ROW_IDS, 4);
      }
    )();

  return (
    <>
      <CreateShell
        title="New plugin"
        subtitle="Scaffold a plugin and register it in the marketplace — manifest, skills folder and catalog entry, all written at once."
        fieldIds={FIELD_IDS}
        rowIds={ROW_IDS}
        shortcuts={SHORTCUTS}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        onSubmit={submit}
        submitLabel="Create plugin"
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
          <PluginManifestPreview
            name={name}
            description={description}
            keywords={keywords}
            marketplace={marketplace}
            marketplacePath={selected?.path ?? ""}
            owner={selected?.owner ?? null}
          />
        }
      >
        <Field
          id="cp-row-1"
          label="Plugin name"
          hint="kebab-case, e.g. my-plugin."
          error={errors.name?.message ?? null}
        >
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <Input id="cp-name" {...field} mono placeholder="my-plugin" error={errors.name?.message ?? null} />
            )}
          />
        </Field>

        <Field
          id="cp-row-2"
          label="Description"
          hint="One-line summary of what this plugin provides. It goes in the manifest and in the marketplace's catalog entry."
          error={errors.description?.message ?? null}
        >
          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <Input
                id="cp-description"
                {...field}
                placeholder="What this plugin provides"
                error={errors.description?.message ?? null}
              />
            )}
          />
        </Field>

        <Field id="cp-row-3" label="Keywords" hint="Searchable tags. Press Enter to add each.">
          <Controller
            name="keywords"
            control={control}
            render={({ field }) => (
              <ChipInput id="cp-keywords" values={field.value} onChange={field.onChange} placeholder="e.g. testing" />
            )}
          />
        </Field>

        <Field
          id="cp-row-4"
          label="Marketplace"
          hint={
            marketplaces.length === 0
              ? "No local marketplaces are registered with Claude Code. Create one first."
              : "The plugin is written under its plugins/ directory and added to its catalog."
          }
          error={errors.marketplace?.message ?? null}
        >
          <Controller
            name="marketplace"
            control={control}
            render={({ field }) => (
              <Select
                id="cp-marketplace"
                value={field.value}
                options={marketplaces.map((m) => ({ id: m.name, name: m.name }))}
                onChange={field.onChange}
              />
            )}
          />
        </Field>
      </CreateShell>
      {flow.dialog}
    </>
  );
}
