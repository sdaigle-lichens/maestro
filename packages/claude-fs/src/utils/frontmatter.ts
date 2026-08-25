// Minimal YAML frontmatter reader: returns the top-level scalar keys of the leading
// `---` block. Good enough for agent/skill/rule metadata (name, description).
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;
    result[key] = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return result;
}
