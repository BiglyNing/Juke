/**
 * Small shared canvas helpers. Both the active game (silhouette, skeleton) and
 * the debug overlay (collision grid) map a perception source into the same
 * "object-fit: contain", mirrored (selfie) rect, so they line up pixel-for-pixel.
 * Phase 7 expands this `render/` folder with the polished silhouette layer.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A "contain" rect (whole source visible, centered, no cropping) inside `dst`. */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** Draw an image source mirrored horizontally (selfie view) into `rect`. */
export function drawMirrored(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  rect: Rect,
): void {
  ctx.save();
  ctx.translate(rect.x + rect.w, rect.y);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0, rect.w, rect.h);
  ctx.restore();
}
