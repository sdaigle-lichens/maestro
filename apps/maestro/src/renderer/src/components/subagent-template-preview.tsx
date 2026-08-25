import FilePreview from "@repo/ui/file-preview";
import { FileText } from "lucide-react";
import { buildDesc, clip, titleFromName } from "../utils/text";

/**
 * The agent file as it will be written.
 *
 * Two shapes, because the destinations are genuinely different: a project subagent is one flat
 * `.claude/agents/<name>.md` (what Claude Code reads), a marketplace one is a directory with an
 * `AGENTS.md` (what a plugin distributes). The preview shows whichever the target selects, so the
 * filename in the title bar is the filename on disk.
 */
export default function SubagentTemplatePreview({
  mode,
  target,
  name,
  idea,
  description,
  triggers,
  tools,
  marketplace,
  marketplacePath,
  plugin,
  projectRoot,
}: {
  mode: "auto" | "manual";
  target: "marketplace" | "project";
  name: string;
  idea: string;
  description: string;
  triggers: string[];
  tools: string[];
  marketplace: string;
  marketplacePath: string;
  plugin: string;
  projectRoot: string;
}) {
  const displayName = name || "my-agent";
  const source = mode === "auto" ? idea : description;
  const desc = clip(
    buildDesc(mode, source, triggers, {
      manualFallback: "<short description of what this subagent does>",
      whatFallback: "<what this subagent does>",
    }),
    140
  );

  const body =
    mode === "manual"
      ? [
          `Instructions for AI coding agents acting as ${displayName}. See [agents.md](https://agents.md/) for the format.`,
          "",
          "## Role — workflow",
          "",
          "### When to apply",
          "",
          triggers.length ? triggers.join(", ") : "<describe when this agent applies>",
          "",
          "### Workflow",
          "",
          "1. Step one",
          "2. Step two",
          "",
          "### Output",
          "",
          "Describe the expected output format here.",
        ]
      : [
          "<!-- The /ai-tools dispatcher (or /create-skill) authors the full body here from the idea. -->",
          "Describe the workflow, concrete steps, and any reference tables.",
        ];

  const lines = [
    "---",
    `name: ${displayName}`,
    `description: "${desc}"`,
    ...(tools.length ? [`tools: ${tools.join(", ")}`] : []),
    "---",
    "",
    `# ${titleFromName(displayName, "my-agent")}`,
    "",
    ...body,
  ];

  const isProject = target === "project";
  const root = isProject ? projectRoot || "<no project open>" : marketplacePath || `<${marketplace || "marketplace"}>`;
  const path = isProject
    ? `${root.replace(/\/+$/, "")}/.claude/agents/`
    : `${root.replace(/\/+$/, "")}/plugins/${plugin || "<plugin>"}/agents/${displayName}/`;

  return (
    <FilePreview
      filename={isProject ? `${displayName}.md` : "AGENTS.md"}
      fileIcon={<FileText size={11} />}
      path={path}
      lines={lines}
    />
  );
}
