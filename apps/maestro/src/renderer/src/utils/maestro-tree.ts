// Type-only re-export. The directory tree arrives with the rest of the /rules payload
// (see getRulesData in ./maestro.ts) rather than through its own fetch — walking the project
// tree three times per page load is what four separate server-fn calls used to cost.
import type { TreeNode } from "../../../shared/ipc";

export type { TreeNode };
