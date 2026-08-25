// Managed-region helpers for the project's Maestro orchestrator skill
// (.claude/skills/maestro/SKILL.md).
//
// Two kinds of region live in that file:
//   - PLUGIN-OWNED regions (MANAGED_REGIONS) — their body comes from
//     templates/maestro/SKILL.md and is re-synced by maestro-install.js on every
//     install/update, so template improvements reach already-installed projects.
//   - RENDERED regions (RENDERED_REGIONS) — their body is generated from
//     .claude/maestro.json by maestro-render-orchestrator.cjs. They are nested
//     inside a plugin-owned region, so a sync must carry the installed content
//     across (the renderer would otherwise have to run to restore it).
//
// Everything outside the plugin-owned regions is the user's and is never touched.

// Plugin-owned regions, synced from the template.
const MANAGED_REGIONS = ["STEPS", "PRINCIPLES"];

// Generated regions whose installed content survives a template sync.
const RENDERED_REGIONS = ["HANDOFFS"];

function startMarker(name) {
  return `<!-- Maestro:${name}:START -->`;
}

function endMarker(name) {
  return `<!-- Maestro:${name}:END -->`;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regionRe(name) {
  return new RegExp(`${escapeRe(startMarker(name))}([\\s\\S]*?)${escapeRe(endMarker(name))}`);
}

// Body of a named region, trimmed of the newlines hugging the markers, or null
// if the region is absent.
function extractRegion(text, name) {
  const m = text.match(regionRe(name));
  return m ? m[1].replace(/^\n/, "").replace(/\n$/, "") : null;
}

// Replace a named region's body. Returns the text unchanged if the region is absent.
function replaceRegion(text, name, replacement) {
  const re = regionRe(name);
  if (!re.test(text)) return text;
  return text.replace(re, `${startMarker(name)}\n${replacement}\n${endMarker(name)}`);
}

// Sync every plugin-owned region of `installed` from `template`, preserving the
// installed body of each rendered (generated) region and everything outside the
// managed regions.
//
// Returns { text, synced, missing } — `missing` lists managed regions absent from
// the installed file (a pre-managed-regions install); when it is non-empty the
// caller should treat the file as un-syncable and migrate it instead.
function syncManagedRegions(installed, template) {
  const missing = MANAGED_REGIONS.filter((name) => extractRegion(installed, name) === null);
  if (missing.length > 0) return { text: installed, synced: [], missing };

  const preserved = new Map();
  for (const name of RENDERED_REGIONS) {
    const body = extractRegion(installed, name);
    if (body !== null) preserved.set(name, body);
  }

  let text = installed;
  const synced = [];
  for (const name of MANAGED_REGIONS) {
    const body = extractRegion(template, name);
    if (body === null) continue; // template dropped the region — leave the install alone
    const next = replaceRegion(text, name, body);
    if (next !== text) synced.push(name);
    text = next;
  }
  for (const [name, body] of preserved) {
    text = replaceRegion(text, name, body);
  }
  return { text, synced, missing: [] };
}

module.exports = {
  MANAGED_REGIONS,
  RENDERED_REGIONS,
  startMarker,
  endMarker,
  extractRegion,
  replaceRegion,
  syncManagedRegions,
};
