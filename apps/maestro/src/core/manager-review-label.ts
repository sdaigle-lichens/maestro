// The condition label on a manager_review node's loop-back edge to the agent that produced the
// work. One constant read by the seed (core, also bundled into the plugin) and the workflow
// canvas (renderer) so a fresh install and an app-added node cannot drift apart.
export const MANAGER_DIRECTION_CHANGE_LABEL = "manager requested direction change";
