// Renders one AvatarLayers selection onto a 64x64 pixel-art canvas, upscaled with CSS and no
// smoothing — the picker's live preview, and the /agents detail pane's saved-avatar display.

import { useEffect, useRef } from "react";
import { AVATAR_RENDER_ORDER, resolveAvatarUrl } from "../../assets/avatar/manifest";
import type { AvatarLayers } from "../../../../shared/ipc";

const SPRITE_SIZE = 64;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
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
    const urls = AVATAR_RENDER_ORDER.map((cat) => {
      const id = layers[cat];
      return id ? (resolveAvatarUrl(cat, id, layers.body) ?? null) : null;
    }).filter((url): url is string => url !== null);

    void Promise.all(urls.map(loadImage))
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
