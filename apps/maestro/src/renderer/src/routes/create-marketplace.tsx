import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Field, Input } from "@repo/ui/field";
import CreateShell, { jumpToField, type ShortcutSection } from "../components/create-shell";
import CreateResult from "../components/create-result";
import MarketplaceManifestPreview from "../components/marketplace-manifest-preview";
import { getCreateOptions, useCreateFlow } from "../utils/create-flow";

const marketplaceSchema = z.object({
  name: z
    .string()
    .min(1, "Required.")
    .refine((v) => /^[a-z][a-z0-9-]*$/.test(v), {
      message: "Use kebab-case: lowercase letters, numbers, and dashes.",
    }),
  description: z.string().min(1, "Tell Claude what this marketplace provides."),
  ownerName: z.string().min(1, "Required."),
  ownerEmail: z.email("Enter a valid email."),
  homepage: z.string(),
  // Absolute, because a relative path would resolve against wherever the app happened to be
  // launched from — never a directory the user meant.
  targetDir: z
    .string()
    .min(1, "Required.")
    .refine((v) => v.trim().startsWith("/") || /^[A-Za-z]:[\\/]/.test(v.trim()), {
      message: "Use an absolute path.",
    }),
  privateRepo: z.boolean(),
});

type MarketplaceForm = z.infer<typeof marketplaceSchema>;

export const Route = createFileRoute("/create-marketplace")({
  loader: () => getCreateOptions(),
  component: CreateMarketplace,
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
      ["Create marketplace", "⌘↵"],
      ["Show this help", "?"],
      ["Close overlay", "Esc"],
    ],
  },
];

const FIELD_IDS = ["cm-name", "cm-description", "cm-owner-name", "cm-owner-email", "cm-homepage", "cm-target-dir"];
const ROW_IDS = ["cm-row-1", "cm-row-2", "cm-row-3", "cm-row-4", "cm-row-5", "cm-row-6"];

/** The open project's parent — where a sibling repo would naturally go. "" with no project open. */
function defaultParent(projectRoot: string): string {
  const trimmed = projectRoot.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut > 0 ? trimmed.slice(0, cut) : "";
}

function CreateMarketplace() {
  const { projectRoot } = Route.useLoaderData();
  const [helpOpen, setHelpOpen] = useState(false);
  const flow = useCreateFlow("Marketplace");

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<MarketplaceForm>({
    resolver: zodResolver(marketplaceSchema),
    defaultValues: {
      name: "",
      description: "",
      ownerName: "",
      ownerEmail: "",
      homepage: "",
      // A suggestion, not a destination: the marketplace IS this directory, so it is pre-filled
      // beside the open project rather than pointing at the project itself.
      targetDir: defaultParent(projectRoot),
      privateRepo: false,
    },
  });

  const [name, description, ownerName, ownerEmail, homepage, targetDir] = watch([
    "name",
    "description",
    "ownerName",
    "ownerEmail",
    "homepage",
    "targetDir",
  ]);

  const submit = () =>
    void handleSubmit(
      (values) =>
        flow.create({ kind: "create-marketplace", ...values }, () =>
          // Owner and target directory are the user's standing answers; only the marketplace's own
          // identity is cleared.
          reset({ ...values, name: "", description: "", homepage: "" })
        ),
      (errs) => {
        if (errs.name) jumpToField(FIELD_IDS, ROW_IDS, 1);
        else if (errs.description) jumpToField(FIELD_IDS, ROW_IDS, 2);
        else if (errs.ownerName) jumpToField(FIELD_IDS, ROW_IDS, 3);
        else if (errs.ownerEmail) jumpToField(FIELD_IDS, ROW_IDS, 4);
        else if (errs.targetDir) jumpToField(FIELD_IDS, ROW_IDS, 6);
      }
    )();

  return (
    <>
      <CreateShell
        title="New marketplace"
        subtitle="Scaffold a plugin marketplace: the manifest and a starter README are written now, and Claude enriches the docs when you confirm."
        fieldIds={FIELD_IDS}
        rowIds={ROW_IDS}
        shortcuts={SHORTCUTS}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        onSubmit={submit}
        submitLabel="Create marketplace"
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
          <MarketplaceManifestPreview
            name={name}
            description={description}
            ownerName={ownerName}
            ownerEmail={ownerEmail}
            homepage={homepage}
            targetDir={targetDir}
          />
        }
      >
        <Field
          id="cm-row-1"
          label="Marketplace name"
          hint="kebab-case, e.g. my-tools."
          error={errors.name?.message ?? null}
        >
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <Input id="cm-name" {...field} mono placeholder="my-tools" error={errors.name?.message ?? null} />
            )}
          />
        </Field>

        <Field
          id="cm-row-2"
          label="Description"
          hint="One-line summary of what this marketplace provides."
          error={errors.description?.message ?? null}
        >
          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <Input
                id="cm-description"
                {...field}
                placeholder="What this marketplace provides"
                error={errors.description?.message ?? null}
              />
            )}
          />
        </Field>

        <Field
          id="cm-row-3"
          label="Owner name"
          hint="Every plugin created here inherits this as its author."
          error={errors.ownerName?.message ?? null}
        >
          <Controller
            name="ownerName"
            control={control}
            render={({ field }) => (
              <Input
                id="cm-owner-name"
                {...field}
                placeholder="Your name or organization"
                error={errors.ownerName?.message ?? null}
              />
            )}
          />
        </Field>

        <Field id="cm-row-4" label="Owner email" error={errors.ownerEmail?.message ?? null}>
          <Controller
            name="ownerEmail"
            control={control}
            render={({ field }) => (
              <Input
                id="cm-owner-email"
                type="email"
                {...field}
                placeholder="you@example.com"
                error={errors.ownerEmail?.message ?? null}
              />
            )}
          />
        </Field>

        <Field id="cm-row-5" label="Homepage" hint="Optional. Shown on marketplace listings.">
          <Controller
            name="homepage"
            control={control}
            render={({ field }) => <Input id="cm-homepage" {...field} placeholder="https://github.com/you/my-tools" />}
          />
        </Field>

        <Field
          id="cm-row-6"
          label="Target directory"
          hint="This directory becomes the marketplace — the manifest is written to <dir>/.claude-plugin/. Anywhere on this machine; there is no container to reach out of any more."
          error={errors.targetDir?.message ?? null}
        >
          <Controller
            name="targetDir"
            control={control}
            render={({ field }) => (
              <Input
                id="cm-target-dir"
                {...field}
                mono
                placeholder="/path/to/my-tools"
                error={errors.targetDir?.message ?? null}
              />
            )}
          />
        </Field>

        <Controller
          name="privateRepo"
          control={control}
          render={({ field }) => (
            <label className="mb-4.5 flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                className="w-4 h-4 cursor-pointer accent-(--primary)"
              />
              <span className="text-sm text-(--ink)">Private repository</span>
              <span className="text-xs text-subtle">— adds token-based auth setup instructions</span>
            </label>
          )}
        />
      </CreateShell>
      {flow.dialog}
    </>
  );
}
