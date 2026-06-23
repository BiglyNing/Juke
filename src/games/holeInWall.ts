/**
 * Hole-in-the-Wall — the flagship game (Phase 4, refactored to the Phase 5 shell
 * contract).
 *
 * The shell now owns the lifecycle: it runs calibration, hands the game a
 * {@link CalibrationResult} via `configure`, then counts down and starts play.
 * This file is just the wall loop: (approach → result)* → dead.
 *
 *   waiting  — armed but not started; renders the live silhouette preview the
 *              shell shows behind its calibration + countdown screens.
 *   approach — a wall rushes you (scales up for fake depth).
 *   result   — PASS/SQUASHED verdict lingers, then the next wall or death.
 *   dead     — run over; the shell reads `isOver()` and shows GAME OVER.
 *
 * Every wall's pose-shaped hole is generated from the calibrated BodyProfile, so
 * holes are always the player's size/position and skip the legs if the player
 * can't fit them in frame. At the crossing window the eroded silhouette is judged
 * against the wall's SOLID region with maskOverlap (best ratio over the window vs
 * TOL). Judged + rendered in raw camera space, mirrored to match the selfie view.
 */

import { register, type JukeGame, type Need, type Intensity, type CalibrationResult } from '../engine/game';
import { type PerceptionFrame, maskGrid } from '../engine/frame';
import { binarize, erode, maskOverlap, type BinaryMask } from '../engine/mask';
import { limbsFramed } from '../engine/pose';
import { type BodyProfile } from '../engine/calibration';
import { holeFromProfile, pickVariation, rasterizeSolid, type Hole, type Variation } from './wall';
import {
  perceptionRect,
  drawCameraFeed,
  drawSilhouetteMask,
  drawPoseSkeleton,
} from '../render/perception';
import type { Rect } from '../render/canvas';
import { debugParams, isDebugOn } from '../shell/debug';
import { COLORS, FONT, rgba } from '../shell/theme';

const RESULT_MS = 950; // how long the PASS/SQUASHED verdict lingers
const FAR_SCALE = 0.32; // how small the wall starts (fake depth)
const MIN_PLAYER_AREA = 0.012; // fraction of cells that must be "you" to count

type Phase = 'waiting' | 'approach' | 'result' | 'dead';

// Reused offscreen canvas for punching the pose hole out of the wall panel.
const wallCanvas = document.createElement('canvas');
const wallCtx = wallCanvas.getContext('2d')!;

class HoleInWall implements JukeGame {
  readonly id = 'holeInWall';
  readonly title = 'Hole in the Wall';
  readonly needs: Need[] = ['pose'];
  readonly intensity: Intensity = 'standing';

  private phase: Phase = 'waiting';
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
    this.phase = 'waiting';
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

  /** Receive the shell's calibration profile and start the first wall. */
  configure(result: CalibrationResult): void {
    this.profile = result.profile;
    if (this.profile) this.startWall(null);
    else this.phase = 'dead'; // a standing game can't run without a body profile
  }

  update(frame: PerceptionFrame, dt: number): void {
    if (this.phase === 'waiting' || this.phase === 'dead') return;

    if (this.phase === 'result') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        if (this.lastPass) this.startWall(this.variation);
        else this.phase = 'dead';
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

    // `waiting` = the live preview the shell shows behind calibration/countdown.
    if (this.phase === 'waiting') {
      if (frame.silhouetteMask) {
        drawSilhouetteMask(ctx, frame.silhouetteMask, frame.maskW, frame.maskH, rect, 0.5);
      }
      if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect);
      return;
    }

    this.drawWall(ctx, rect);
    if (frame.silhouetteMask) {
      drawSilhouetteMask(ctx, frame.silhouetteMask, frame.maskW, frame.maskH, rect, 0.6);
    }
    if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect);
    this.drawFraming(ctx, frame);
    this.drawGameplayText(ctx);
  }

  score(): number {
    return this.scoreValue;
  }

  isOver(): boolean {
    return this.phase === 'dead';
  }

  // --- rendering -----------------------------------------------------------

  /** Corner framing gate: are the limbs this body uses in frame? */
  private drawFraming(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const needLegs = this.profile?.hasLegs ?? true;
    const f = frame.pose ? limbsFramed(frame.pose) : null;
    const ok = f ? (needLegs ? f.allVisible : f.wristL && f.wristR) : false;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `${Math.round(ctx.canvas.width / 64)}px ${FONT.mono}`;
    ctx.fillStyle = ok ? rgba(COLORS.ok, 0.85) : rgba(COLORS.warn, 0.95);
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
    wallCtx.fillStyle = rgba(COLORS.surface, panelAlpha);
    wallCtx.fillRect(sr.x, sr.y, sr.w, sr.h);
    wallCtx.globalCompositeOperation = 'destination-out';
    wallCtx.fillStyle = '#000'; // opaque -> fully clears the hole
    wallCtx.strokeStyle = '#000';
    this.traceHole(wallCtx, hole, sr, true);
    wallCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(wallCanvas, 0, 0);

    // Neon "target pose" stick-figure hint inside the hole; colored by live fit.
    const color = !inWindow
      ? rgba(COLORS.teal, 0.9)
      : this.liveRatio <= debugParams.tol
        ? rgba(COLORS.ok, 0.95)
        : rgba(COLORS.danger, 0.95);
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

  /** In-canvas gameplay text: the target pose name, the verdict flash, debug overlap. */
  private drawGameplayText(ctx: CanvasRenderingContext2D): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.save();
    ctx.textAlign = 'center';

    ctx.textBaseline = 'top';
    ctx.font = `${Math.round(cw / 44)}px ${FONT.mono}`;
    ctx.fillStyle = rgba(COLORS.text, 0.95);
    ctx.fillText(`MATCH:  ${this.variation?.name ?? ''}`, cw / 2, Math.round(ch * 0.12));

    if (isDebugOn()) {
      const min = this.minRatio === Infinity ? 0 : this.minRatio;
      ctx.font = `${Math.round(cw / 64)}px ${FONT.mono}`;
      ctx.fillStyle = rgba(COLORS.text, 0.8);
      ctx.fillText(
        `overlap ${this.liveRatio.toFixed(3)}  ·  best ${min.toFixed(3)}  ·  TOL ${debugParams.tol.toFixed(3)}`,
        cw / 2,
        Math.round(ch * 0.12) + Math.round(cw / 30),
      );
    }

    if (this.phase === 'result') {
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(cw / 16)}px ${FONT.display}`;
      ctx.fillStyle = this.lastPass ? rgba(COLORS.ok, 0.95) : rgba(COLORS.danger, 0.95);
      ctx.fillText(this.lastPass ? 'PASS ✓' : 'SQUASHED ✕', cw / 2, ch / 2);
    }
    ctx.restore();
  }
}

register(new HoleInWall());
