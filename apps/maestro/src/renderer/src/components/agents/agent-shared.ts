// The vocabulary the three /agents panes share: the draft model an edit session mutates, the
// class strings the design repeats, and the two helpers that are behaviour rather than styling.
//
// Everything here is renderer-pure — no IPC, no fs. The route owns the round trips.

import type { CSSProperties } from "react";
import type { AvatarCategory, AvatarLayers, AgentType } from "../../../../shared/ipc";
import type { SkillMode } from "../instance-skill-picker";

export type { SkillMode };

/**
 * One skill attached to the selected agent's workflow instance. `mode` mirrors the two lists on
 * `MaestroInstanceV3` — `loaded_skills` and `referenced_skills` — and `null` means the chip is
 * still on screen but unchecked, i.e. it will be dropped from BOTH lists when the draft is saved.
 * That third state is what lets the count read "2 of 3 active" without the chip vanishing the
 * instant it is unticked.
 */
export interface AgentSkill {
  id: string;
  mode: SkillMode | null;
}

/**
 * The in-progress copy an edit session works on. Entering edit clones the agent into one of these
 * (deep-copying `layers` and `skills`); Cancel drops it; Save writes each field back through the
 * channel that owns it. Nothing here touches disk until Save.
 */
export interface AgentDraft {
  id: string;
  description: string;
  type: AgentType;
  projectTag: string;
  layers: AvatarLayers;
  skills: AgentSkill[];
  report: string;
}

/**
 * The card's floor, in px, so clicking Edit doesn't reflow the page: the card is the same height
 * in both modes and only its contents swap. Measured from the rendered edit-mode card in a real
 * window — re-measure and update this if edit-mode content changes. See the design handoff's
 * "min-height is load-bearing".
 */
export const CARD_MIN_HEIGHT = 627;

/** View mode gives the avatar the whole column; edit mode gives the arrows room beside it. */
export const AVATAR_FRAME_VIEW = 232;
export const AVATAR_FRAME_EDIT = 168;

/** The right pane's default width and the range its drag handle clamps to. */
export const RIGHT_PANE_DEFAULT = 400;
export const RIGHT_PANE_MIN = 280;
export const RIGHT_PANE_MAX = 720;

export const CATEGORY_LABELS: Record<AvatarCategory, string> = {
  body: "Body",
  head: "Head",
  eyes: "Eyes",
  hair: "Hair",
  torso: "Torso",
  legs: "Legs",
  feet: "Feet",
  hat: "Hat",
};

/**
 * Two page-local surfaces the token set has no name for, mixed out of the ones it does so they
 * still follow the theme: `--pane` is the side panes and the avatar frame (a step between `--bg`
 * and `--bg-2`), `--sunken` is the read-only report block (a step the other way). In dark mode
 * these resolve to exactly the design's `#2b2722` and `#2f2b26`.
 */
export const PANE_SURFACES = {
  "--pane": "color-mix(in srgb, var(--bg) 70%, var(--bg-2))",
  "--sunken": "color-mix(in srgb, var(--bg) 30%, var(--bg-2))",
} as CSSProperties;

/** The 24×24 pane-collapse button, and the 28×28 avatar-category / randomize buttons. */
export const ICON_BUTTON =
  "grid place-items-center rounded-[5px] border border-(--line-2) bg-(--bg-elev) text-(--ink-3) " +
  "cursor-pointer transition-colors duration-[120ms] hover:text-(--ink) hover:border-(--primary)";

/** The 22×22 borderless pencil on a list row and on the interactions header. */
export const PENCIL_BUTTON =
  "w-[22px] h-[22px] shrink-0 grid place-items-center rounded-[5px] border border-transparent bg-transparent " +
  "text-(--ink-3) cursor-pointer transition-colors duration-[120ms] " +
  "hover:text-(--primary) hover:bg-(--bg-3) hover:border-(--line)";

/** The mono id chip: an agent's name in the list, the agent type in the card header. */
export const PRIMARY_CHIP =
  "font-mono text-(--primary) bg-(--primary-dim) border border-(--primary-dim-2) rounded-md";

/** The card footer's secondary action — Edit agent, and Cancel. */
export const FOOTER_BUTTON =
  "inline-flex items-center gap-[7px] h-[34px] px-[14px] rounded-md border border-(--line-2) bg-(--bg-elev) " +
  "text-(--ink-2) text-[12.5px] cursor-pointer transition-colors duration-[120ms] " +
  "hover:text-(--ink) hover:border-(--primary) disabled:cursor-not-allowed disabled:opacity-60";

/** The dashed round `+` that attaches another skill. */
export const DASHED_ADD =
  "w-[26px] h-[26px] grid place-items-center rounded-full border border-dashed border-(--line-2) bg-transparent " +
  "text-(--ink-3) text-[13px] cursor-pointer transition-colors duration-[120ms] " +
  "hover:text-(--primary) hover:border-(--primary) disabled:cursor-not-allowed disabled:opacity-50 " +
  "disabled:hover:text-(--ink-3) disabled:hover:border-(--line-2)";

/** Inputs and the two `<select>`s: the filter box, the agent type, the project tag. */
export const FIELD_CONTROL =
  "h-[30px] px-[10px] rounded-md bg-(--bg-2) border border-(--line-2) text-(--ink) text-[12px] " +
  "outline-none focus:border-(--primary)";

/**
 * Truncate a description on a word boundary with a real `…`.
 *
 * Deliberately JS rather than `-webkit-line-clamp`: the clamp silently loses its ellipsis when the
 * element is also a flex child, and how many lines fit depends on the Chromium build. A string cut
 * here renders the same everywhere, and the untruncated text still goes in `title`.
 */
export function clampText(text: string, max = 108): string {
  if (!text || text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[.,;:\s]+$/, "") + "…";
}

/**
 * The next option in a category's cycle, wrapping at both ends. Optional categories include `null`
 * ("none") in the pool; the three required ones (body/head/eyes) never do — a character with no
 * body is not a character.
 */
export function cycleOption(options: string[], required: boolean, current: string | null, dir: 1 | -1): string | null {
  const pool: Array<string | null> = required ? options : [null, ...options];
  const i = pool.indexOf(current);
  return pool[(i + dir + pool.length) % pool.length];
}
