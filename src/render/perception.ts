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
import { COLORS, rgba } from '../shell/theme';

const VISIBILITY_THRESHOLD = 0.5;

// COLORS.teal (#2ee6c8) as RGB ints, for the per-pixel silhouette fill.
const TEAL_RGB = [46, 230, 200] as const;

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
    img.data[o] = TEAL_RGB[0]; // R
    img.data[o + 1] = TEAL_RGB[1]; // G
    img.data[o + 2] = TEAL_RGB[2]; // B
    img.data[o + 3] = v > 0.5 ? Math.min(255, Math.round(v * 200)) : 0;
  }
  maskCtx.putImageData(img, 0, 0);
  ctx.globalAlpha = alpha;
  drawMirrored(ctx, maskCanvas, rect);
  ctx.globalAlpha = 1;
}

/**
 * Draw the 33-point pose skeleton into the mirrored selfie rect.
 *
 * `strength` (0..1) scales opacity + line/dot weight together: bold at 1 (the
 * calibration default, where it's how the player confirms their limbs are
 * tracked), and toned down in-game (~0.5) where it's confirmation the camera
 * still sees you, not the thing you're looking at.
 */
export function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: Point[],
  rect: Rect,
  strength = 1,
): void {
  const px = (nx: number): number => rect.x + (1 - nx) * rect.w; // mirror x (selfie)
  const py = (ny: number): number => rect.y + ny * rect.h;
  const weight = 0.6 + 0.4 * strength; // taper line/dot size, but never to nothing

  ctx.save();
  ctx.globalAlpha = strength;
  ctx.lineWidth = Math.max(1.5, (ctx.canvas.width / 320) * weight);
  ctx.strokeStyle = COLORS.teal;
  ctx.lineCap = 'round';
  ctx.shadowColor = rgba(COLORS.teal, 0.8);
  ctx.shadowBlur = 8 * strength;
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

  const r = Math.max(2, (ctx.canvas.width / 280) * weight);
  for (const lm of pose) {
    ctx.fillStyle =
      (lm.visibility ?? 0) >= VISIBILITY_THRESHOLD ? '#ffffff' : rgba(COLORS.magenta, 0.5);
    ctx.beginPath();
    ctx.arc(px(lm.x), py(lm.y), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * CRT "old TV" overlay drawn over the game screen rect: fine scanlines that slowly
 * crawl, plus a soft bright hum-bar that rolls down the picture (the vertical-hold
 * drift of an analog set). Purely cosmetic, so it's driven off wall-clock `now`
 * rather than the simulation clock, and clipped to `rect` so it stays inside the
 * game screen. Alphas are kept low so gameplay + text stay readable underneath.
 */
export function drawCrtScanlines(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  now: number = performance.now(),
): void {
  const gap = Math.max(2, Math.round(ctx.canvas.height / 300)); // scanline spacing (device px)
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  // Dark scanlines, drifting slowly downward so the lines visibly "move".
  const drift = (now * 0.018) % gap; // ~18 px/s crawl
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  for (let y = rect.y - gap + drift; y < rect.y + rect.h; y += gap) {
    if (y >= rect.y) ctx.fillRect(rect.x, y, rect.w, 1);
  }

  // Rolling hum-bar: a soft band of brightness sweeping down the screen on a loop.
  const period = 4200; // ms per full roll
  const bandH = rect.h * 0.2;
  const t = (now % period) / period;
  const top = rect.y - bandH + t * (rect.h + bandH);
  const grad = ctx.createLinearGradient(0, top, 0, top + bandH);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, top, rect.w, bandH);

  ctx.restore();
}

// MediaPipe's 21-keypoint hand topology (wrist + 4 joints per finger).
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20], // pinky + palm
];

/** Draw a hand's 21 landmarks + bones into the mirrored selfie rect (Phase 6). */
export function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: Point[],
  rect: Rect,
  color: string = COLORS.teal,
): void {
  const px = (nx: number): number => rect.x + (1 - nx) * rect.w; // mirror x (selfie)
  const py = (ny: number): number => rect.y + ny * rect.h;

  ctx.save();
  ctx.lineWidth = Math.max(2, ctx.canvas.width / 360);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  for (const [a, b] of HAND_CONNECTIONS) {
    const p = hand[a];
    const q = hand[b];
    if (!p || !q) continue;
    ctx.beginPath();
    ctx.moveTo(px(p.x), py(p.y));
    ctx.lineTo(px(q.x), py(q.y));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  const r = Math.max(2.5, ctx.canvas.width / 320);
  for (const lm of hand) {
    ctx.beginPath();
    ctx.arc(px(lm.x), py(lm.y), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
