// Bundle entry for plugins/maestro/scripts/lib/maestro-worker-runtime.cjs.
//
// Backs the `maestro-worker-runtime.cjs` CLI (`175`): build or reuse a project's worker image and
// launch one containerized /maestro worker. `worker-runtime.ts` uses `fs`/`path`/`crypto` only and
// reaches `worktree.ts` (`fs`/`path`), so the bundle never pulls in `node:sqlite`. Every process
// spawn lives in the CLI, not here.

export {
  WORKER_RUNTIME_ENV,
  WORKER_RUNTIME_SCRIPT,
  CONTAINER_APPROVALS_DIR,
  WORKER_TOKEN_REL,
  READONLY_PATHS,
  KNOWN_HOOK_PACKAGES,
  detectHookPackages,
  resolveWorkerRuntime,
  dockerLaunchCommandFor,
  filterSettingsLocal,
  workerMounts,
  mountArg,
  workerRunArgs,
  containerNameFor,
  worktreeMountPath,
  readWorkerToken,
  tokenSetupMessage,
  enabledPluginIds,
  pinPlugins,
  parsePackageSpecs,
  hookPackagesFor,
  imageTagInputs,
  imageTag,
  claudeJsonFor,
  trustedPaths,
  isExcludedName,
  isExcludedPath,
  dockerignoreText,
  knownMarketplacesJsonFor,
  managedSettingsJson,
  installedPluginsJsonFor,
  userSettingsJsonFor,
  imagePluginProbe,
  parseProbeOutput,
  missingPluginMessage,
  isContainerWorker,
  refreshRuntimeWords,
  parsePackageManager,
  detectToolchain,
  packageManagerInstall,
  EMPTY_TOOLCHAIN,
  dockerfileFor,
  gatherImageSpec,
  writeBuildContext,
  isMarketplaceExcluded,
  WORKER_IMAGE_PREFIX,
  PROJECT_LABEL,
  projectLabelFor,
  planPrune,
  formatBytes,
  formatPrune,
} from "../worker-runtime.js";

// `177`: the launcher mounts the approvals directory only when `manager_approval` is on.
export { resolveManagerApproval, approvalsDir } from "../manager-approval.js";
