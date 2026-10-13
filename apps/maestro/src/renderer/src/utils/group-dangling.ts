import type { DanglingSkillRef, UnavailableReason } from "./maestro";

export interface GroupDangling {
  /** How many of the group's skills are dangling; 0 when none are. */
  count: number;
  /** The reason every dangling skill in the group shares; undefined when none are dangling or they differ. */
  reason: UnavailableReason | undefined;
}

/**
 * Summarise a (collapsed) plugin group's dangling skill references for its header indicator.
 * `find` is `useSkillRefs().find`; a skill id listed twice is counted once.
 */
export function summarizeGroupDangling(
  ids: readonly string[],
  find: (id: string) => DanglingSkillRef | undefined
): GroupDangling {
  const reasons = new Set<UnavailableReason>();
  let count = 0;
  for (const id of new Set(ids)) {
    const hit = find(id);
    if (!hit) continue;
    count++;
    reasons.add(hit.reason);
  }
  return { count, reason: reasons.size === 1 ? [...reasons][0] : undefined };
}
