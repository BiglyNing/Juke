/**
 * Hole-in-the-Wall — the flagship game (Phase 4).
 *
 * Flow: calibrate → (approach → result)* → over.
 *
 * Calibration measures the player (position, size, which limbs are visible) into
 * a BodyProfile; every wall's pose-shaped hole is then generated *from that
 * profile*, so the holes are always the player's size/position and skip the legs
 * if the player can't fit them in frame. A wall rushes you (scales up for fake
 * depth); at the crossing window your eroded silhouette is judged against the
 * wall's SOLID region with maskOverlap (best ratio over the window vs TOL). Fit →
 * score++ and the next wall; don't fit → squashed, game over.
 *
 * Coordinates: the hole is built and judged in raw camera space (same as the
 * silhouette mask), and rendered mirrored to match the selfie-view silhouette.
 */

import { register, type JukeGame, type Need, type Intensity } from '../engine/game';
import { type PerceptionFrame, maskGrid } from '../engine/frame';
import { binarize, erode, maskOverlap, type BinaryMask } from '../engine/mask';
import { limbsFramed } from '../engine/pose';
import { Calibrator, canCalibrate, type BodyProfile } from '../engine/calibration';
import { holeFromProfile, pickVariation, rasterizeSolid, type Hole, type Variation } from './wall';
import {
  perceptionRect,
  drawCameraFeed,
  drawSilhouetteMask,
  drawPoseSkeleton,
} from '../render/perception';
import type { Rect } from '../render/canvas';
import { debugParams, isDebugOn } from '../shell/debug';

const RESULT_MS = 950; // how long the PASS/SQUASHED verdict lingers
const FAR_SCALE = 0.32; // how small the wall starts (fake depth)
const MIN_PLAYER_AREA = 0.012; // fraction of cells that must be "you" to count

type Phase = 'calibrate' | 'approach' | 'result' | 'over';

// Reused offscreen canvas for punching the pose hole out of the wall panel.
const wallCanvas = document.createElement('canvas');
const wallCtx = wallCanvas.getContext('2d')!;

class HoleInWall implements JukeGame {
  readonly id = 'holeInWall';
  readonly title = 'Hole in the Wall';
  readonly needs: Need[] = ['pose'];
  readonly intensity: Intensity = 'standing';

  private phase: Phase = 'calibrate';
  private calibrator = new Calibrator();
  private profile: BodyProfile | null = null;

  private variation: Variation | null = null;
  private hole: Hole | null = null;
  private z = 0; // approach progress 0..1
  private minRatio = Infinity; // best fit seen during the window
  private liveRatio = 1; // most recent fit, for live outline color
  private judged = false;
  private lastPass = false;
  private resultTimer = 0;
  private scoreValue = 0;

  // Cached wall-solid rasterization (fixed per wall, so rasterize once).
  private solid: BinaryMask | null = null;
  private solidW = 0;
  private solidH = 0;
  private solidHole: Hole | null = null;

  init(): void {
    /* engine calls reset() before init; nothing else to allocate */
  }

  reset(): void {
    this.phase = 'calibrate';
    this.calibrator.reset();
    this.profile = null;
    this.hole = null;
    this.variation = null;
    this.z = 0;
    this.minRatio = Infinity;
    this.liveRatio = 1;
    this.judged = false;
    this.lastPass = false;
    this.resultTimer = 0;
    this.scoreValue = 0;
  }

  /** Throw away the body profile and recalibrate (the player moved / resized). */
  recalibrate(): void {
    this.phase = 'calibrate';
    this.calibrator.reset();
    this.profile = null;
    this.hole = null;
  }

  update(frame: PerceptionFrame, dt: number): void {
    if (this.phase === 'over') return;

    if (this.phase === 'calibrate') {
      const profile = this.calibrator.add(frame.pose);
      if (profile) {
        this.profile = profile;
        this.startWall(null);
      }
      return;
    }

    if (this.phase === 'result') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        if (this.lastPass) this.startWall(this.variation);
        else this.phase = 'over';
      }
      return;
    }

    // approach
    this.z = Math.min(1, this.z + dt / (debugParams.wallSecs * 1000));
    const ratio = this.judge(frame);
    if (ratio !== null) {
      this.liveRatio = ratio;
      if (this.z >= debugParams.windowStart) {
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

  /** Generate the next wall from the calibrated profile, avoiding a repeat pose. */
  private startWall(avoid: Variation | null): void {
    const p = this.profile;
    if (!p) return;
    this.variation = pickVariation(p, Math.random, avoid ?? undefined);
    this.hole = holeFromProfile(p, this.variation);
    this.z = 0;
    this.minRatio = Infinity;
    this.liveRatio = 1;
    this.judged = false;
    this.phase = 'approach';
  }

  /** Overlap ratio of the eroded player silhouette against the wall's solid region. */
  private judge(frame: PerceptionFrame): number | null {
    const hole = this.hole;
    const grid = maskGrid(frame);
    if (!hole || !grid) return null;
    const player = erode(binarize(grid, 0.5), debugParams.erodePx);
    let area = 0;
    for (let i = 0; i < player.data.length; i++) area += player.data[i];
    if (area < MIN_PLAYER_AREA * player.data.length) return 1; // nobody in frame -> can't pass
    return maskOverlap(player, this.wallSolid(hole, grid.width, grid.height)).ratio;
  }

  private wallSolid(hole: Hole, w: number, h: number): BinaryMask {
    if (!this.solid || this.solidW !== w || this.solidH !== h || this.solidHole !== hole) {
      this.solid = rasterizeSolid(hole, w, h);
      this.solidW = w;
      this.solidH = h;
      this.solidHole = hole;
    }
    return this.solid;
  }

  render(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const rect = perceptionRect(ctx, frame);
    if (frame.video) drawCameraFeed(ctx, frame.video, rect);

    if (this.phase === 'calibrate') {
      if (frame.silhouetteMask) {
        drawSilhouetteMask(ctx, frame.silhouetteMask, frame.maskW, frame.maskH, rect, 0.5);
      }
      if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect);
      this.drawCalibration(ctx, frame);
      return;
    }

    this.drawWall(ctx, rect);
    if (frame.silhouetteMask) {
      drawSilhouetteMask(ctx, frame.silhouetteMask, frame.maskW, frame.maskH, rect, 0.6);
    }
    if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect);
    this.drawFraming(ctx, frame);
    this.drawHud(ctx);
  }

  score(): number {
    return this.scoreValue;
  }

  isOver(): boolean {
    return this.phase === 'over';
  }

  // --- rendering -----------------------------------------------------------

  private drawCalibration(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const ready = canCalibrate(frame.pose);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = `bold ${Math.round(cw / 26)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(0, 230, 255, 0.95)';
    ctx.fillText('CALIBRATING', cw / 2, ch * 0.46);

    ctx.font = `${Math.round(cw / 56)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(232, 236, 244, 0.9)';
    ctx.fillText(
      ready
        ? 'Hold still — learning your shape and size'
        : 'Get your shoulders and hips in frame, facing the camera',
      cw / 2,
      ch * 0.53,
    );

    // progress bar
    const w = cw * 0.36;
    const h = Math.max(6, ch * 0.012);
    const x = (cw - w) / 2;
    const y = ch * 0.58;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0, 230, 255, 0.9)';
    ctx.fillRect(x, y, w * this.calibrator.progress, h);
    ctx.restore();
  }

  /** Corner framing gate: are the limbs this body uses in frame? */
  private drawFraming(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    if (this.phase === 'over') return;
    const needLegs = this.profile?.hasLegs ?? true;
    const f = frame.pose ? limbsFramed(frame.pose) : null;
    const ok = f ? (needLegs ? f.allVisible : f.wristL && f.wristR) : false;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `${Math.round(ctx.canvas.width / 64)}px ui-monospace, monospace`;
    ctx.fillStyle = ok ? 'rgba(74, 240, 160, 0.85)' : 'rgba(255, 190, 70, 0.95)';
    ctx.fillText(
      ok ? '✓ in position' : needLegs ? 'show both hands & both feet' : 'show both hands',
      ctx.canvas.width / 2,
      ctx.canvas.height - Math.round(ctx.canvas.height / 40),
    );
    ctx.restore();
  }

  private scaledRect(rect: Rect): Rect {
    const ease = this.z * this.z; // accelerate toward the player
    const scale = FAR_SCALE + (1 - FAR_SCALE) * ease;
    const w = rect.w * scale;
    const h = rect.h * scale;
    return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
  }

  private drawWall(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const hole = this.hole;
    if (!hole) return;
    const sr = this.scaledRect(rect);
    const inWindow = this.z >= debugParams.windowStart || this.phase === 'result';

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
    this.traceHole(wallCtx, hole, sr, true);
    wallCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(wallCanvas, 0, 0);

    // Neon "target pose" stick-figure hint inside the hole; colored by live fit.
    const color = !inWindow
      ? 'rgba(0, 230, 255, 0.9)'
      : this.liveRatio <= debugParams.tol
        ? 'rgba(74, 240, 160, 0.95)'
        : 'rgba(255, 46, 136, 0.95)';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, sr.w / 130);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    this.traceHole(ctx, hole, sr, false);
    ctx.restore();
  }

  /** Trace the hole into a context — mirrored (selfie), filled (punch) or stroked (hint). */
  private traceHole(c: CanvasRenderingContext2D, hole: Hole, sr: Rect, fill: boolean): void {
    const X = (nx: number): number => sr.x + (1 - nx) * sr.w; // mirror x to match the silhouette
    const Y = (ny: number): number => sr.y + ny * sr.h;
    const R = (r: number): number => r * sr.w;
    for (const s of hole.shapes) {
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

    ctx.textBaseline = 'top';
    ctx.font = `${Math.round(cw / 36)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(232, 236, 244, 0.95)';
    ctx.fillText(`MATCH:  ${this.variation?.name ?? ''}`, cw / 2, Math.round(ch / 28));
    ctx.font = `${Math.round(cw / 52)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(155, 236, 255, 0.9)';
    ctx.fillText(`Score ${this.scoreValue}`, cw / 2, Math.round(ch / 28) + Math.round(cw / 30));

    if (isDebugOn()) {
      const min = this.minRatio === Infinity ? 0 : this.minRatio;
      ctx.font = `${Math.round(cw / 64)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(232, 236, 244, 0.8)';
      ctx.fillText(
        `overlap ${this.liveRatio.toFixed(3)}  ·  best ${min.toFixed(3)}  ·  TOL ${debugParams.tol.toFixed(3)}`,
        cw / 2,
        Math.round(ch / 28) + Math.round(cw / 16),
      );
    }

    if (this.phase === 'result') {
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(cw / 16)}px ui-monospace, monospace`;
      ctx.fillStyle = this.lastPass ? 'rgba(74, 240, 160, 0.95)' : 'rgba(255, 46, 136, 0.95)';
      ctx.fillText(this.lastPass ? 'PASS ✓' : 'SQUASHED ✕', cw / 2, ch / 2);
    }

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

// Minimal lifecycle keys until the Phase 5 shell owns it: Enter restarts a dead
// run; C recalibrates at any time (if you moved or changed distance).
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Enter' && game.isOver()) game.reset();
  else if (e.key.toLowerCase() === 'c') game.recalibrate();
});
