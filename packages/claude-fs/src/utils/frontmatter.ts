// Minimal YAML frontmatter reader: returns the top-level scalar keys of the leading
// `---` block. Good enough for agent/skill/rule metadata (name, description).
//
// It has no notion of depth — it splits every line on its first `:` — so a nested block does not
// fail, it FLATTENS: `metadata:` with indented children yields an empty `metadata` plus each child
// as a top-level key. Callers reading `name`/`description` are unaffected (unless a nested block
// reuses one of those names, which the Claude Code docs warn against anyway), but anything that
// wants a nested value must use `parseFrontmatterMetadata` below rather than relying on the
// flattening, which cannot tell `metadata.version` from a top-level `version`.
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

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

/**
 * The scalar entries of the frontmatter's `metadata:` map.
 *
 * `metadata` is the Agent Skills spec's designated home for third-party key-value data — Claude
 * Code accepts it and deliberately does not act on its contents, and it is one of the six fields
 * that survive a claude.ai upload or `package_skill.py` packaging. Inventing a top-level key
 * instead is not merely unsanctioned: those paths reject unknown keys with a hard error.
 *
 * Handles the block form (a bare `metadata:` followed by indented `key: value` lines) and the
 * inline flow form (`metadata: { key: value, ... }`). Nested maps deeper than one level are not
 * represented — this reads a flat map, which is what the field is for.
 */
export function parseFrontmatterMetadata(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);

  const start = lines.findIndex((l) => /^metadata\s*:/.test(l));
  if (start === -1) return {};

  const inline = lines[start].slice(lines[start].indexOf(":") + 1).trim();
  if (inline.startsWith("{")) {
    const body = inline.replace(/^\{/, "").replace(/\}$/, "");
    const out: Record<string, string> = {};
    for (const pair of body.split(",")) {
      const i = pair.indexOf(":");
      if (i === -1) continue;
      const key = unquote(pair.slice(0, i));
      if (key) out[key] = unquote(pair.slice(i + 1));
    }
    return out;
  }
  // A non-empty, non-`{` value is a scalar — the field is then not a map, which Claude Code drops.
  if (inline) return {};

  const out: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break; // dedented: the map ended
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    if (key) out[key] = unquote(line.slice(i + 1));
  }
  return out;
}
