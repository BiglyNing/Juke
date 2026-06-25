/**
 * Dodge the Objects (Phase 10) — the third game, written entirely to the Phase 3
 * contract and the Phase 5 shell, so it's "a new file + registration" with no
 * engine changes (the exit criterion).
 *
 * Neon objects rain down at you and you weave your body sideways to avoid them.
 * Collision is the same silhouette overlap the other body game uses: each object
 * is a circle checked against the eroded player mask. A solid hit costs a life
 * and shatters the object; a graze rattles the screen; an object that falls past
 * without touching you is a dodge (+1). Out of lives → dead.
 *
 * **Calibrated to the player (so it's dodge-able at any distance).** The standing
 * calibration gives us a {@link BodyProfile}; `configure()` reads the player's
 * apparent size (shoulder width), start position, and *height* (head→hip span)
 * from it. Two kinds of object follow, each with a dodge a standing player can
 * actually do:
 *   1. **Drops** fall from above, aimed at the player's live horizontal center
 *      (tracked from the silhouette centroid) within a band sized to their
 *      shoulders — dodged by **stepping sideways**.
 *   2. **Sweepers** fly horizontally at a calibrated height band, from the head
 *      down to a *duck floor* derived from the player's height — dodged by
 *      **ducking** under them. That floor is the key calibration: a sweeper is
 *      never placed lower than the player can crouch beneath, so it's always
 *      duck-able (the old build swept objects at random heights, impossible to
 *      duck). Object sizes scale with shoulder width, so a close (large) or far
 *      (small) player faces proportional objects.
 *
 * Lifecycle mirrors Hole-in-the-Wall: waiting → play → dead.
 *
 * Collision works in *cell space*: because the collision grid and the render rect
 * share the camera aspect, a grid cell is square in pixels, so a circle of radius
 * `r*gridW` cells is also a true circle on screen — no aspect correction needed.
 */

import { register, type JukeGame, type Need, type Intensity, type CalibrationResult } from '../engine/game';
import { type PerceptionFrame, maskGrid } from '../engine/frame';
import { binarize, erode, circleOverlapRatio, type BinaryMask } from '../engine/mask';
import { perceptionRect, drawCameraFeed, drawPoseSkeleton } from '../render/perception';
import type { Rect } from '../render/canvas';
import { juice } from '../juice/juice';
import { audio } from '../juice/audio';
import { debugParams } from '../shell/debug';
import { COLORS, FONT, rgba } from '../shell/theme';

const START_LIVES = 3;
const FIRST_SPAWN_MS = 800; // grace before the first object after the countdown
const RAMP_MS = 45_000; // time to reach full difficulty
// Spawn cadence: obstacles start sparse and thicken as the run progresses. These are
// the gap (ms) between spawns at the calm start vs. at full difficulty.
const SPAWN_GAP_START = 2100;
const SPAWN_GAP_END = 430;
const MIN_PLAYER_AREA = 0.012; // fraction of cells that must be "you" for collisions to count
const HIT_RATIO = 0.16; // fraction of an object over your body that counts as a strike
const GRAZE_RATIO = 0.05; // near-miss feedback band below a strike
const SPAWN_MARGIN = 0.14; // how far above the top objects start (normalized)
const OFF = 0.3; // past this (normalized) an object has left the field
const DEFAULT_UNIT = 0.18; // fallback shoulder width if calibration is missing
const UNIT_MIN = 0.08; // clamp the apparent size so an odd calibration can't make objects absurd
const UNIT_MAX = 0.34;
const CENTER_EMA = 0.12; // how fast the aimed center tracks the player (low = steady)
const SWEEP_PROB = 0.3; // share of spawns that are horizontal sweepers (vs falling drops)
// The duck floor: how far below the head a sweeper may sit, as a fraction of the
// head→hip span, clamped so it's always a crouch a standing player can manage.
const DUCK_FRACTION = 0.45;
const DUCK_RANGE_MIN = 0.06;
const DUCK_RANGE_MAX = 0.2;
const DEFAULT_SWEEP_TOP = 0.16; // fallback head height (normalized)
const DEFAULT_SWEEP_BOT = 0.32; // fallback duck floor
const DEFAULT_BODY_MID = 0.5; // fallback torso height a drop's aim curves toward
// Drops never spawn straight above the head: they start at least this many
// shoulder-widths to one side, so a falling object is always read coming in from an
// angle (its trajectory may still curve back onto the body).
const HEAD_CLEAR = 0.7;
// Telegraph: every object flashes a warning (edge marker + incoming lane) for
// this long *before* it actually enters, so the hit is always readable, never a
// surprise. The lead time shrinks as difficulty ramps — still a fair beat.
const WARN_MAX_MS = 900;
const WARN_MIN_MS = 520;
// Posture rule: the player has to keep *standing*. Their head must stay above a
// "stand line" — the bottom of the calibrated sweeper (sideways-dodge) zone. They
// may dip below it to duck under a sweeper, but if the head stays below it for
// longer than this grace window it costs a life: no camping in a crouch.
const STAND_GRACE_MS = 3000;
// Side-bounds rule: the player has to stay inside the frame horizontally. If their
// silhouette clips a side edge ("sticking out of bounds") they get an immediate
// warning, and after a short grace they bleed a life every SIDE_DRAIN_MS until they
// step back in — a fast punishment, not a slow one.
const EDGE_BAND_FRAC = 0.025; // width of each side sample band, as a fraction of the grid
const SIDE_OUT_DENSITY = 0.3; // edge-band fill (0..1) that counts as a body clipping the bound
const SIDE_GRACE_MS = 1300; // warning shown this long before the bleed starts
const SIDE_DRAIN_MS = 550; // lose a life this often while still out (quick)
// Combo reward: bank this much "heal progress" to earn a life back (capped at
// START_LIVES). Each clean dodge adds at least 1, and that gain grows by 1 every
// HEAL_TIER combo (capped at HEAL_MAX_GAIN) so a long streak heals faster — but the
// cap keeps it from getting extreme. A hit/penalty resets the streak, so HP only
// trickles back to a clean run — never faster than the player can stay untouched.
const COMBO_HEAL = 8;
const HEAL_TIER = 10; // every this many combo, +1 heal-progress per dodge
const HEAL_MAX_GAIN = 3; // cap on per-dodge heal-progress (keeps the scaling tame)
const HEAD_LM = 0; // MediaPipe nose landmark
const HEAD_RISE = 0.2; // head sits this many shoulder-widths above the nose (matches calibration)
const HEAD_VIS = 0.5; // nose must be at least this visible to judge posture

type Phase = 'waiting' | 'play' | 'dead';

interface ObjType {
  name: string;
  /** Visual radius as a multiple of the player's shoulder width. */
  rMul: number;
  /** Collision radius multiple (slightly under the visual — forgiving). */
  crMul: number;
  /** Speed multiplier over the current base fall speed. */
  speedMul: number;
  /** Trail length (normalized) behind the head. */
  trail: number;
  color: string;
}

const TYPES: ObjType[] = [
  { name: 'orb', rMul: 0.5, crMul: 0.4, speedMul: 1.0, trail: 0.1, color: COLORS.teal },
  { name: 'bolt', rMul: 0.32, crMul: 0.26, speedMul: 1.6, trail: 0.18, color: COLORS.sunset },
  { name: 'slab', rMul: 0.78, crMul: 0.64, speedMul: 0.62, trail: 0.06, color: COLORS.magenta },
];
// Spawn weights (parallel to TYPES): orbs common, slabs rarer.
const TYPE_WEIGHTS = [0.5, 0.3, 0.2];

interface Obj {
  type: ObjType;
  x: number; // normalized center (raw camera space; render mirrors for selfie)
  y: number;
  vx: number; // normalized units per ms
  vy: number;
  r: number; // absolute visual radius (normalized), sized to the player
  cr: number; // absolute collision radius (normalized)
  grazed: boolean;
  hit: boolean;
}

/** A spawned-but-not-yet-live object, showing its warning before it enters play. */
interface Pending {
  obj: Obj;
  timer: number; // ms of warning left
  max: number; // full warning duration (drives the pulse)
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

class Dodge implements JukeGame {
  readonly id = 'dodge';
  readonly title = 'Dodge';
  readonly needs: Need[] = ['pose'];
  readonly intensity: Intensity = 'standing';

  private phase: Phase = 'waiting';
  private objects: Obj[] = [];
  /** Objects in their warning window — telegraphed but not yet collidable. */
  private pending: Pending[] = [];
  private scoreValue = 0;
  private lives = START_LIVES;
  /** Consecutive clean dodges (no hit/penalty); shown as the combo and drives healing. */
  private combo = 0;
  /** Dodges banked toward the next earned life; fills to COMBO_HEAL then restores 1 HP. */
  private healProgress = 0;
  private elapsed = 0; // play time while the player is framed (drives difficulty)
  private spawnTimer = FIRST_SPAWN_MS;
  private lastHitType = '';
  /** Calibrated apparent size (shoulder width) — scales objects + the spawn band. */
  private unit = DEFAULT_UNIT;
  /** Live estimate of the player's horizontal center; drops are aimed here. */
  private centerX = 0.5;
  /** Calibrated sweeper height band: head height down to the duck floor. */
  private sweepTopY = DEFAULT_SWEEP_TOP;
  private sweepBotY = DEFAULT_SWEEP_BOT;
  /** Calibrated torso height — the vertical point an aimed drop curves toward. */
  private bodyMidY = DEFAULT_BODY_MID;
  /** The "stand line": the head must stay above this Y (= bottom of the sweeper zone). */
  private standLineY = DEFAULT_SWEEP_BOT;
  /** How long the head has been below the stand line (ms); a penalty fires past the grace. */
  private outOfZoneMs = 0;
  /** Which side the body is currently clipping: -1 = raw-left edge, +1 = raw-right, 0 = in-bounds. */
  private sideOut = 0;
  /** How long the body has been out of the side bounds (ms); drives the warning + bleed. */
  private sideOutMs = 0;
  /** Accumulator that fires a life-loss every SIDE_DRAIN_MS once past the grace. */
  private sideDrainMs = 0;
  /** Queued in update(), fired in render() where canvas coords are known. */
  private fx: { kind: 'hit' | 'graze' | 'slouch' | 'edge' | 'heal'; fatal: boolean; nx: number; ny: number; color: string }[] = [];

  init(): void {
    /* engine calls reset() before init; nothing else to allocate */
  }

  reset(): void {
    this.clear();
    this.unit = DEFAULT_UNIT;
    this.centerX = 0.5;
    this.sweepTopY = DEFAULT_SWEEP_TOP;
    this.sweepBotY = DEFAULT_SWEEP_BOT;
    this.bodyMidY = DEFAULT_BODY_MID;
    this.standLineY = DEFAULT_SWEEP_BOT;
    this.phase = 'waiting';
  }

  /**
   * The shell's "begin the run" signal. Calibrate the objects to the player: take
   * their apparent size, position, and height from the body profile so drops are
   * sized + aimed to them and sweepers sit in a height band they can duck under
   * (fair whether they're close or far from the camera).
   */
  configure(result: CalibrationResult): void {
    this.clear();
    const p = result.profile;
    if (p) {
      this.unit = clamp(p.unit, UNIT_MIN, UNIT_MAX);
      this.centerX = clamp((p.shoulderL.x + p.shoulderR.x) / 2, 0.1, 0.9);
      // Sweepers run from head height down to a duck floor a fraction of the way
      // toward the hips — the lowest a sweeper may sit and still be crouch-able.
      const headY = clamp(p.head.y, 0.05, 0.6);
      const hipY = clamp((p.hipL.y + p.hipR.y) / 2, headY + 0.1, 0.95);
      this.sweepTopY = headY;
      this.sweepBotY = headY + clamp(DUCK_FRACTION * (hipY - headY), DUCK_RANGE_MIN, DUCK_RANGE_MAX);
      this.bodyMidY = clamp((headY + hipY) / 2, 0.2, 0.85);
    } else {
      this.unit = DEFAULT_UNIT;
      this.centerX = 0.5;
      this.sweepTopY = DEFAULT_SWEEP_TOP;
      this.sweepBotY = DEFAULT_SWEEP_BOT;
      this.bodyMidY = DEFAULT_BODY_MID;
    }
    // The stand line sits at the bottom of the sweeper zone: standing keeps the
    // head above it; only a real duck/crouch drops below.
    this.standLineY = this.sweepBotY;
    this.phase = 'play';
  }

  /** Reset run state (phase + calibration set by the caller). */
  private clear(): void {
    this.objects = [];
    this.pending = [];
    this.scoreValue = 0;
    this.lives = START_LIVES;
    this.combo = 0;
    this.healProgress = 0;
    this.elapsed = 0;
    this.spawnTimer = FIRST_SPAWN_MS;
    this.lastHitType = '';
    this.outOfZoneMs = 0;
    this.sideOut = 0;
    this.sideOutMs = 0;
    this.sideDrainMs = 0;
    this.fx = [];
  }

  update(frame: PerceptionFrame, dt: number): void {
    if (this.phase !== 'play') return;

    const player = this.playerMask(frame);
    const stats = player ? this.areaCentroid(player) : null;
    const present = !!stats && stats.area >= MIN_PLAYER_AREA * player!.data.length;

    // Track where the player actually is, so objects keep raining on them as they
    // weave — fair wherever they stand. Spawning + difficulty advance only while
    // framed (stepping out pauses the run rather than farming free dodges).
    if (present && stats) {
      this.centerX = lerp(this.centerX, stats.cx, CENTER_EMA);
      this.elapsed += dt;
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn();
        this.spawnTimer = this.spawnInterval();
      }
    }

    // Posture rule: keep the head above the stand line. A brief dip (to duck) is
    // fine, but staying crouched past the grace window costs a life.
    this.updatePosture(frame, dt, present);

    // Side-bounds rule: keep the body inside the frame. Sticking out a side warns
    // immediately, then bleeds lives fast until you step back in.
    this.updateSideBounds(present && stats ? stats.sideOut : 0, dt);

    // Advance telegraphs: a queued object waits out its warning, then enters play
    // as a live, collidable object. Warnings tick regardless of framing so a
    // telegraphed hit always resolves.
    const stillWarning: Pending[] = [];
    for (const p of this.pending) {
      p.timer -= dt;
      if (p.timer <= 0) this.objects.push(p.obj);
      else stillWarning.push(p);
    }
    this.pending = stillWarning;

    const survivors: Obj[] = [];
    for (const o of this.objects) {
      o.x += o.vx * dt;
      o.y += o.vy * dt;

      if (present && player) {
        const ratio = this.overlapRatio(o, player);
        if (ratio >= HIT_RATIO) {
          o.hit = true;
          this.onHit(o);
          continue; // shattered — drop it
        }
        if (!o.grazed && ratio >= GRAZE_RATIO) {
          o.grazed = true;
          this.fx.push({ kind: 'graze', fatal: false, nx: o.x, ny: o.y, color: o.type.color });
        }
      }

      if (this.offscreen(o)) {
        if (present) this.onDodge(); // fell past without hitting you
        continue;
      }
      survivors.push(o);
    }
    this.objects = survivors;

    if (this.lives <= 0) this.phase = 'dead';
  }

  private onHit(o: Obj): void {
    this.lives--;
    this.breakCombo();
    this.lastHitType = o.type.name;
    this.fx.push({ kind: 'hit', fatal: this.lives <= 0, nx: o.x, ny: o.y, color: o.type.color });
  }

  /**
   * A clean dodge: score it and extend the combo. While below full health, every
   * COMBO_HEAL dodges in a row bank a life back (capped at START_LIVES) — a slow,
   * earned recovery for staying untouched.
   */
  private onDodge(): void {
    this.scoreValue++;
    this.combo++;
    if (this.lives < START_LIVES) {
      this.healProgress += this.healGain();
      if (this.healProgress >= COMBO_HEAL) {
        this.healProgress -= COMBO_HEAL; // carry the remainder, don't waste overflow
        this.lives++;
        this.fx.push({ kind: 'heal', fatal: false, nx: this.centerX, ny: 0.4, color: COLORS.ok });
      }
    }
  }

  /** Heal-progress earned per dodge — one step bigger each HEAL_TIER of combo, capped. */
  private healGain(): number {
    return clamp(1 + Math.floor(this.combo / HEAL_TIER), 1, HEAL_MAX_GAIN);
  }

  /** Any hit or rule-break ends the streak and the progress toward an earned life. */
  private breakCombo(): void {
    this.combo = 0;
    this.healProgress = 0;
  }

  /**
   * Track head height and enforce the stand line. While the player is framed and
   * the nose is visible, accumulate time spent below the line; cross the grace
   * window and it's a life (then the clock resets so they must pop back up). The
   * head is lifted to the same point calibration uses (a touch above the nose) so
   * the live measure matches the line derived from it.
   */
  private updatePosture(frame: PerceptionFrame, dt: number, present: boolean): void {
    if (!present || !frame.pose) return;
    const nose = frame.pose[HEAD_LM];
    if (!nose || (nose.visibility ?? 0) < HEAD_VIS) return;
    const headY = nose.y - this.unit * HEAD_RISE;
    if (headY > this.standLineY) {
      this.outOfZoneMs += dt;
      if (this.outOfZoneMs >= STAND_GRACE_MS) {
        this.outOfZoneMs = 0;
        this.lives--;
        this.breakCombo();
        this.lastHitType = 'slouch';
        this.fx.push({ kind: 'slouch', fatal: this.lives <= 0, nx: nose.x, ny: this.standLineY, color: COLORS.danger });
      }
    } else {
      this.outOfZoneMs = 0;
    }
  }

  /**
   * Enforce the side bounds. The instant the body clips an edge we flag the side
   * (so render can warn), then after {@link SIDE_GRACE_MS} we start draining a life
   * every {@link SIDE_DRAIN_MS} — a quick bleed, not a one-off — until the player
   * steps back in, which clears the timers.
   */
  private updateSideBounds(sideOut: number, dt: number): void {
    this.sideOut = sideOut;
    if (sideOut === 0) {
      this.sideOutMs = 0;
      this.sideDrainMs = 0;
      return;
    }
    this.sideOutMs += dt;
    if (this.sideOutMs < SIDE_GRACE_MS) return;
    this.sideDrainMs += dt;
    // Fire the edge fx at the raw edge the body is leaving through (render mirrors it).
    const nx = sideOut < 0 ? 0.02 : 0.98;
    while (this.sideDrainMs >= SIDE_DRAIN_MS && this.lives > 0) {
      this.sideDrainMs -= SIDE_DRAIN_MS;
      this.lives--;
      this.breakCombo();
      this.lastHitType = 'out';
      this.fx.push({ kind: 'edge', fatal: this.lives <= 0, nx, ny: 0.5, color: COLORS.danger });
    }
  }

  // --- collision -----------------------------------------------------------

  /** Eroded binary player silhouette in the collision grid, or null if no mask yet. */
  private playerMask(frame: PerceptionFrame): BinaryMask | null {
    const grid = maskGrid(frame);
    return grid ? erode(binarize(grid, 0.5), debugParams.erodePx) : null;
  }

  /**
   * Occupied-cell count + normalized horizontal centroid of the silhouette, plus
   * which side (if any) the body is clipping out of frame: we sample a thin band at
   * each edge and, if it's filled past {@link SIDE_OUT_DENSITY}, the body is sticking
   * out that side (the silhouette piles up against the edge it's being cut off by).
   */
  private areaCentroid(mask: BinaryMask): { area: number; cx: number; sideOut: number } {
    const w = mask.width;
    const h = mask.height;
    const band = Math.max(1, Math.round(w * EDGE_BAND_FRAC));
    let area = 0;
    let sx = 0;
    let edgeL = 0;
    let edgeR = 0;
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        if (mask.data[gy * w + gx]) {
          area++;
          sx += (gx + 0.5) / w;
          if (gx < band) edgeL++;
          else if (gx >= w - band) edgeR++;
        }
      }
    }
    const denom = band * h;
    const dl = edgeL / denom;
    const dr = edgeR / denom;
    let sideOut = 0;
    if (dl >= dr && dl > SIDE_OUT_DENSITY) sideOut = -1;
    else if (dr > SIDE_OUT_DENSITY) sideOut = 1;
    return { area, cx: area ? sx / area : this.centerX, sideOut };
  }

  /**
   * Fraction of this object's cells that fall on the player — "how much of this
   * thing is hitting me" — in cell space, where the object is a true circle.
   */
  private overlapRatio(o: Obj, player: BinaryMask): number {
    // Cells are square in pixels, so one radius (scaled by width) works for x and y.
    return circleOverlapRatio(player, o.x * player.width, o.y * player.height, o.cr * player.width);
  }

  private offscreen(o: Obj): boolean {
    return o.x < -OFF || o.x > 1 + OFF || o.y < -OFF || o.y > 1 + OFF;
  }

  // --- spawning ------------------------------------------------------------

  private diff(): number {
    return Math.min(1, this.elapsed / RAMP_MS);
  }
  private spawnInterval(): number {
    return lerp(SPAWN_GAP_START, SPAWN_GAP_END, this.diff());
  }
  /** Base fall speed in normalized units per ms. */
  private baseSpeed(): number {
    return lerp(0.34, 0.92, this.diff()) / 1000;
  }

  /** Warning lead time before an object actually enters — longer when it's calm. */
  private warnMs(): number {
    return lerp(WARN_MAX_MS, WARN_MIN_MS, this.diff());
  }

  /** Queue an object behind a warning window rather than dropping it in cold. */
  private spawn(): void {
    const max = this.warnMs();
    this.pending.push({ obj: this.makeObject(), timer: max, max });
  }

  /**
   * Build either a falling drop (avoided by stepping aside) or a horizontal
   * sweeper at the calibrated duck-able height band (avoided by ducking). The
   * object starts off-screen; its warning is telegraphed from this start state.
   */
  private makeObject(): Obj {
    const type = TYPES[weighted(TYPE_WEIGHTS)];
    const r = type.rMul * this.unit;
    const cr = type.crMul * this.unit;
    const speed = this.baseSpeed() * type.speedMul;
    const m = SPAWN_MARGIN + r;
    const base = { type, r, cr, grazed: false, hit: false };

    if (Math.random() < SWEEP_PROB) {
      // Sweeper: pure horizontal, at a randomized height inside the duck-able band
      // (so its height is always one the calibrated player can crouch beneath).
      const fromLeft = Math.random() < 0.5;
      return {
        ...base,
        x: fromLeft ? -m : 1 + m,
        y: rand(this.sweepTopY, this.sweepBotY),
        vx: (fromLeft ? 1 : -1) * speed,
        vy: 0,
      };
    }

    // Drop: never starts straight above the head. It spawns off to one side — at
    // least HEAD_CLEAR shoulder-widths over, out to a band that widens with
    // difficulty — then its trajectory may angle back toward the body. `aim` ranges
    // from 0 (falls straight, landing beside you — a clean sidestep) to 1 (curves
    // onto your torso by the time it reaches you, so you have to actually move).
    const dir = Math.random() < 0.5 ? -1 : 1;
    const minOff = this.unit * HEAD_CLEAR;
    const maxOff = this.unit * lerp(1.2, 2.0, this.diff());
    const x = clamp(this.centerX + dir * rand(minOff, maxOff), 0.04, 0.96);
    const reachY = this.bodyMidY + m; // fall distance from spawn (y = -m) to the body line
    const aim = rand(0, 1);
    const vx = (-(x - this.centerX) / reachY) * speed * aim + rand(-0.05, 0.05) * speed;
    return { ...base, x, y: -m, vx, vy: speed };
  }

  // --- contract surface ----------------------------------------------------

  score(): number {
    return this.scoreValue;
  }

  /** Lives as 0..1 — the shell HUD renders this as a crack meter. */
  health(): number {
    return Math.max(0, this.lives) / START_LIVES;
  }

  /** Share-card flavor: what finally clipped you. */
  tagline(): string {
    if (this.lastHitType === 'slouch') return 'Caught slouching';
    if (this.lastHitType === 'out') return 'Wandered out of bounds';
    return this.lastHitType ? `Clipped by a ${this.lastHitType}` : 'Untouchable';
  }

  isOver(): boolean {
    return this.phase === 'dead';
  }

  // --- rendering -----------------------------------------------------------

  render(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const rect = perceptionRect(ctx, frame);
    if (frame.video) drawCameraFeed(ctx, frame.video, rect, this.phase === 'play' ? 0.6 : 0.8);

    // `waiting` = the live preview the shell shows behind calibration/countdown.
    if (this.phase === 'waiting') {
      if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect);
      return;
    }

    this.fireFx(ctx, rect); // hit/graze feedback queued by update()
    for (const p of this.pending) this.drawTelegraph(ctx, p, rect); // warnings, under the objects
    for (const o of this.objects) this.drawObject(ctx, o, rect);
    if (frame.pose) drawPoseSkeleton(ctx, frame.pose, rect, 0.5); // dimmed in-game; full in calibration
    if (this.phase === 'play') {
      this.drawStandZone(ctx, rect);
      this.drawSideWarning(ctx, rect);
      this.drawCombo(ctx, rect);
    }
  }

  /**
   * Combo readout: the current streak, and (while hurt) a meter filling toward the
   * next earned life so the slow HP recovery is visible. Sits top-center, clear of
   * the shell's score/health HUD at the corners.
   */
  private drawCombo(ctx: CanvasRenderingContext2D, rect: Rect): void {
    if (this.combo < 2) return;
    const cx = rect.x + rect.w / 2;
    const top = rect.y + rect.h * 0.11;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(rect.w / 22)}px ${FONT.display}`;
    ctx.fillStyle = rgba(COLORS.teal, 0.95);
    ctx.shadowColor = rgba(COLORS.teal, 0.6);
    ctx.shadowBlur = rect.w * 0.01;
    ctx.fillText(`${this.combo}× COMBO`, cx, top);
    ctx.shadowBlur = 0;

    // Heal meter — only while below full health, so it reads as "earning HP back".
    if (this.lives < START_LIVES) {
      const frac = clamp(this.healProgress / COMBO_HEAL, 0, 1);
      const barW = rect.w * 0.26;
      const barH = Math.max(5, rect.h * 0.011);
      const bx = cx - barW / 2;
      const by = top + rect.h * 0.06;
      ctx.fillStyle = rgba(COLORS.text, 0.18);
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = COLORS.ok;
      ctx.fillRect(bx, by, barW * frac, barH);
      const remain = Math.max(1, Math.ceil((COMBO_HEAL - this.healProgress) / this.healGain()));
      ctx.font = `${Math.round(rect.w / 52)}px ${FONT.mono}`;
      ctx.fillStyle = rgba(COLORS.ok, 0.85);
      ctx.textBaseline = 'bottom';
      ctx.fillText(`+♥ in ${remain}`, cx, by - rect.h * 0.008);
    }
    ctx.restore();
  }

  /**
   * Edge warning when the body sticks out of the side bounds: a pulsing red band
   * down the offending screen edge plus a "GET BACK IN!" shout. Before the grace
   * runs out it's a countdown bar; once the bleed starts it just pulses hard. The
   * raw side is mirrored to selfie space (raw-left clip shows on the right edge).
   */
  private drawSideWarning(ctx: CanvasRenderingContext2D, rect: Rect): void {
    if (this.sideOut === 0) return;
    const bleeding = this.sideOutMs >= SIDE_GRACE_MS;
    const remain = clamp(1 - this.sideOutMs / SIDE_GRACE_MS, 0, 1);
    const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this.sideOutMs / (bleeding ? 90 : 150)));
    const onRight = this.sideOut < 0; // raw-left clip → mirrored to the screen's right
    const bandW = rect.w * 0.16;
    const edgeX = onRight ? rect.x + rect.w : rect.x;

    ctx.save();
    // Red gradient hugging the offending edge, fading inward.
    const grad = onRight
      ? ctx.createLinearGradient(edgeX, 0, edgeX - bandW, 0)
      : ctx.createLinearGradient(edgeX, 0, edgeX + bandW, 0);
    grad.addColorStop(0, rgba(COLORS.danger, 0.5 * pulse + 0.2));
    grad.addColorStop(1, rgba(COLORS.danger, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(onRight ? rect.x + rect.w - bandW : rect.x, rect.y, bandW, rect.h);

    // Shout, centered, pointing back toward the field.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(rect.w / 20)}px ${FONT.display}`;
    ctx.fillStyle = rgba(COLORS.danger, 0.7 + 0.3 * pulse);
    const arrow = onRight ? '◀' : '▶';
    ctx.fillText(`${arrow} GET BACK IN! ${arrow}`, rect.x + rect.w / 2, rect.y + rect.h * 0.5);

    // Before the bleed: a shrinking grace bar. After: it's draining lives already.
    if (!bleeding) {
      const barW = rect.w * 0.3;
      const barH = Math.max(5, rect.h * 0.012);
      const bx = rect.x + (rect.w - barW) / 2;
      const by = rect.y + rect.h * 0.5 + rect.h * 0.05;
      ctx.fillStyle = rgba(COLORS.text, 0.18);
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = COLORS.danger;
      ctx.fillRect(bx, by, barW * remain, barH);
    }
    ctx.restore();
  }

  /**
   * The stand line + a "STAND UP!" countdown. The line marks the bottom of the
   * standing zone; while the head is below it, a shrinking bar shows how much of
   * the 3s grace is left before it costs a life. Calm when you're upright,
   * pulsing red the moment you drop below.
   */
  private drawStandZone(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const y = rect.y + this.standLineY * rect.h;
    const danger = this.outOfZoneMs > 0;
    const remain = clamp(1 - this.outOfZoneMs / STAND_GRACE_MS, 0, 1);
    const pulse = danger ? 0.55 + 0.45 * Math.abs(Math.sin(this.outOfZoneMs / 110)) : 0.4;

    ctx.save();
    // The line itself.
    ctx.setLineDash([rect.w * 0.022, rect.w * 0.016]);
    ctx.lineWidth = Math.max(2, rect.w * 0.004);
    ctx.strokeStyle = rgba(danger ? COLORS.danger : COLORS.teal, pulse);
    ctx.beginPath();
    ctx.moveTo(rect.x, y);
    ctx.lineTo(rect.x + rect.w, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Quiet hint label so the rule reads even when you're fine.
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.font = `${Math.round(rect.w / 46)}px ${FONT.mono}`;
    ctx.fillStyle = rgba(danger ? COLORS.danger : COLORS.teal, 0.7);
    ctx.fillText('▲ STAND ABOVE', rect.x + rect.w * 0.02, y - rect.h * 0.012);

    // Crouched: shout + countdown bar.
    if (danger) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(rect.w / 18)}px ${FONT.display}`;
      ctx.fillStyle = rgba(COLORS.danger, pulse);
      ctx.fillText('STAND UP!', rect.x + rect.w / 2, y - rect.h * 0.07);

      const barW = rect.w * 0.3;
      const barH = Math.max(5, rect.h * 0.012);
      const bx = rect.x + (rect.w - barW) / 2;
      const by = y - rect.h * 0.03;
      ctx.fillStyle = rgba(COLORS.text, 0.18);
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = COLORS.danger;
      ctx.fillRect(bx, by, barW * remain, barH);
    }
    ctx.restore();
  }

  /**
   * Telegraph a queued object: a dashed lane along its incoming path plus a
   * pulsing "lock" marker (a ring that contracts toward arrival + an arrow
   * pointing the way it will travel) at the edge it enters from. Gives the player
   * a readable beat to move before it's live. Mirrored to selfie space like the
   * objects. The pulse is driven purely by warning progress, so no clock is needed.
   */
  private drawTelegraph(ctx: CanvasRenderingContext2D, p: Pending, rect: Rect): void {
    const o = p.obj;
    const prog = clamp(1 - p.timer / p.max, 0, 1); // 0 at warning start → 1 at arrival
    const flash = 0.55 + 0.45 * Math.abs(Math.sin(prog * Math.PI * 3));
    const a = (0.22 + 0.62 * prog) * flash;
    const col = o.type.color;
    const sx = (nx: number): number => rect.x + (1 - nx) * rect.w; // selfie mirror
    const sy = (ny: number): number => rect.y + ny * rect.h;

    // Dashed lane along the trajectory, clipped to the play area.
    const mag = Math.hypot(o.vx, o.vy) || 1;
    const ux = o.vx / mag;
    const uy = o.vy / mag;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.strokeStyle = rgba(col, a * 0.32);
    ctx.lineWidth = Math.max(2, o.r * rect.w * 0.5);
    ctx.lineCap = 'round';
    ctx.setLineDash([rect.w * 0.014, rect.w * 0.02]);
    ctx.beginPath();
    ctx.moveTo(sx(o.x - ux * 0.2), sy(o.y - uy * 0.2));
    ctx.lineTo(sx(o.x + ux * 1.8), sy(o.y + uy * 1.8));
    ctx.stroke();
    ctx.restore();

    // Edge marker: a contracting ring + an arrow pointing the way it will travel.
    const s = Math.max(9, rect.w * 0.016) * (0.9 + 0.35 * prog);
    const pad = s * 2;
    const ex = clamp(sx(o.x), rect.x + pad, rect.x + rect.w - pad);
    const ey = clamp(sy(o.y), rect.y + pad, rect.y + rect.h - pad);
    const ang = Math.atan2(o.vy, -o.vx); // screen velocity (x mirrored)

    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = s;
    ctx.strokeStyle = rgba(col, a);
    ctx.lineWidth = Math.max(2, s * 0.16);
    ctx.beginPath();
    ctx.arc(ex, ey, s * (1.7 - 0.6 * prog), 0, Math.PI * 2);
    ctx.stroke();

    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.fillStyle = rgba(col, a);
    ctx.beginPath();
    ctx.moveTo(s * 0.95, 0);
    ctx.lineTo(-s * 0.5, s * 0.62);
    ctx.lineTo(-s * 0.5, -s * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Fire queued hit/graze juice + SFX at the object's mirrored screen position. */
  private fireFx(ctx: CanvasRenderingContext2D, rect: Rect): void {
    if (this.fx.length === 0) return;
    const unit = ctx.canvas.width;
    for (const e of this.fx) {
      const x = rect.x + (1 - e.nx) * rect.w;
      const y = rect.y + e.ny * rect.h;
      if (e.kind === 'slouch' || e.kind === 'edge') {
        // Posture/bounds penalty: a red full-frame pulse + a low buzzer, no shatter
        // (nothing struck you — you broke a rule). Fires repeatedly as a bound bleed.
        juice.fx.flash(COLORS.danger, e.fatal ? 0.4 : 0.22, e.fatal ? 460 : 300);
        juice.camera.shake(e.fatal ? 1 : 0.45);
        if (e.fatal) {
          juice.time.freeze(240);
          audio.duck(900);
        }
        audio.thud();
      } else if (e.kind === 'hit') {
        juice.fx.flash(COLORS.danger, e.fatal ? 0.4 : 0.24, e.fatal ? 460 : 280);
        juice.camera.shake(e.fatal ? 1 : 0.55);
        juice.time.freeze(e.fatal ? 240 : 110);
        juice.particles.burst({
          x, y, count: e.fatal ? 84 : 42, color: rgba(e.color, 1), speed: unit / 2000,
          life: 820, size: unit / 340, gravity: unit / 2_000_000, drag: 0.984,
        });
        audio.thud();
        audio.crack();
        if (e.fatal) audio.duck(900);
      } else if (e.kind === 'heal') {
        // Earned-a-life reward: a soft green pulse + upward-floating sparks + the
        // success sting, so regaining HP reads as a clear, positive beat.
        juice.fx.flash(COLORS.ok, 0.18, 340);
        juice.particles.burst({
          x, y, count: 40, color: rgba(COLORS.ok, 1), speed: unit / 2400,
          life: 780, size: unit / 360, gravity: -unit / 4_000_000, drag: 0.985,
        });
        audio.sting();
      } else {
        juice.camera.shake(0.22);
        juice.particles.burst({
          x, y, count: 10, color: rgba(e.color, 1), speed: unit / 2600,
          life: 420, size: unit / 420, gravity: 0, drag: 0.98,
        });
        audio.crack();
      }
    }
    this.fx.length = 0;
  }

  private drawObject(ctx: CanvasRenderingContext2D, o: Obj, rect: Rect): void {
    const hx = rect.x + (1 - o.x) * rect.w;
    const hy = rect.y + o.y * rect.h;
    const R = o.r * rect.w;

    ctx.save();

    // Motion trail: a fading streak extrapolated backward along the velocity.
    const mag = Math.hypot(o.vx, o.vy) || 1;
    const tnx = o.x - (o.vx / mag) * o.type.trail;
    const tny = o.y - (o.vy / mag) * o.type.trail;
    const tx = rect.x + (1 - tnx) * rect.w;
    const ty = rect.y + tny * rect.h;
    const tg = ctx.createLinearGradient(hx, hy, tx, ty);
    tg.addColorStop(0, rgba(o.type.color, 0.5));
    tg.addColorStop(1, rgba(o.type.color, 0));
    ctx.strokeStyle = tg;
    ctx.lineWidth = Math.max(2, R * 1.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // Glowing orb: white-hot core fading to the type color.
    const rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, R);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)');
    rg.addColorStop(0.4, rgba(o.type.color, 0.95));
    rg.addColorStop(1, rgba(o.type.color, 0));
    ctx.fillStyle = rg;
    ctx.shadowColor = o.type.color;
    ctx.shadowBlur = R * 0.9;
    ctx.beginPath();
    ctx.arc(hx, hy, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

/** Pick an index by weight; `weights` need not sum to 1. */
function weighted(weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

register(new Dodge());
