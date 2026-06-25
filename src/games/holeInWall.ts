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
import { limbsFramed, type Point } from '../engine/pose';
import { buildProfile, canCalibrate, type BodyProfile, type Vec } from '../engine/calibration';
import { holeFromProfile, pickVariation, rasterizeSolid, type Hole, type Variation } from './wall';
import { perceptionRect, drawCameraFeed, drawPoseSkeleton, drawCrtScanlines } from '../render/perception';
import type { Rect } from '../render/canvas';
import { juice } from '../juice/juice';
import { audio } from '../juice/audio';
import { debugParams, isDebugOn } from '../shell/debug';
import { COLORS, FONT, rgba } from '../shell/theme';

const RESULT_MS = 950; // how long the PASS/MISS verdict lingers
const FAR_SCALE = 0.32; // how small the wall starts (fake depth)
const MIN_PLAYER_AREA = 0.012; // fraction of cells that must be "you" to count
const START_LIVES = 3; // misses allowed before the run ends (forgiving, not one-shot)
// Extra approach time on early walls so a new player can read the pose; it fades
// out as they pass walls, so the speed ramps *up* with skill, not down.
const RAMP_BONUS_MS = 2200;
// Each wall shrinks the pose hole a touch, so the fit gets tighter over a run.
const SHRINK_PER_WALL = 0.025; // ~2.5% smaller per wall
const MIN_SHRINK = 0.75; // floor so the hole never shrinks below the body itself

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
  /** The per-wall profile: re-measured each wall so the hole tracks the player's size. */
  private profile: BodyProfile | null = null;
  /** The shell's one-time calibration — the proportions baseline we rescale from. */
  private baseProfile: BodyProfile | null = null;
  /** Most recent pose, used to re-measure the player at the start of each new wall. */
  private lastPose: Point[] | null = null;
  /** Horizontal lane (normalized, raw camera space) the current hole is centered on. */
  private laneCenter = 0.5;
  /** Walls generated this run — drives the per-wall hole shrink (difficulty ramp). */
  private wallsSeen = 0;

  private variation: Variation | null = null;
  private hole: Hole | null = null;
  private z = 0; // approach progress 0..1
  private minRatio = Infinity; // best fit seen during the window
  private liveRatio = 1; // most recent fit, for live outline color
  private judged = false;
  private lastPass = false;
  private resultTimer = 0;
  private scoreValue = 0;
  private lives = START_LIVES;
  /** Set at the approach→result transition; render() fires the juice (it has the canvas). */
  private pendingFx: { kind: 'pass' | 'crush'; fatal: boolean; near: boolean } | null = null;

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
    this.baseProfile = null;
    this.lastPose = null;
    this.laneCenter = 0.5;
    this.wallsSeen = 0;
    this.hole = null;
    this.variation = null;
    this.z = 0;
    this.minRatio = Infinity;
    this.liveRatio = 1;
    this.judged = false;
    this.lastPass = false;
    this.resultTimer = 0;
    this.scoreValue = 0;
    this.lives = START_LIVES;
    this.pendingFx = null;
  }

  /** Receive the shell's calibration profile and start the first wall. */
  configure(result: CalibrationResult): void {
    this.baseProfile = result.profile;
    this.profile = result.profile;
    if (this.profile) {
      // The first wall sits where the player calibrated (no forced sidestep yet).
      this.laneCenter = (this.profile.shoulderL.x + this.profile.shoulderR.x) / 2;
      this.startWall(null, false);
    } else this.phase = 'dead'; // a standing game can't run without a body profile
  }

  update(frame: PerceptionFrame, dt: number): void {
    if (this.phase === 'waiting' || this.phase === 'dead') return;

    // Remember the latest pose so the next wall can re-measure the player from it.
    if (frame.pose) this.lastPose = frame.pose;

    if (this.phase === 'result') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        if (!this.lastPass) this.lives--;
        // A miss costs a life but spawns the next wall; you're only out of the
        // run once the lives are gone — so one fumbled pose isn't game over.
        if (this.lives <= 0) this.phase = 'dead';
        else this.startWall(this.variation, true);
      }
      return;
    }

    // approach
    this.z = Math.min(1, this.z + dt / this.wallMs());
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
      // Queue the feedback stack for render() (which owns the canvas coords). A
      // miss is "fatal" when it spends the last life; a pass that only just
      // cleared the tolerance is a "near" miss worth a little shake.
      const near =
        this.lastPass && this.minRatio > debugParams.tol * 0.6 && this.minRatio !== Infinity;
      this.pendingFx = { kind: this.lastPass ? 'pass' : 'crush', fatal: !this.lastPass && this.lives <= 1, near };
      this.phase = 'result';
      this.resultTimer = RESULT_MS;
    }
  }

  /** Fire the pass/crush juice + SFX. Called from render() so it has canvas coords. */
  private fireFx(ctx: CanvasRenderingContext2D): void {
    const fx = this.pendingFx;
    if (!fx) return;
    this.pendingFx = null;
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height * 0.46;
    const unit = ctx.canvas.width;

    if (fx.kind === 'pass') {
      juice.fx.shockwave({ x: cx, y: cy, color: COLORS.ok, maxR: unit * 0.42 });
      juice.fx.flash(COLORS.ok, 0.16, 260);
      juice.particles.burst({
        x: cx, y: cy, count: 46, color: rgba(COLORS.ok, 1), speed: unit / 2600,
        life: 780, size: unit / 360, gravity: unit / 5_000_000, drag: 0.986,
      });
      juice.time.slowmo(0.5, 240);
      audio.whoosh();
      if (fx.near) {
        juice.camera.shake(0.28);
        audio.crack();
      }
    } else {
      juice.fx.flash(COLORS.danger, fx.fatal ? 0.4 : 0.26, fx.fatal ? 460 : 300);
      juice.camera.shake(fx.fatal ? 1 : 0.6);
      juice.time.freeze(fx.fatal ? 240 : 130);
      juice.particles.burst({
        x: cx, y: cy, count: fx.fatal ? 90 : 54, color: rgba(COLORS.danger, 1),
        speed: unit / 1900, life: 900, size: unit / 320, gravity: unit / 1_600_000, drag: 0.982,
      });
      audio.thud();
      audio.crack();
      if (fx.fatal) audio.duck(900);
    }
  }

  /**
   * How long the current wall takes to arrive (ms). Early walls get a bonus that
   * fades as the score climbs, so the pace ramps up with skill. A struggling
   * player (low score) keeps the slower, readable pace instead of being rushed.
   */
  private wallMs(): number {
    const bonus = Math.max(0, RAMP_BONUS_MS - this.scoreValue * 550);
    return debugParams.wallSecs * 1000 + bonus;
  }

  /**
   * Generate the next wall: re-measure the player (so the hole tracks their
   * current distance), pick a non-repeating pose, and place the hole at a fresh
   * horizontal lane (`relane`) so they have to sidestep into it.
   */
  private startWall(avoid: Variation | null, relane: boolean): void {
    this.recalibrate(this.lastPose);
    const p = this.profile;
    if (!p) return;
    this.variation = pickVariation(p, Math.random, avoid ?? undefined);
    this.laneCenter = relane ? this.pickLane() : (p.shoulderL.x + p.shoulderR.x) / 2;
    const placed = this.shrinkProfile(this.placeAtLane(p, this.laneCenter), this.shrinkScale());
    this.hole = holeFromProfile(placed, this.variation);
    this.wallsSeen++;
    this.z = 0;
    this.minRatio = Infinity;
    this.liveRatio = 1;
    this.judged = false;
    this.phase = 'approach';
  }

  /**
   * Re-measure the player at the start of a wall so the hole matches their CURRENT
   * apparent size + height: step back and the next hole shrinks, step in and it
   * grows. Limb reach and which limbs are used stay from the original calibration
   * (just rescaled by the new size), so a transient mid-pose frame can't distort
   * the hole or drop a leg. No-ops if the player isn't cleanly framed — we keep
   * the previous profile rather than snapping to a bad read.
   */
  private recalibrate(pose: Point[] | null): void {
    const base = this.baseProfile;
    if (!base || !pose || !canCalibrate(pose)) return;
    const live = buildProfile(pose);
    if (!live) return;
    const k = live.unit / base.unit; // size change since calibration ≈ distance change
    this.profile = {
      ...live,
      armLen: base.armLen * k,
      legLen: base.legLen * k,
      hasArms: base.hasArms,
      hasLegs: base.hasLegs,
      hasFeet: base.hasFeet,
    };
  }

  /** Hole scale for the current wall: 1 on the first, shrinking each wall to a floor. */
  private shrinkScale(): number {
    return Math.max(MIN_SHRINK, 1 - this.wallsSeen * SHRINK_PER_WALL);
  }

  /**
   * Uniformly shrink the whole silhouette around its body center by `scale` — the
   * anchors pull in toward the center and every radius/limb length scales with
   * them, so the hole stays the same pose but gets tighter to fit through.
   */
  private shrinkProfile(p: BodyProfile, scale: number): BodyProfile {
    if (scale >= 1) return p;
    const cx = (p.shoulderL.x + p.shoulderR.x + p.hipL.x + p.hipR.x) / 4;
    const cy = (p.shoulderL.y + p.shoulderR.y + p.hipL.y + p.hipR.y) / 4;
    const s = (v: Vec): Vec => ({ x: cx + (v.x - cx) * scale, y: cy + (v.y - cy) * scale });
    return {
      ...p,
      head: s(p.head),
      neck: s(p.neck),
      pelvis: s(p.pelvis),
      shoulderL: s(p.shoulderL),
      shoulderR: s(p.shoulderR),
      hipL: s(p.hipL),
      hipR: s(p.hipR),
      headR: p.headR * scale,
      torsoR: p.torsoR * scale,
      limbR: p.limbR * scale,
      armLen: p.armLen * scale,
      legLen: p.legLen * scale,
    };
  }

  /** A copy of `p` translated horizontally so its body center sits at lane `cx`. */
  private placeAtLane(p: BodyProfile, cx: number): BodyProfile {
    const dx = cx - (p.shoulderL.x + p.shoulderR.x) / 2;
    const sx = (v: Vec): Vec => ({ x: v.x + dx, y: v.y });
    return {
      ...p,
      head: sx(p.head),
      neck: sx(p.neck),
      pelvis: sx(p.pelvis),
      shoulderL: sx(p.shoulderL),
      shoulderR: sx(p.shoulderR),
      hipL: sx(p.hipL),
      hipR: sx(p.hipR),
    };
  }

  /** A fresh lane (normalized) for the next wall, far enough from the current one to force a sidestep. */
  private pickLane(): number {
    const lo = 0.35;
    const hi = 0.65;
    const minStep = 0.16;
    let lane = lo + Math.random() * (hi - lo);
    for (let i = 0; i < 16 && Math.abs(lane - this.laneCenter) < minStep; i++) {
      lane = lo + Math.random() * (hi - lo);
    }
    return lane;
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
    // Camera feed + skeleton only — no teal body silhouette.
    if (this.phase === 'waiting') {
      if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect);
      drawCrtScanlines(ctx, rect);
      return;
    }

    this.fireFx(ctx); // pass/crush feedback, queued by update()
    this.drawWall(ctx, rect);
    // No silhouette overlay during play — the live camera feed + pose skeleton
    // show the player against the wall without the teal body fill on top.
    if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect);
    // CRT scanline/roll filter over the whole game scene (under the HUD text).
    drawCrtScanlines(ctx, rect);
    this.drawFraming(ctx, frame);
    this.drawGameplayText(ctx);
  }

  score(): number {
    return this.scoreValue;
  }

  /** Lives as 0..1 — the shell HUD renders this as a crack meter. */
  health(): number {
    return Math.max(0, this.lives) / START_LIVES;
  }

  /** Share-card flavor: the pose on the wall that ended the run. */
  tagline(): string {
    return this.variation ? `Squashed by: ${this.variation.name}` : 'No-show';
  }

  isOver(): boolean {
    return this.phase === 'dead';
  }

  // --- rendering -----------------------------------------------------------

  /** Corner framing gate: are the limbs this body uses in frame? */
  private drawFraming(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const needLegs = this.profile?.hasLegs ?? true;
    const f = frame.pose ? limbsFramed(frame.pose) : null;
    const ok = f ? (needLegs ? f.bodyFramed : f.wristL && f.wristR) : false;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `${Math.round(ctx.canvas.width / 64)}px ${FONT.mono}`;
    ctx.fillStyle = ok ? rgba(COLORS.ok, 0.85) : rgba(COLORS.warn, 0.95);
    ctx.fillText(
      ok ? '✓ in position' : needLegs ? 'show your hands & legs' : 'show both hands',
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
    ctx.fillText(`MATCH:  ${this.variation?.name ?? ''}`, cw / 2, Math.round(ch * 0.1));

    // Lives (hearts) so the player can see the run isn't one-shot.
    ctx.font = `${Math.round(cw / 46)}px ${FONT.mono}`;
    ctx.fillStyle = COLORS.magenta;
    ctx.fillText(
      '♥'.repeat(this.lives) + '♡'.repeat(Math.max(0, START_LIVES - this.lives)),
      cw / 2,
      Math.round(ch * 0.15),
    );

    if (isDebugOn()) {
      const min = this.minRatio === Infinity ? 0 : this.minRatio;
      ctx.font = `${Math.round(cw / 64)}px ${FONT.mono}`;
      ctx.fillStyle = rgba(COLORS.text, 0.8);
      ctx.fillText(
        `overlap ${this.liveRatio.toFixed(3)}  ·  best ${min.toFixed(3)}  ·  TOL ${debugParams.tol.toFixed(3)}`,
        cw / 2,
        Math.round(ch * 0.2),
      );
    }

    if (this.phase === 'result') {
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(cw / 16)}px ${FONT.display}`;
      ctx.fillStyle = this.lastPass ? rgba(COLORS.ok, 0.95) : rgba(COLORS.danger, 0.95);
      ctx.fillText(this.lastPass ? 'PASS ✓' : 'MISS ✕', cw / 2, ch / 2);
    }
    ctx.restore();
  }
}

register(new HoleInWall());
