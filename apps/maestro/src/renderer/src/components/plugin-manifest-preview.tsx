import FilePreview from "@repo/ui/file-preview";
import { FileJson } from "lucide-react";

/**
 * The plugin.json as it will be written.
 *
 * `version` and `author` are shown because the scaffold writes them and the form does not ask for
 * them — the author is inherited from the marketplace's own manifest. A preview that hid the fields
 * the user did not type would be hiding exactly the ones they cannot predict.
 */
export default function PluginManifestPreview({
  name,
  description,
  keywords,
  marketplace,
  marketplacePath,
  owner,
}: {
  name: string;
  description: string;
  keywords: string[];
  marketplace: string;
  marketplacePath: string;
  /** The marketplace's owner, inherited as the plugin's author. Null when it has none. */
  owner: { name: string; email: string } | null;
}) {
  const displayName = name || "my-plugin";
  const desc = description.trim() || "<what this plugin provides>";
  const keywordLines =
    keywords.length === 0
      ? ['  "keywords": []']
      : ['  "keywords": [', ...keywords.map((k, i) => `    "${k}"${i < keywords.length - 1 ? "," : ""}`), "  ]"];

  const lines = [
    "{",
    `  "name": "${displayName}",`,
    `  "version": "0.1.0",`,
    `  "description": "${desc}",`,
    ...(owner ? ['  "author": {', `    "name": "${owner.name}",`, `    "email": "${owner.email}"`, "  },"] : []),
    ...keywordLines,
    "}",
  ];

  const root = marketplacePath || `<${marketplace || "marketplace"}>`;
  return (
    <FilePreview
      filename="plugin.json"
      fileIcon={<FileJson size={11} />}
      path={`${root.replace(/\/+$/, "")}/plugins/${displayName}/.claude-plugin/`}
      lines={lines}
    />
  );
}
