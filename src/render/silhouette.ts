/**
 * Polished silhouette layer (Phase 7) — the neon/glow/trail upgrade the Phase 3
 * `drawSilhouetteMask` always pointed at.
 *
 * Three passes over the downsampled occupancy mask:
 *  1. paint the mask into a small offscreen, tinted teal→hot by `heat`;
 *  2. accumulate it into a canvas-sized *trail* buffer that fades a little each
 *     frame — so fast motion smears into an afterimage and a still pose doesn't;
 *  3. composite the trail additively (the glow) and lay a crisp, shadow-blurred
 *     core on top.
 *
 * `heat` (0..1) bends the color toward danger and tightens the glow — Hole-in-
 * the-Wall feeds it the live overlap as a wall closes in, turning the core
 * mechanic into "proximity heat". Reused offscreen canvases keep it allocation-
 * free per frame, matching the rest of `render/`.
 */

import { drawMirrored, type Rect } from './canvas';
import { COLORS, rgba } from '../shell/theme';

const TEAL = [46, 230, 200] as const; // COLORS.teal
const HOT = [255, 88, 96] as const; // toward COLORS.danger

const silCanvas = document.createElement('canvas');
const silCtx = silCanvas.getContext('2d')!;
const trailCanvas = document.createElement('canvas');
const trailCtx = trailCanvas.getContext('2d')!;

export interface SilhouetteOptions {
  /** 0 = cool teal, 1 = hot red + brighter glow (proximity / danger). */
  heat?: number;
  /** Overall opacity (e.g. dim the preview vs full in-game). */
  alpha?: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Clear the afterimage buffer — call when the scene changes (e.g. a run starts). */
export function resetSilhouette(): void {
  trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
}

export function drawNeonSilhouette(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  w: number,
  h: number,
  rect: Rect,
  opts: SilhouetteOptions = {},
): void {
  const heat = clamp01(opts.heat ?? 0);
  const alpha = opts.alpha ?? 1;
  const cr = Math.round(lerp(TEAL[0], HOT[0], heat));
  const cg = Math.round(lerp(TEAL[1], HOT[1], heat));
  const cb = Math.round(lerp(TEAL[2], HOT[2], heat));

  // 1. Mask → tinted offscreen (alpha follows the occupancy value).
  if (silCanvas.width !== w || silCanvas.height !== h) {
    silCanvas.width = w;
    silCanvas.height = h;
  }
  const img = silCtx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = data[i];
    const o = i * 4;
    img.data[o] = cr;
    img.data[o + 1] = cg;
    img.data[o + 2] = cb;
    img.data[o + 3] = v > 0.5 ? Math.min(255, Math.round(v * 235)) : 0;
  }
  silCtx.putImageData(img, 0, 0);

  // 2. Accumulate into the (canvas-sized) trail buffer, fading the old image.
  if (trailCanvas.width !== ctx.canvas.width || trailCanvas.height !== ctx.canvas.height) {
    trailCanvas.width = ctx.canvas.width;
    trailCanvas.height = ctx.canvas.height;
  }
  trailCtx.globalCompositeOperation = 'destination-out';
  trailCtx.fillStyle = 'rgba(0,0,0,0.24)'; // erase ~24%/frame => a short, decaying tail
  trailCtx.fillRect(0, 0, trailCanvas.width, trailCanvas.height);
  trailCtx.globalCompositeOperation = 'source-over';
  trailCtx.imageSmoothingEnabled = true;
  drawMirrored(trailCtx, silCanvas, rect);

  // 3a. Additive trail = the soft glow + motion afterimage.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5 * alpha;
  ctx.drawImage(trailCanvas, 0, 0);
  ctx.restore();

  // 3b. Crisp, shadow-blurred core on top.
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = heat > 0.35 ? rgba(`#${HOT.map((c) => c.toString(16).padStart(2, '0')).join('')}`, 0.9) : COLORS.teal;
  ctx.shadowBlur = ctx.canvas.width / (heat > 0.5 ? 28 : 46);
  ctx.imageSmoothingEnabled = true;
  drawMirrored(ctx, silCanvas, rect);
  ctx.restore();
}
