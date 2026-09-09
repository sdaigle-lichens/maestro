// Renders one AvatarLayers selection onto a 64x64 pixel-art canvas, upscaled with CSS and no
// smoothing — the picker's live preview, and the /agents detail pane's saved-avatar display.

import { useEffect, useRef } from "react";
import { AVATAR_RENDER_ORDER, SEX_LAYER_URLS, resolveAvatarUrl } from "../../assets/avatar/manifest";
import { EYE_RECOLOR_SHAPES, HAIR_RECOLOR_SHAPES, type AvatarLayers } from "../../../../shared/ipc";
import { recolorImage } from "../../utils/recolor";

const SPRITE_SIZE = 64;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

/** A layer to draw: its source URL, and a color to recolor it to before drawing (or null). */
interface LayerSpec {
  url: string;
  recolor: string | null;
}

export default function AvatarCanvas({
  layers,
  size = 128,
  fill = false,
  className = "",
}: {
  layers: AvatarLayers;
  size?: number;
  /**
   * Stretch to the parent box instead of `size` px. The /agents card frames the avatar in a
   * responsive `aspect-square` container whose width the layout decides, so it cannot name a pixel
   * size up front; every other caller still passes one.
   */
  fill?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let cancelled = false;
    // The head silhouette isn't a category with its own AvatarLayers slot — it's a second image
    // `sex` always draws, right after `torso` and before `eyes` (see AVATAR_RENDER_ORDER's header).
    const specs: (LayerSpec | null)[] = [];
    for (const cat of AVATAR_RENDER_ORDER) {
      const id = layers[cat];
      const url = id ? (resolveAvatarUrl(cat, id, layers.sex) ?? null) : null;
      let recolor: string | null = null;
      if (id && cat === "eyes" && EYE_RECOLOR_SHAPES.includes(id)) recolor = layers.eyesColor ?? null;
      else if (id && cat === "hair" && HAIR_RECOLOR_SHAPES.includes(id)) recolor = layers.hairColor ?? null;
      specs.push(url ? { url, recolor } : null);
      if (cat === "torso") {
        const headUrl = SEX_LAYER_URLS.head[layers.sex ?? "male"] ?? null;
        specs.push(headUrl ? { url: headUrl, recolor: null } : null);
      }
    }
    const specList = specs.filter((spec): spec is LayerSpec => spec !== null);

    void Promise.all(
      specList.map(async (spec) => {
        const img = await loadImage(spec.url);
        return spec.recolor ? recolorImage(img, spec.recolor) : img;
      })
    )
      .then((images) => {
        if (cancelled) return;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
        for (const img of images) ctx.drawImage(img, 0, 0);
      })
      .catch(() => {
        // A layer failed to load — leave whatever was last drawn rather than a half-composited frame.
      });

    return () => {
      cancelled = true;
    };
  }, [layers]);

  return (
    <canvas
      ref={canvasRef}
      width={SPRITE_SIZE}
      height={SPRITE_SIZE}
      style={
        fill
          ? { width: "100%", height: "100%", imageRendering: "pixelated" }
          : { width: size, height: size, imageRendering: "pixelated" }
      }
      className={className}
    />
  );
}
