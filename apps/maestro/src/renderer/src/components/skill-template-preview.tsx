import FilePreview from "@repo/ui/file-preview";
import { FileText } from "lucide-react";
import { buildDesc, clip, titleFromName } from "../utils/text";

/**
 * The SKILL.md as it will be written, updating on every keystroke.
 *
 * `buildDesc` and `clip` are the SAME functions the node-side scaffold writes the frontmatter with
 * (`src/core/text.ts`, re-exported by ../utils/text). That is not a tidiness point: this
 * pane is the user's only sight of the `description:` before it lands, and a second implementation
 * of it here would be a preview that can drift from the file.
 */
export default function SkillTemplatePreview({
  mode,
  target,
  name,
  idea,
  useWhen,
  marketplace,
  marketplacePath,
  plugin,
  projectRoot,
}: {
  mode: "auto" | "manual";
  target: "marketplace" | "project";
  name: string;
  idea: string;
  useWhen: string[];
  marketplace: string;
  /** Absolute path of the selected marketplace, so the preview shows where it really goes. */
  marketplacePath: string;
  plugin: string;
  projectRoot: string;
}) {
  const displayName = name || "my-skill";
  const description = clip(
    buildDesc(mode, idea, useWhen, {
      manualFallback: "<short description of what this skill does>",
      whatFallback: "<what this skill does>",
    }),
    140
  );
  const body =
    mode === "manual"
      ? [
          "Add instructions here. Structure freely: step-by-step workflow, reference tables, decision trees — whatever fits the skill.",
          "",
          "Optional subdirectories (create only if needed):",
          "",
          "- `scripts/` — executable helpers (Node.js, Python, shell)",
          "- `references/` — supporting docs or templates",
          "- `assets/` — static files (images, data)",
        ]
      : [
          "<!-- The /ai-tools dispatcher (or /create-skill) authors the full body here from the idea. -->",
          "Describe the workflow, concrete steps, and any reference tables.",
        ];

  const lines = [
    "---",
    `name: ${displayName}`,
    `description: "${description}"`,
    "---",
    "",
    `# ${titleFromName(displayName, "my-skill")}`,
    "",
    ...body,
  ];

  const root =
    target === "project" ? projectRoot || "<no project open>" : marketplacePath || `<${marketplace || "marketplace"}>`;
  const path =
    target === "project"
      ? `${root.replace(/\/+$/, "")}/.claude/skills/${displayName}/`
      : `${root.replace(/\/+$/, "")}/plugins/${plugin || "<plugin>"}/skills/${displayName}/`;

  return <FilePreview filename="SKILL.md" fileIcon={<FileText size={11} />} path={path} lines={lines} />;
}
