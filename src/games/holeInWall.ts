/**
 * Hole-in-the-Wall — the flagship game (Phase 4).
 *
 * 4.1 wall model + render · 4.2 approach animation · 4.3 fit judging · 4.4 loop.
 *
 * A wall with a pose-shaped hole rushes you (scales up for fake depth). As it
 * reaches the player plane (the "crossing window"), the player's eroded silhouette
 * is judged against the wall's SOLID region with maskOverlap: the best (lowest)
 * overlap ratio over the window is compared to the leniency TOL. Fit → score++ and
 * the next wall; don't fit → squashed, game over. Defaults are tuned in 4.5.
 */

import { register, type JukeGame, type Need, type Intensity } from '../engine/game';
import { type PerceptionFrame, maskGrid } from '../engine/frame';
import { binarize, erode, maskOverlap } from '../engine/mask';
import { rasterizeSolid, pickPose, type Hole } from './wall';
import {
  perceptionRect,
  drawCameraFeed,
  drawSilhouetteMask,
  drawPoseSkeleton,
} from '../render/perception';
import type { Rect } from '../render/canvas';
import { debugParams } from '../shell/debug';

const APPROACH_MS = 4500; // far -> player plane
const WINDOW_START = 0.86; // z at which the crossing/judging window opens
const RESULT_MS = 950; // how long the PASS/SQUASHED verdict lingers
const FAR_SCALE = 0.32; // how small the wall starts (fake depth)
const MIN_PLAYER_AREA = 0.012; // fraction of cells that must be "you" to count

type Phase = 'approach' | 'result' | 'over';

// Reused offscreen canvas for punching the pose hole out of the wall panel.
const wallCanvas = document.createElement('canvas');
const wallCtx = wallCanvas.getContext('2d')!;

class HoleInWall implements JukeGame {
  readonly id = 'holeInWall';
  readonly title = 'Hole in the Wall';
  readonly needs: Need[] = ['pose'];
  readonly intensity: Intensity = 'standing';

  private phase: Phase = 'approach';
  private hole: Hole = pickPose();
  private z = 0; // approach progress 0..1
  private minRatio = Infinity; // best fit seen during the window
  private liveRatio = 1; // most recent fit, for live outline color
  private judged = false;
  private lastPass = false;
  private resultTimer = 0;
  private scoreValue = 0;

  init(): void {
    /* engine calls reset() before init; nothing else to allocate */
  }

  reset(): void {
    this.phase = 'approach';
    this.hole = pickPose();
    this.z = 0;
    this.minRatio = Infinity;
    this.liveRatio = 1;
    this.judged = false;
    this.lastPass = false;
    this.resultTimer = 0;
    this.scoreValue = 0;
  }

  update(frame: PerceptionFrame, dt: number): void {
    if (this.phase === 'over') return;

    if (this.phase === 'result') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        if (this.lastPass) this.nextWall();
        else this.phase = 'over';
      }
      return;
    }

    // approach
    this.z = Math.min(1, this.z + dt / APPROACH_MS);
    if (this.z >= WINDOW_START) {
      const ratio = this.judge(frame);
      if (ratio !== null) {
        this.liveRatio = ratio;
        this.minRatio = Math.min(this.minRatio, ratio);
        this.judged = true;
      }
    }
    if (this.z >= 1) {
      this.lastPass = this.judged && this.minRatio <= debugParams.tol;
      if (this.lastPass) this.scoreValue++;
      this.phase = 'result';
      this.resultTimer = RESULT_MS;
    }
  }

  /** Overlap ratio of the eroded player silhouette against the wall's solid region. */
  private judge(frame: PerceptionFrame): number | null {
    const grid = maskGrid(frame);
    if (!grid) return null;
    const player = erode(binarize(grid, 0.5), debugParams.erodePx);
    let area = 0;
    for (let i = 0; i < player.data.length; i++) area += player.data[i];
    if (area < MIN_PLAYER_AREA * player.data.length) return 1; // nobody in frame -> can't pass
    const solid = rasterizeSolid(this.hole, grid.width, grid.height);
    return maskOverlap(player, solid).ratio;
  }

  private nextWall(): void {
    const prev = this.hole;
    this.hole = pickPose(Math.random, prev);
    this.z = 0;
    this.minRatio = Infinity;
    this.liveRatio = 1;
    this.judged = false;
    this.phase = 'approach';
  }

  render(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const rect = perceptionRect(ctx, frame);
    if (frame.video) drawCameraFeed(ctx, frame.video, rect);
    this.drawWall(ctx, rect);
    if (frame.silhouetteMask) {
      drawSilhouetteMask(ctx, frame.silhouetteMask, frame.maskW, frame.maskH, rect, 0.6);
    }
    if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect);
    this.drawHud(ctx);
  }

  score(): number {
    return this.scoreValue;
  }

  isOver(): boolean {
    return this.phase === 'over';
  }

  // --- rendering -----------------------------------------------------------

  private scaledRect(rect: Rect): Rect {
    const ease = this.z * this.z; // accelerate toward the player
    const scale = FAR_SCALE + (1 - FAR_SCALE) * ease;
    const w = rect.w * scale;
    const h = rect.h * scale;
    return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
  }

  private drawWall(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const sr = this.scaledRect(rect);
    const inWindow = this.z >= WINDOW_START || this.phase === 'result';

    // Punch the pose hole out of the panel on an offscreen canvas, then composite.
    if (wallCanvas.width !== ctx.canvas.width || wallCanvas.height !== ctx.canvas.height) {
      wallCanvas.width = ctx.canvas.width;
      wallCanvas.height = ctx.canvas.height;
    }
    wallCtx.clearRect(0, 0, wallCanvas.width, wallCanvas.height);
    const panelAlpha = 0.4 + 0.5 * (this.z * this.z);
    wallCtx.fillStyle = `rgba(18, 22, 42, ${panelAlpha})`;
    wallCtx.fillRect(sr.x, sr.y, sr.w, sr.h);
    wallCtx.globalCompositeOperation = 'destination-out';
    wallCtx.fillStyle = '#000'; // opaque -> fully clears the hole
    wallCtx.strokeStyle = '#000';
    this.traceHole(wallCtx, sr, true);
    wallCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(wallCanvas, 0, 0);

    // Neon "target pose" stick-figure hint inside the hole; colored by live fit.
    const color = !inWindow
      ? 'rgba(0, 230, 255, 0.9)'
      : this.liveRatio <= debugParams.tol
        ? 'rgba(74, 240, 160, 0.95)' // fitting -> green
        : 'rgba(255, 46, 136, 0.95)'; // sticking out -> magenta
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, sr.w / 130);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    this.traceHole(ctx, sr, false);
    ctx.restore();
  }

  /** Trace the hole shapes into a context — filled (to punch) or stroked (hint). */
  private traceHole(c: CanvasRenderingContext2D, sr: Rect, fill: boolean): void {
    const X = (nx: number): number => sr.x + nx * sr.w;
    const Y = (ny: number): number => sr.y + ny * sr.h;
    const R = (r: number): number => r * sr.w;
    for (const s of this.hole.shapes) {
      if (s.kind === 'circle') {
        c.beginPath();
        c.arc(X(s.cx), Y(s.cy), R(s.r), 0, Math.PI * 2);
        if (fill) c.fill();
        else c.stroke();
      } else {
        if (fill) {
          c.lineCap = 'round';
          c.lineWidth = 2 * R(s.r);
        }
        c.beginPath();
        c.moveTo(X(s.x0), Y(s.y0));
        c.lineTo(X(s.x1), Y(s.y1));
        c.stroke();
      }
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.save();
    ctx.textAlign = 'center';

    // Target pose + score, top center (top-left is the engine FPS HUD).
    ctx.textBaseline = 'top';
    ctx.font = `${Math.round(cw / 36)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(232, 236, 244, 0.95)';
    ctx.fillText(`MATCH:  ${this.hole.name}`, cw / 2, Math.round(ch / 28));
    ctx.font = `${Math.round(cw / 52)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(155, 236, 255, 0.9)';
    ctx.fillText(`Score ${this.scoreValue}`, cw / 2, Math.round(ch / 28) + Math.round(cw / 30));

    // Verdict flash.
    if (this.phase === 'result') {
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(cw / 16)}px ui-monospace, monospace`;
      ctx.fillStyle = this.lastPass ? 'rgba(74, 240, 160, 0.95)' : 'rgba(255, 46, 136, 0.95)';
      ctx.fillText(this.lastPass ? 'PASS ✓' : 'SQUASHED ✕', cw / 2, ch / 2);
    }

    // Game over.
    if (this.phase === 'over') {
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(cw / 18)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(255, 46, 136, 0.95)';
      ctx.fillText('GAME OVER', cw / 2, ch / 2 - cw / 28);
      ctx.font = `${Math.round(cw / 40)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(232, 236, 244, 0.9)';
      ctx.fillText(`Score ${this.scoreValue}  ·  press Enter to retry`, cw / 2, ch / 2 + cw / 40);
    }
    ctx.restore();
  }
}

const game = new HoleInWall();
register(game);

// Minimal retry until the Phase 5 shell owns lifecycle: Enter restarts a dead run.
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Enter' && game.isOver()) game.reset();
});
