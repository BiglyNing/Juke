/**
 * Throwaway "perception test" game (Phase 3 exit criterion).
 *
 * It does nothing clever — it just proves the contract end to end: it implements
 * {@link JukeGame}, is registered, and runs through the engine loop fed by either
 * a live camera or a replayed fixture. It draws exactly what a real game sees —
 * the faded video, the downsampled collision mask, and the pose skeleton — plus
 * the live `dt`, so the contract is visible on screen. Delete it once a real game
 * exists; the polished silhouette is Phase 7's job, not this file's.
 */

import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { register, type JukeGame, type Need, type Intensity } from '../engine/game';
import type { PerceptionFrame } from '../engine/frame';
import type { Point } from '../engine/pose';
import { containRect, drawMirrored, type Rect } from '../render/canvas';

// Reused offscreen canvas for the upscaled mask overlay.
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d')!;

const VISIBILITY_THRESHOLD = 0.5;

class TestGame implements JukeGame {
  readonly id = 'test';
  readonly title = 'Perception Test';
  readonly needs: Need[] = ['pose'];
  readonly intensity: Intensity = 'standing';

  private elapsedMs = 0;
  private steps = 0;

  init(): void {
    /* nothing to allocate */
  }

  reset(): void {
    this.elapsedMs = 0;
    this.steps = 0;
  }

  update(_frame: PerceptionFrame, dt: number): void {
    this.elapsedMs += dt;
    this.steps++;
  }

  render(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    // Source aspect: the live video, or the mask grid during fixture replay.
    const srcW = frame.video?.videoWidth || frame.maskW || cw;
    const srcH = frame.video?.videoHeight || frame.maskH || ch;
    const rect = containRect(srcW, srcH, cw, ch);

    if (frame.video) {
      ctx.globalAlpha = 0.85;
      drawMirrored(ctx, frame.video, rect);
      ctx.globalAlpha = 1;
    }

    if (frame.silhouetteMask) {
      this.drawMask(ctx, frame.silhouetteMask, frame.maskW, frame.maskH, rect);
    }
    if (frame.pose) {
      this.drawSkeleton(ctx, frame.pose, rect);
    }

    this.drawReadout(ctx, frame);
  }

  score(): number {
    return Math.floor(this.elapsedMs / 1000);
  }

  isOver(): boolean {
    return false; // the test game never ends
  }

  // --- rendering helpers ---------------------------------------------------

  private drawMask(
    ctx: CanvasRenderingContext2D,
    data: Float32Array,
    w: number,
    h: number,
    rect: Rect,
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
    ctx.globalAlpha = 0.45;
    drawMirrored(ctx, maskCanvas, rect); // imageSmoothing on -> soft blob, not hard blocks
    ctx.globalAlpha = 1;
  }

  private drawSkeleton(ctx: CanvasRenderingContext2D, pose: Point[], rect: Rect): void {
    const px = (nx: number): number => rect.x + (1 - nx) * rect.w; // mirror x
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

  private drawReadout(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const size = Math.max(11, Math.round(ctx.canvas.width / 90));
    ctx.font = `${size}px ui-monospace, monospace`;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(232, 236, 244, 0.85)';
    const src = frame.video ? 'live' : 'replay';
    const line =
      `[${this.title}] ${src} · dt ${frame.dt.toFixed(1)}ms · ` +
      `steps ${this.steps} · ${this.score()}s · pose ${frame.pose ? 'yes' : 'no'}`;
    ctx.fillText(line, Math.round(ctx.canvas.width / 80), ctx.canvas.height - Math.round(ctx.canvas.width / 80));
  }
}

register(new TestGame());
