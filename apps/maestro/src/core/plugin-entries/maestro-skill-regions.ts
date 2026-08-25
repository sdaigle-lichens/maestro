// Bundle entry for plugins/maestro/scripts/lib/maestro-skill-regions.cjs.
// See ./maestro-session.ts — the export surface must stay identical to the hand-written .cjs.

export {
  MANAGED_REGIONS,
  RENDERED_REGIONS,
  startMarker,
  endMarker,
  extractRegion,
  replaceRegion,
  syncManagedRegions,
} from "../skill-regions.js";
