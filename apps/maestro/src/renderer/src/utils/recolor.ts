// Recolors a loaded sprite to an arbitrary hex color, preserving its shading — the runtime
// replacement for the earlier approach of baking one PNG per named eyebrow color (see
// EYE_RECOLOR_SHAPES / AvatarLayers.eyesColor in contracts.ts).
//
// The eyebrow art is flat ink over a three-tone (highlight/mid/shadow) shading pattern. Lightness
// is what carries that pattern, so converting each opaque pixel to HSL and replacing only hue and
// saturation with the target color's — leaving lightness untouched — recolors the shape while
// keeping its shading intact under any target color. This is the same transform the original 20
// palette-swapped PNGs were generated with, just run live instead of pre-baked.

function hexToHueSat(hex: string): { h: number; s: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s };
}

function hueToChannel(p: number, q: number, tIn: number): number {
  let t = tIn;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    Math.round(hueToChannel(p, q, h) * 255),
    Math.round(hueToChannel(p, q, h - 1 / 3) * 255),
  ];
}

/**
 * Draws `img` onto a same-size canvas with every opaque pixel's hue/saturation replaced by
 * `hex`'s, lightness untouched. Fully transparent pixels are left alone (both to skip the work and
 * because touching alpha-0 pixels can leave color fringing visible after later scaling).
 */
export function recolorImage(img: HTMLImageElement, hex: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(img, 0, 0);

  const { h, s } = hexToHueSat(hex);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    const [nr, ng, nb] = hslToRgb(h, s, l);
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
