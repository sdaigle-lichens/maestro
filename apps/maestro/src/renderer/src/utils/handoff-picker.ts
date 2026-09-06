// The pure piece of the Handoffs tab's Create row (`043`): what its pair picker should show for a
// given viewed project and its agent roster. Framework-free, like `session-log.ts`'s
// `buildInstances`, so "no project picked yet" and "picked but empty" are each one assertion in a
// node-environment test instead of a DOM query on the full component tree away.

export function resolveAgentPickerState(
  viewedRoot: string | null,
  projectAgents: string[]
): { options: string[]; createDisabled: boolean } {
  if (!viewedRoot) return { options: [], createDisabled: true };
  return { options: projectAgents, createDisabled: projectAgents.length === 0 };
}
