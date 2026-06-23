/**
 * Shared perception drawing: the faded camera feed, the silhouette mask, and the
 * pose skeleton, all mapped into the same mirrored "contain" rect so they line
 * up. Both the throwaway test game and Hole-in-the-Wall draw themselves against
 * the player this way. (Phase 7 replaces the silhouette layer with the polished
 * neon/trail version; this is the plain Phase 3/4 version.)
 */

import { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Point } from '../engine/pose';
import type { PerceptionFrame } from '../engine/frame';
import { containRect, drawMirrored, type Rect } from './canvas';

const VISIBILITY_THRESHOLD = 0.5;

// Reused offscreen canvas for the upscaled mask overlay.
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d')!;

/** The contain rect for a frame: the live video aspect, or the mask grid when replaying. */
export function perceptionRect(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): Rect {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const srcW = frame.video?.videoWidth || frame.maskW || cw;
  const srcH = frame.video?.videoHeight || frame.maskH || ch;
  return containRect(srcW, srcH, cw, ch);
}

export function drawCameraFeed(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  rect: Rect,
  alpha = 0.85,
): void {
  ctx.globalAlpha = alpha;
  drawMirrored(ctx, video, rect);
  ctx.globalAlpha = 1;
}

export function drawSilhouetteMask(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  w: number,
  h: number,
  rect: Rect,
  alpha = 0.45,
): void {
  if (maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas.width = w;
    maskCanvas.height = h;
  }
  const img = maskCtx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = data[i];
    const o = i * 4;
    img.data[o] = 0; // R
    img.data[o + 1] = 230; // G
    img.data[o + 2] = 255; // B
    img.data[o + 3] = v > 0.5 ? Math.min(255, Math.round(v * 200)) : 0;
  }
  maskCtx.putImageData(img, 0, 0);
  ctx.globalAlpha = alpha;
  drawMirrored(ctx, maskCanvas, rect);
  ctx.globalAlpha = 1;
}

export function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: Point[],
  rect: Rect,
): void {
  const px = (nx: number): number => rect.x + (1 - nx) * rect.w; // mirror x (selfie)
  const py = (ny: number): number => rect.y + ny * rect.h;

  ctx.lineWidth = Math.max(2, ctx.canvas.width / 320);
  ctx.strokeStyle = '#00e6ff';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0, 230, 255, 0.8)';
  ctx.shadowBlur = 8;
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
    const a = pose[start];
    const b = pose[end];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(px(a.x), py(a.y));
    ctx.lineTo(px(b.x), py(b.y));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  const r = Math.max(3, ctx.canvas.width / 280);
  for (const lm of pose) {
    ctx.fillStyle =
      (lm.visibility ?? 0) >= VISIBILITY_THRESHOLD ? '#ffffff' : 'rgba(255, 46, 136, 0.5)';
    ctx.beginPath();
    ctx.arc(px(lm.x), py(lm.y), r, 0, Math.PI * 2);
    ctx.fill();
  }
}
