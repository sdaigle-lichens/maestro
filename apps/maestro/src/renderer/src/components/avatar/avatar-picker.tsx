// One row per AVATAR_CATEGORIES entry, a swatch button per option (plus a "None" swatch for
// optional categories), a Randomize button, and a live <AvatarCanvas> preview. Controlled, same
// shape as every other field in this app's forms.

import { Shuffle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import Button from "@repo/ui/button";
import { AVATAR_CATEGORIES, AVATAR_PARTS, AVATAR_REQUIRED_CATEGORIES, type AvatarCategory, type AvatarLayers } from "../../../../shared/ipc";
import { resolveAvatarUrl } from "../../assets/avatar/manifest";
import { randomAvatarLayers } from "../../utils/avatar";
import AvatarCanvas from "./avatar-canvas";

const CATEGORY_LABELS: Record<AvatarCategory, string> = {
  body: "Body",
  head: "Head",
  eyes: "Eyes",
  hair: "Hair",
  torso: "Torso",
  legs: "Legs",
  feet: "Feet",
  hat: "Hat",
};

const SWATCH_BASE =
  "w-9 h-9 rounded-md border flex items-center justify-center overflow-hidden shrink-0 transition-colors cursor-pointer";
const SWATCH_ON = "border-ring bg-(--primary-dim)";
const SWATCH_OFF = "border-(--line) bg-(--bg-elev) hover:border-(--ink-2)";

export default function AvatarPicker({
  value,
  onChange,
}: {
  value: AvatarLayers;
  onChange: (layers: AvatarLayers) => void;
}) {
  function setCategory(cat: AvatarCategory, id: string | null) {
    onChange({ ...value, [cat]: id });
  }

  const required = AVATAR_REQUIRED_CATEGORIES as readonly AvatarCategory[];

  return (
    <div className="flex gap-4">
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        {AVATAR_CATEGORIES.map((cat) => (
          <div key={cat} className="flex items-center gap-2">
            <div className="w-12 shrink-0 text-[11px] text-(--ink-3) uppercase tracking-wide">
              {CATEGORY_LABELS[cat]}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {!required.includes(cat) && (
                <button
                  type="button"
                  aria-pressed={value[cat] === null}
                  title="None"
                  onClick={() => setCategory(cat, null)}
                  className={`${SWATCH_BASE} ${value[cat] === null ? SWATCH_ON : SWATCH_OFF} text-[10px] text-(--ink-3)`}
                >
                  &ndash;
                </button>
              )}
              {AVATAR_PARTS[cat].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={value[cat] === opt.id}
                  title={opt.name}
                  onClick={() => setCategory(cat, opt.id)}
                  className={`${SWATCH_BASE} ${value[cat] === opt.id ? SWATCH_ON : SWATCH_OFF}`}
                >
                  <img
                    src={resolveAvatarUrl(cat, opt.id, value.body)}
                    alt={opt.name}
                    className="w-full h-full"
                    style={{ imageRendering: "pixelated" }}
                  />
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button variant="secondary" icon={<Shuffle size={13} />} onClick={() => onChange(randomAvatarLayers())}>
            Randomize
          </Button>
          <Link
            to="/docs/$group/$slug"
            params={{ group: "app", slug: "avatar-art-credits" }}
            search={{ q: "", at: "" }}
            className="text-[11px] text-(--ink-3) hover:text-(--ink-2) no-underline"
          >
            Character art: Universal LPC Spritesheet &mdash; GPL-3.0 / CC-BY-SA 3.0
          </Link>
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-center gap-2">
        <div className="rounded-lg border border-(--line) bg-(--bg-elev) p-2">
          <AvatarCanvas layers={value} size={112} />
        </div>
        <span className="text-[11px] text-(--ink-3)">Preview</span>
      </div>
    </div>
  );
}
