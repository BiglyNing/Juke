/**
 * Throwaway "perception test" game (Phase 3 exit criterion).
 *
 * It does nothing clever — it just proves the contract end to end: it implements
 * {@link JukeGame}, is registered, and runs through the engine loop fed by either
 * a live camera or a replayed fixture. It draws exactly what a real game sees —
 * the faded video, the silhouette, and the skeleton — plus the live `dt`, so the
 * contract is visible on screen. Hole-in-the-Wall (Phase 4) is the real game;
 * this can be deleted once that's done.
 */

import { register, type JukeGame, type Need, type Intensity } from '../engine/game';
import type { PerceptionFrame } from '../engine/frame';
import {
  perceptionRect,
  drawCameraFeed,
  drawSilhouetteMask,
  drawPoseSkeleton,
} from '../render/perception';

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
    const rect = perceptionRect(ctx, frame);
    if (frame.video) drawCameraFeed(ctx, frame.video, rect);
    if (frame.silhouetteMask) {
      drawSilhouetteMask(ctx, frame.silhouetteMask, frame.maskW, frame.maskH, rect);
    }
    if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect);
    this.drawReadout(ctx, frame);
  }

  score(): number {
    return Math.floor(this.elapsedMs / 1000);
  }

  isOver(): boolean {
    return false; // the test game never ends
  }

  private drawReadout(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const size = Math.max(11, Math.round(ctx.canvas.width / 90));
    ctx.font = `${size}px ui-monospace, monospace`;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(232, 236, 244, 0.85)';
    const src = frame.video ? 'live' : 'replay';
    const pad = Math.round(ctx.canvas.width / 80);
    const line =
      `[${this.title}] ${src} · dt ${frame.dt.toFixed(1)}ms · ` +
      `steps ${this.steps} · ${this.score()}s · pose ${frame.pose ? 'yes' : 'no'}`;
    ctx.fillText(line, pad, ctx.canvas.height - pad);
  }
}

register(new TestGame());
