/**
 * Attract / idle mode (Phase 9) — a looping neon-silhouette "ghost" behind the
 * menu and landing screen, so the very first frame of the live link is already
 * moving. For an online, peer-voted gallery this is load-bearing: a reviewer who
 * won't stand up still sees the perception in motion instead of a dead title card.
 *
 * It replays the *bundled* perception fixture (the same recording the F-key
 * headless replay uses) through the Phase 7 neon-silhouette renderer — so the
 * menu shows a real person's mask drifting and trailing, with no camera, no
 * model, and no active game. The renderer (`drawNeonSilhouette`) had no caller
 * until now; attract mode is its real home.
 */

import type { Fixture } from '../engine/fixture';
import { frameToGrid } from '../engine/fixture';
import { containRect } from '../render/canvas';
import { drawNeonSilhouette, resetSilhouette } from '../render/silhouette';

interface AttractFrame {
  data: Float32Array;
  w: number;
  h: number;
  /** Real ms to hold this frame, clamped from the recorded dt for steady playback. */
  ms: number;
}

export class Attract {
  private frames: AttractFrame[] = [];
  private i = 0;
  private acc = 0;
  private last = -1;

  /** Decode a fixture into playable silhouette frames (call once at startup). */
  load(fixture: Fixture): void {
    this.frames = fixture.frames.map((fr) => {
      const g = frameToGrid(fr);
      return { data: g.data, w: g.width, h: g.height, ms: Math.max(40, Math.min(160, fr.dt)) };
    });
    this.reset();
  }

  /** Restart the loop and clear the afterimage (call when the menu (re)appears). */
  reset(): void {
    this.i = 0;
    this.acc = 0;
    this.last = -1;
    resetSilhouette();
  }

  /** Draw the ghost for wall-clock time `now` (ms). No-op until a fixture loads. */
  draw(ctx: CanvasRenderingContext2D, now: number, alpha = 0.7): void {
    const n = this.frames.length;
    if (n === 0) return;
    if (this.last < 0) this.last = now;
    this.acc += now - this.last;
    this.last = now;

    // Advance by however many recorded frames the elapsed real time covers; the
    // guard caps a backgrounded-tab catch-up to one loop so it can never spin.
    let guard = 0;
    while (this.acc >= this.frames[this.i].ms && guard++ < n) {
      this.acc -= this.frames[this.i].ms;
      this.i = (this.i + 1) % n;
      if (this.i === 0) resetSilhouette(); // clear the trail across the loop seam
    }

    const f = this.frames[this.i];
    const rect = containRect(f.w, f.h, ctx.canvas.width, ctx.canvas.height);
    drawNeonSilhouette(ctx, f.data, f.w, f.h, rect, { alpha });
  }
}
