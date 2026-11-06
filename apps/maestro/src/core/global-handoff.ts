// The global handoff tier as the hook scripts read it, defined once.
//
// The hooks (maestro-inject-agent-context.js, maestro-subagent-log.js, maestro-resume-target.cjs)
// read ~/.claude/maestro-handoff-defaults.sqlite through the SEPARATE bundle
// lib/maestro-handoff-defaults.cjs, required lazily: an older `node` (< 22.5, no node:sqlite) or a
// missing bundle must degrade to null so `resolveHandoff` falls through to the seed, which travels
// inside lib/maestro-session.cjs and needs no sqlite. This module is bundled into maestro-session.cjs,
// which sits in the SAME lib directory as the sqlite bundle, so the require path is "./…".
//
// The path goes through a variable on purpose: esbuild bundles a literal require() argument, which
// would inline node:sqlite into maestro-session.cjs and break the seed fall-through. A non-literal
// stays a runtime require, resolved relative to the bundle's own file. Outside the CJS bundle
// (the app, vitest) `require` is not defined: the ReferenceError is caught and the answer is null.

import type { HandoffDefault } from "./handoff-defaults.js";

const SQLITE_BUNDLE = "./maestro-handoff-defaults.cjs";

export function readGlobalHandoff(handoffId: string): HandoffDefault | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy by design, see header
    const lib = require(SQLITE_BUNDLE) as { readHandoffDefault: (id: string) => HandoffDefault | null };
    return lib.readHandoffDefault(handoffId);
  } catch {
    return null;
  }
}
