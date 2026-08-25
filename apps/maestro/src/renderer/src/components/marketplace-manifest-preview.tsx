import FilePreview from "@repo/ui/file-preview";
import { FileJson } from "lucide-react";

/**
 * The marketplace.json as it will be written.
 *
 * Note the path: `<targetDir>/.claude-plugin/`, not `<targetDir>/<name>/`. The web app's preview
 * claimed the latter while its scaffold wrote the former, so the pane described a directory that
 * never appeared — the target directory IS the marketplace, the name only goes in the manifest.
 * The nesting is corrected here rather than carried across.
 */
export default function MarketplaceManifestPreview({
  name,
  description,
  ownerName,
  ownerEmail,
  homepage,
  targetDir,
}: {
  name: string;
  description: string;
  ownerName: string;
  ownerEmail: string;
  homepage: string;
  targetDir: string;
}) {
  const displayName = name || "my-tools";
  const desc = description.trim() || "<what this marketplace provides>";
  const owner = ownerName.trim() || "<your name>";
  const email = ownerEmail.trim() || "<you@example.com>";
  const home = homepage.trim();

  const lines = [
    "{",
    `  "name": "${displayName}",`,
    `  "owner": {`,
    `    "name": "${owner}",`,
    `    "email": "${email}"`,
    `  },`,
    `  "metadata": {`,
    `    "description": "${desc}",`,
    `    "version": "0.1.0"${home ? "," : ""}`,
    ...(home ? [`    "homepage": "${home}"`] : []),
    `  },`,
    `  "plugins": []`,
    "}",
  ];

  const dir = (targetDir.trim() || "<target/dir>").replace(/\/+$/, "");
  return (
    <FilePreview
      filename="marketplace.json"
      fileIcon={<FileJson size={11} />}
      path={`${dir}/.claude-plugin/`}
      lines={lines}
    />
  );
}
