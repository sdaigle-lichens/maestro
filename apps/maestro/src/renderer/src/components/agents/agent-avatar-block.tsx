// The /agents card's avatar block — the frame in both modes, plus the tabs + arrows editor.
//
// This SUPERSEDES `avatar-picker.tsx`'s swatch-rows layout on this page (the picker is still what
// /create-subagent renders). The two were prototyped side by side and this one was chosen: eight
// category icons and a pair of arrows occupy one row and a fixed height, where a swatch grid grows
// with the number of options and made the card 914px tall instead of 637px — tall enough that the
// details below it fell off the screen.

import { useRef } from "react";
import {
  DiceFiveIcon,
  EqualsIcon,
  EyeIcon,
  FootprintsIcon,
  HardHatIcon,
  type Icon,
  PersonIcon,
  ScissorsIcon,
  TShirtIcon,
} from "@phosphor-icons/react";
import AvatarCanvas from "../avatar/avatar-canvas";
import {
  AVATAR_CATEGORIES,
  AVATAR_PARTS,
  AVATAR_REQUIRED_CATEGORIES,
  EYE_RECOLOR_SHAPES,
  HAIR_RECOLOR_SHAPES,
  type AvatarCategory,
  type AvatarLayers,
} from "../../../../shared/ipc";
import { nativeEyesColor, nativeHairColor, randomAvatarLayers } from "../../utils/avatar";
import { AVATAR_FRAME_EDIT, AVATAR_FRAME_VIEW, CATEGORY_LABELS, cycleOption, ICON_BUTTON } from "./agent-shared";

/**
 * The swatch + "Select color" control shared by the eyes/hair rows below. The swatch previews
 * `color ?? native` (never a fixed placeholder unrelated to the shape) and carries the Reset
 * control as a small badge nested inside it, rather than a separate button that pops in and out
 * of the layout next to it — "Select color" always opens the native picker via a ref, since a
 * `<label>` alone can't stay clickable once a nested Reset button needs to intercept its own
 * clicks.
 */
function ColorControl({
  label,
  color,
  native,
  onChange,
}: {
  label: string;
  color: string | null;
  native: string;
  onChange: (color: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center justify-center gap-1.5">
      <div
        title={color !== null ? `Custom ${label.toLowerCase()}` : `Native ${label.toLowerCase()} (unrecolored)`}
        className="relative w-6 h-6 rounded-md border border-maestro-strong overflow-hidden"
        style={{ backgroundColor: color ?? native }}
      >
        {color !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Reset to the upstream color"
            className="absolute -top-1 -right-1 w-3 h-3 grid place-items-center rounded-full border border-maestro-strong bg-maestro-elevated text-maestro-muted text-[8px] leading-none cursor-pointer hover:text-maestro hover:border-maestro-primary-strong"
          >
            ×
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title={`Choose a custom ${label.toLowerCase()}`}
        className="text-[10px] text-maestro-muted hover:text-maestro cursor-pointer bg-transparent border-none p-0"
      >
        Select color
      </button>
      <input
        ref={inputRef}
        type="color"
        value={color ?? native}
        onChange={(e) => onChange(e.target.value)}
        className="absolute w-px h-px opacity-0 pointer-events-none"
      />
    </div>
  );
}

const CATEGORY_ICONS: Record<AvatarCategory, Icon> = {
  sex: PersonIcon,
  eyes: EyeIcon,
  hair: ScissorsIcon,
  torso: TShirtIcon,
  legs: EqualsIcon,
  feet: FootprintsIcon,
  hat: HardHatIcon,
};

function partName(cat: AvatarCategory, id: string | null): string {
  if (id === null) return "None";
  return AVATAR_PARTS[cat].find((o) => o.id === id)?.name ?? id;
}

function isRequired(cat: AvatarCategory): boolean {
  return (AVATAR_REQUIRED_CATEGORIES as readonly AvatarCategory[]).includes(cat);
}

export default function AgentAvatarBlock({
  layers,
  editing,
  activeCat,
  onActiveCat,
  onChange,
}: {
  layers: AvatarLayers;
  editing: boolean;
  activeCat: AvatarCategory;
  onActiveCat: (cat: AvatarCategory) => void;
  onChange: (layers: AvatarLayers) => void;
}) {
  const cycle = (dir: 1 | -1) => {
    const options = AVATAR_PARTS[activeCat].map((o) => o.id);
    onChange({ ...layers, [activeCat]: cycleOption(options, isRequired(activeCat), layers[activeCat], dir) });
  };

  const eyesRecolorable = activeCat === "eyes" && layers.eyes !== null && EYE_RECOLOR_SHAPES.includes(layers.eyes);
  const setEyesColor = (color: string | null) => onChange({ ...layers, eyesColor: color });

  const hairRecolorable = activeCat === "hair" && layers.hair !== null && HAIR_RECOLOR_SHAPES.includes(layers.hair);
  const setHairColor = (color: string | null) => onChange({ ...layers, hairColor: color });

  const arrow = (dir: 1 | -1, glyph: string, label: string) => (
    <button
      type="button"
      onClick={() => cycle(dir)}
      title={label}
      className="flex-none w-[30px] h-[56px] grid place-items-center rounded-lg border border-maestro-strong bg-maestro-faint text-maestro-muted text-[18px] leading-none cursor-pointer transition-colors duration-[120ms] hover:text-maestro-primary hover:border-maestro-primary-strong"
    >
      {glyph}
    </button>
  );

  return (
    <div className="w-full max-w-[320px] self-center min-w-0 flex flex-col gap-2">
      {editing && (
        <div className="flex items-center gap-1 flex-wrap">
          {AVATAR_CATEGORIES.map((cat) => {
            const CategoryIcon = CATEGORY_ICONS[cat];
            const active = cat === activeCat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onActiveCat(cat)}
                title={`${CATEGORY_LABELS[cat]} — ${partName(cat, layers[cat])}`}
                className="relative flex-none w-7 h-7 grid place-items-center rounded-md border border-maestro bg-(--pane) p-0 cursor-pointer transition-colors duration-[120ms] hover:border-maestro-strong"
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute -inset-px rounded-md border border-maestro-primary-strong bg-maestro-primary-subtle pointer-events-none"
                  />
                )}
                <CategoryIcon
                  size={14}
                  className={`relative ${active ? "text-maestro-primary" : "text-maestro-muted"}`}
                />
              </button>
            );
          })}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => onChange(randomAvatarLayers())}
            title="Randomize every part"
            className={`flex-none w-7 h-7 p-0 rounded-md text-maestro-muted ${ICON_BUTTON}`}
          >
            <DiceFiveIcon size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {editing && arrow(-1, "‹", "Previous option")}
        <div
          className="relative flex-1 aspect-square mx-auto rounded-xl border border-maestro bg-(--pane) overflow-hidden"
          style={{ maxWidth: editing ? AVATAR_FRAME_EDIT : AVATAR_FRAME_VIEW }}
        >
          <AvatarCanvas layers={layers} fill />
        </div>
        {editing && arrow(1, "›", "Next option")}
      </div>

      {editing ? (
        <>
          <span className="font-mono text-[10.5px] text-maestro-muted text-center">
            {CATEGORY_LABELS[activeCat]} · {partName(activeCat, layers[activeCat])}
          </span>
          {eyesRecolorable && (
            <ColorControl
              label="Eyebrow color"
              color={layers.eyesColor ?? null}
              native={nativeEyesColor(layers.eyes)}
              onChange={setEyesColor}
            />
          )}
          {hairRecolorable && (
            <ColorControl
              label="Hair color"
              color={layers.hairColor ?? null}
              native={nativeHairColor(layers.hair)}
              onChange={setHairColor}
            />
          )}
        </>
      ) : (
        <p className="m-0 text-[10.5px] leading-[1.5] text-maestro-muted">
          Cosmetic only — the avatar never reaches a run.
        </p>
      )}
    </div>
  );
}
