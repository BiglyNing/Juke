/**
 * Hand Simon-Says (Phase 6) — the seated, laptop-friendly second mode.
 *
 * The lowest-friction game for an online reviewer: no standing, no clearing
 * space, just a hand at the laptop. It flashes a target hand-sign; you have a
 * (shrinking) window to make it. Match → score + streak + faster tempo; let the
 * timer run out → lose a life; out of lives → the shell's GAME OVER.
 *
 * Signs come in two flavors:
 *  - built-in: matched against MediaPipe's Gesture Recognizer label (`label`).
 *  - landmark: matched by a finger-state predicate (`match`) — the "rich tier"
 *    (Phase 11), which is how we get poses the recognizer has no label for
 *    (Shaka, Horns, OK, Pinch).
 *
 * Gimmick — the game finally lives up to its name. Most of the time it's a
 * straight "make this sign" run, but it periodically drops into a *block* that
 * lasts ~10 signs, announced by a warning banner:
 *  - SIMON SAYS block: only obey when the prompt reads "SIMON SAYS". If it
 *    doesn't, you must HOLD STILL — make the sign anyway and you lose a life.
 *  - MIRROR block: make the OPPOSITE of the sign shown (✋↔✊, 👍↔👎, ✌️↔🤘).
 *
 * Lifecycle: written to the Phase 5 shell contract just like Hole-in-the-Wall —
 *   waiting → play → dead. The shell runs the seated calibration ("show your
 *   hand") and the countdown; `configure()` is the shell's "begin now" signal.
 */

import { register, type JukeGame, type Need, type Intensity } from '../engine/game';
import type { PerceptionFrame } from '../engine/frame';
import { fingerStates, type FingerStates, type Point } from '../engine/pose';
import { perceptionRect, drawCameraFeed, drawHandSkeleton } from '../render/perception';
import { juice } from '../juice/juice';
import { audio } from '../juice/audio';
import { COLORS, FONT, rgba } from '../shell/theme';

interface Sign {
  /** Stable key (also used to wire up mirror opposites). */
  id: string;
  /** MediaPipe Gesture Recognizer label, for recognizer-graded signs. */
  label?: string;
  /** Landmark predicate, for signs the recognizer has no label for. */
  match?: (f: FingerStates, hand: Point[]) => boolean;
  name: string;
  emoji: string;
  /** id of the sign that is this one's mirror opposite (enables MIRROR rounds). */
  opposite?: string;
}

/** Thumb-tip and index-tip pinched together, relative to palm size. */
function pinching(hand: Point[]): boolean {
  const palm = Math.hypot(hand[0].x - hand[9].x, hand[0].y - hand[9].y) || 1;
  const tipGap = Math.hypot(hand[4].x - hand[8].x, hand[4].y - hand[8].y);
  return tipGap < palm * 0.45;
}

const SIGNS: Sign[] = [
  // Built-in recognizer labels.
  { id: 'open', label: 'Open_Palm', name: 'Open Palm', emoji: '✋', opposite: 'fist' },
  { id: 'fist', label: 'Closed_Fist', name: 'Fist', emoji: '✊', opposite: 'open' },
  { id: 'peace', label: 'Victory', name: 'Peace', emoji: '✌️' },
  { id: 'thumbUp', label: 'Thumb_Up', name: 'Thumbs Up', emoji: '👍', opposite: 'thumbDown' },
  { id: 'thumbDown', label: 'Thumb_Down', name: 'Thumbs Down', emoji: '👎', opposite: 'thumbUp' },
  { id: 'point', label: 'Pointing_Up', name: 'Point Up', emoji: '☝️' },
  { id: 'loveyou', label: 'ILoveYou', name: 'Rock On', emoji: '🤟' },
  // Landmark-graded poses (new motions — no recognizer label).
  {
    id: 'shaka',
    name: 'Shaka',
    emoji: '🤙',
    match: (f) => f.thumb && f.pinky && !f.index && !f.middle && !f.ring,
  },
  {
    id: 'ok',
    name: 'OK',
    emoji: '👌',
    match: (f, h) => pinching(h) && f.middle && f.ring && f.pinky,
  },
  {
    id: 'pinch',
    name: 'Pinch',
    emoji: '🤏',
    match: (f, h) => pinching(h) && !f.middle && !f.ring && !f.pinky,
  },
];

const SIGN_BY_ID = new Map(SIGNS.map((s) => [s.id, s]));
/** Signs that have a defined opposite — the pool MIRROR rounds draw from. */
const MIRROR_SIGNS = SIGNS.filter((s) => s.opposite);

const START_LIVES = 3;
const BASE_ROUND_MS = 3500;
const MIN_ROUND_MS = 1400;
const RAMP_MS = 130; // shaved off the round timer per point of streak
const MATCH_SCORE = 0.5; // recognizer confidence required to count
const FEEDBACK_MS = 480;

// Gimmick pacing.
const BLOCK_LEN = 10; // signs in a SIMON/MIRROR block
const NORMAL_MIN = 5; // straight signs between blocks (inclusive range)
const NORMAL_MAX = 9;
const WARN_MS = 3400; // warning-banner lead-in before a block begins (long enough to read the rule)
const SIMON_TRAP_PROB = 0.42; // chance a SIMON round is a "didn't say" trap

type Phase = 'waiting' | 'play' | 'dead';
/** 'both' is the compounding block: a MIRROR round gated by SIMON SAYS. */
type Mode = 'normal' | 'simon' | 'mirror' | 'both';

const randInt = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo + 1));

class SimonSays implements JukeGame {
  readonly id = 'simonSays';
  readonly title = 'Hand Simon-Says';
  readonly needs: Need[] = ['hands'];
  readonly intensity: Intensity = 'seated';

  private phase: Phase = 'waiting';
  /** What the prompt displays (the stimulus). */
  private shown: Sign = SIGNS[0];
  /** What the player must actually perform — differs from `shown` in MIRROR. */
  private required: Sign = SIGNS[0];
  /** Whether the player should act at all (false = SIMON trap: hold still). */
  private obey = true;

  private timeLeft = 0;
  private roundTime = BASE_ROUND_MS;
  /** A round only counts once the player isn't already holding the required sign. */
  private armed = false;

  // Gimmick state.
  private mode: Mode = 'normal';
  /** Rounds left in the current mode (until a block ends / a block is triggered). */
  private roundsLeftInMode = NORMAL_MAX;
  /** Active warning banner before a block begins; gameplay is paused while set. */
  private warning: { mode: Mode; ms: number } | null = null;
  private pendingWarnSfx = false;

  private scoreValue = 0;
  private streak = 0;
  private maxStreak = 0;
  private lives = START_LIVES;
  private feedback: { kind: 'hit' | 'miss'; ms: number } | null = null;
  /** Set at a hit/miss in update(); render() fires the juice (it has the canvas). */
  private pendingFx: 'hit' | 'miss' | 'dead' | null = null;

  init(): void {
    /* engine calls reset() before init; nothing else to allocate */
  }

  reset(): void {
    this.phase = 'waiting';
    this.scoreValue = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.lives = START_LIVES;
    this.feedback = null;
    this.armed = false;
    this.pendingFx = null;
    this.mode = 'normal';
    this.warning = null;
    this.pendingWarnSfx = false;
  }

  /** The shell's "begin the run" signal (after seated calibration + countdown). */
  configure(): void {
    this.scoreValue = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.lives = START_LIVES;
    this.feedback = null;
    this.pendingFx = null;
    this.mode = 'normal';
    this.warning = null;
    this.pendingWarnSfx = false;
    this.roundsLeftInMode = randInt(NORMAL_MIN, NORMAL_MAX);
    // First target avoids Open Palm, since seated calibration just had the player
    // show an open hand — otherwise round 1 could auto-complete. Seeding `shown`
    // lets beginRound()'s avoid-repeat logic do the work.
    this.shown = SIGN_BY_ID.get('open')!;
    this.roundTime = BASE_ROUND_MS;
    this.beginRound();
    this.phase = 'play';
  }

  update(frame: PerceptionFrame, dt: number): void {
    if (this.phase !== 'play') return;

    if (this.feedback) {
      this.feedback.ms -= dt;
      if (this.feedback.ms <= 0) this.feedback = null;
    }

    // Warning banner: gameplay is paused while it counts down, then the block begins.
    if (this.warning) {
      this.warning.ms -= dt;
      if (this.warning.ms <= 0) {
        this.mode = this.warning.mode;
        this.roundsLeftInMode = BLOCK_LEN;
        this.warning = null;
        this.beginRound();
      }
      return;
    }

    const matched = this.detected(this.required, frame);
    // Arm once the player is clearly NOT holding the required sign — so a sign
    // carried over from the previous round can't auto-resolve this one.
    if (!this.armed && !matched) this.armed = true;

    if (this.obey) {
      if (this.armed && matched) {
        this.onSuccess();
        return;
      }
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.onFail();
    } else {
      // SIMON trap: making the sign is the mistake; surviving the timer is the win.
      if (this.armed && matched) {
        this.onFail();
        return;
      }
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.onSuccess();
    }
  }

  /** True iff the live frame satisfies `sign` (recognizer label or landmark predicate). */
  private detected(sign: Sign, frame: PerceptionFrame): boolean {
    if (sign.label) {
      const g = frame.gestures && frame.gestures.length > 0 ? frame.gestures[0] : null;
      return g !== null && g.name === sign.label && g.score >= MATCH_SCORE;
    }
    const hand = frame.hands && frame.hands.length > 0 ? frame.hands[0] : null;
    return hand !== null && !!sign.match && sign.match(fingerStates(hand), hand);
  }

  private onSuccess(): void {
    this.scoreValue++;
    this.streak++;
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    this.feedback = { kind: 'hit', ms: FEEDBACK_MS };
    this.pendingFx = 'hit';
    this.advance();
  }

  private onFail(): void {
    this.lives--;
    this.streak = 0;
    this.feedback = { kind: 'miss', ms: FEEDBACK_MS };
    if (this.lives <= 0) {
      this.phase = 'dead';
      this.pendingFx = 'dead';
      return;
    }
    this.pendingFx = 'miss';
    this.advance();
  }

  /** Decide what comes next: another round, a block end, or a warning lead-in. */
  private advance(): void {
    this.roundsLeftInMode--;
    if (this.roundsLeftInMode > 0) {
      this.beginRound();
      return;
    }
    if (this.mode === 'normal') {
      // Drop into a special block, announced by a warning banner. The compounding
      // 'both' block is rarer (~20%) since it stacks the two challenges.
      const r = Math.random();
      const next: Mode = r < 0.4 ? 'simon' : r < 0.8 ? 'mirror' : 'both';
      this.warning = { mode: next, ms: WARN_MS };
      this.pendingWarnSfx = true;
    } else {
      // Block finished — back to a stretch of straight rounds.
      this.mode = 'normal';
      this.roundsLeftInMode = randInt(NORMAL_MIN, NORMAL_MAX);
      this.beginRound();
    }
  }

  /** Pick the next round's stimulus + requirement + obey flag for the current mode. */
  private beginRound(): void {
    const prev = this.shown.id;
    const mirror = this.mode === 'mirror' || this.mode === 'both';
    const simon = this.mode === 'simon' || this.mode === 'both';
    this.shown = this.pickSign(mirror ? MIRROR_SIGNS : SIGNS, prev);
    this.required = mirror ? SIGN_BY_ID.get(this.shown.opposite!)! : this.shown;
    this.obey = simon ? Math.random() >= SIMON_TRAP_PROB : true;
    this.roundTime = Math.max(MIN_ROUND_MS, BASE_ROUND_MS - this.streak * RAMP_MS);
    this.timeLeft = this.roundTime;
    this.armed = false;
  }

  private pickSign(pool: Sign[], avoidId?: string): Sign {
    let s = pool[Math.floor(Math.random() * pool.length)];
    for (let i = 0; avoidId && s.id === avoidId && i < 12; i++) {
      s = pool[Math.floor(Math.random() * pool.length)];
    }
    return s;
  }

  /** Fire hit/miss juice + SFX. Called from render() with canvas coords. */
  private fireFx(x: number, y: number, unit: number): void {
    const fx = this.pendingFx;
    if (!fx) return;
    this.pendingFx = null;
    if (fx === 'hit') {
      juice.fx.flash(COLORS.ok, 0.12, 220);
      juice.particles.burst({
        x, y, count: 34, color: rgba(COLORS.ok, 1), speed: unit / 2400,
        life: 680, size: unit / 380, gravity: unit / 6_000_000, drag: 0.985,
      });
      audio.whoosh();
      if (this.streak > 0 && this.streak % 5 === 0) audio.sting(); // streak milestone flourish
    } else {
      juice.fx.flash(COLORS.danger, fx === 'dead' ? 0.34 : 0.2, fx === 'dead' ? 420 : 280);
      juice.camera.shake(fx === 'dead' ? 0.8 : 0.4);
      if (fx === 'dead') {
        juice.time.freeze(220);
        audio.thud();
        audio.duck(900);
      } else {
        audio.crack();
      }
    }
  }

  score(): number {
    return this.scoreValue;
  }

  /** Lives as 0..1 — the shell HUD renders this as a crack meter. */
  health(): number {
    return Math.max(0, this.lives) / START_LIVES;
  }

  /** Share-card flavor: the best streak reached this run. */
  tagline(): string {
    return this.maxStreak > 0 ? `Top streak: ${this.maxStreak}` : 'Warming up';
  }

  isOver(): boolean {
    return this.phase === 'dead';
  }

  // --- rendering -----------------------------------------------------------

  render(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const rect = perceptionRect(ctx, frame);
    const playing = this.phase === 'play';
    if (frame.video) drawCameraFeed(ctx, frame.video, rect, playing ? 0.55 : 0.8);

    const matched = playing && !this.warning && this.detected(this.required, frame);
    const hand = frame.hands && frame.hands.length > 0 ? frame.hands[0] : null;
    if (hand) {
      // Green when a "do it" requirement is satisfied; red when you're tripping a trap.
      const color = matched ? (this.obey ? COLORS.ok : COLORS.danger) : COLORS.teal;
      drawHandSkeleton(ctx, hand, rect, color);
    }

    if (this.pendingWarnSfx) {
      this.pendingWarnSfx = false;
      audio.sting();
    }

    // Fire queued juice at the hand (palm landmark) if visible, else screen center.
    if (this.pendingFx) {
      const palm = hand?.[9];
      const x = palm ? rect.x + (1 - palm.x) * rect.w : ctx.canvas.width / 2;
      const y = palm ? rect.y + palm.y * rect.h : ctx.canvas.height / 2;
      this.fireFx(x, y, ctx.canvas.width);
    }

    if (!playing) return;
    if (this.warning) {
      this.drawWarning(ctx, this.warning);
    } else {
      const g = frame.gestures && frame.gestures.length > 0 ? frame.gestures[0] : null;
      this.drawRound(ctx, g);
    }
  }

  /** The pre-block "GET READY" banner that teaches the rule about to kick in. */
  private drawWarning(ctx: CanvasRenderingContext2D, warning: { mode: Mode; ms: number }): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const mode = warning.mode;
    const accent =
      mode === 'simon' ? COLORS.sunset : mode === 'mirror' ? COLORS.magenta : COLORS.danger;
    // Pulse the banner so it reads as an alert.
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin((warning.ms / WARN_MS) * Math.PI * 3));

    ctx.save();
    ctx.textAlign = 'center';

    // Dim scrim so the banner pops over the camera feed.
    ctx.fillStyle = rgba(COLORS.base, 0.55);
    ctx.fillRect(0, 0, cw, ch);

    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(cw / 50)}px ${FONT.display}`;
    ctx.fillStyle = rgba(COLORS.muted, 0.95);
    ctx.fillText('GET READY', cw / 2, ch * 0.3);

    const title = mode === 'simon' ? 'SIMON SAYS' : mode === 'mirror' ? 'MIRROR' : 'SIMON × MIRROR';
    ctx.font = `bold ${Math.round(cw / (mode === 'both' ? 20 : 13))}px ${FONT.display}`;
    ctx.fillStyle = rgba(accent, pulse);
    ctx.fillText(title, cw / 2, ch * 0.44);

    ctx.font = `${Math.round(cw / 40)}px ${FONT.display}`;
    ctx.fillStyle = rgba(COLORS.text, 0.95);
    if (mode === 'simon') {
      ctx.fillText('Only move when it says SIMON SAYS', cw / 2, ch * 0.56);
      ctx.fillStyle = rgba(COLORS.danger, 0.95);
      ctx.fillText('No "Simon"?  HOLD STILL!', cw / 2, ch * 0.63);
    } else if (mode === 'mirror') {
      ctx.fillText('Make the OPPOSITE sign!', cw / 2, ch * 0.56);
      ctx.font = `${Math.round(cw / 26)}px ${FONT.mono}`;
      ctx.fillStyle = rgba(COLORS.text, 0.9);
      ctx.fillText('✋↔✊   👍↔👎', cw / 2, ch * 0.64);
    } else {
      ctx.fillText('OPPOSITE sign — but only when Simon says!', cw / 2, ch * 0.56);
      ctx.font = `${Math.round(cw / 26)}px ${FONT.mono}`;
      ctx.fillStyle = rgba(COLORS.text, 0.9);
      ctx.fillText('✋↔✊   👍↔👎', cw / 2, ch * 0.64);
    }
    ctx.restore();
  }

  private drawRound(ctx: CanvasRenderingContext2D, live: { name: string; score: number } | null): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const simon = this.mode === 'simon' || this.mode === 'both';
    const mirror = this.mode === 'mirror' || this.mode === 'both';

    // Mode banner (which block you're in + how many signs remain). The SIMON
    // banner deliberately avoids the words "simon says" so it can't be confused
    // with the per-round command below.
    if (this.mode !== 'normal') {
      const accent =
        this.mode === 'simon' ? COLORS.sunset : this.mode === 'mirror' ? COLORS.magenta : COLORS.danger;
      const label =
        this.mode === 'simon' ? '⚠' : this.mode === 'mirror' ? '🪞 MIRROR' : '⚠🪞 BOTH';
      ctx.font = `${Math.round(cw / 56)}px ${FONT.display}`;
      ctx.fillStyle = rgba(accent, 0.95);
      ctx.fillText(`${label}   ${this.roundsLeftInMode} LEFT`, cw / 2, ch * 0.08);
    }

    // The per-round command. The SIMON challenge is reading whether a big
    // "SIMON SAYS" appears (obey) or only the tempting "DO THE" fake-out (hold
    // still). MIRROR adds "the opposite". BOTH stacks them: "SIMON SAYS / THE
    // OPPOSITE" vs the trap "DO THE / OPPOSITE" (which reads as "do the opposite").
    if (simon) {
      ctx.font = `bold ${Math.round(cw / 24)}px ${FONT.display}`;
      ctx.fillStyle = rgba(COLORS.sunset, 0.98);
      ctx.fillText(this.obey ? 'SIMON SAYS' : 'DO THE', cw / 2, mirror ? ch * 0.12 : ch * 0.15);
    }
    if (mirror) {
      ctx.font = `${Math.round(cw / (simon ? 40 : 50))}px ${FONT.display}`;
      ctx.fillStyle = rgba(COLORS.magenta, 0.98);
      ctx.fillText(simon ? 'THE OPPOSITE' : 'MAKE THE OPPOSITE OF', cw / 2, simon ? ch * 0.2 : ch * 0.16);
    }
    if (!simon && !mirror) {
      ctx.font = `${Math.round(cw / 50)}px ${FONT.display}`;
      ctx.fillStyle = rgba(COLORS.muted, 0.95);
      ctx.fillText('MAKE THIS SIGN', cw / 2, ch * 0.16);
    }

    // Big target sign (the stimulus). Mirror flips it for flavor.
    ctx.font = `${Math.round(cw / 9)}px ${FONT.mono}`;
    if (mirror) {
      ctx.save();
      ctx.translate(cw / 2, ch * 0.3);
      ctx.scale(-1, 1);
      ctx.fillText(this.shown.emoji, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(this.shown.emoji, cw / 2, ch * 0.3);
    }

    ctx.font = `${Math.round(cw / 34)}px ${FONT.display}`;
    ctx.fillStyle = rgba(COLORS.text, 0.95);
    ctx.fillText(this.shown.name.toUpperCase(), cw / 2, ch * 0.42);

    // Timer bar.
    const t = Math.max(0, this.timeLeft / this.roundTime);
    const barW = cw * 0.4;
    const barH = Math.max(6, ch * 0.014);
    const barX = (cw - barW) / 2;
    const barY = ch * 0.47;
    ctx.fillStyle = rgba(COLORS.text, 0.14);
    ctx.fillRect(barX, barY, barW, barH);
    // Same gradient in every round — a trap must look identical to an obey round.
    ctx.fillStyle = t > 0.5 ? COLORS.teal : t > 0.25 ? COLORS.sunset : COLORS.danger;
    ctx.fillRect(barX, barY, barW * t, barH);

    // Streak + lives.
    ctx.textBaseline = 'bottom';
    ctx.font = `${Math.round(cw / 48)}px ${FONT.display}`;
    ctx.fillStyle = rgba(COLORS.teal, 0.9);
    ctx.fillText(`STREAK ${this.streak}`, cw / 2, ch - ch * 0.12);
    ctx.font = `${Math.round(cw / 40)}px ${FONT.mono}`;
    ctx.fillStyle = COLORS.magenta;
    ctx.fillText('♥'.repeat(this.lives) + '♡'.repeat(START_LIVES - this.lives), cw / 2, ch - ch * 0.05);

    // What the recognizer currently sees — live feedback.
    if (live && live.name !== 'None') {
      ctx.textBaseline = 'top';
      ctx.font = `${Math.round(cw / 70)}px ${FONT.mono}`;
      ctx.fillStyle = rgba(COLORS.muted, 0.85);
      ctx.fillText(`seeing: ${live.name.replace(/_/g, ' ')}  ${(live.score * 100).toFixed(0)}%`, cw / 2, ch * 0.5);
    }

    // Hit / miss flash.
    if (this.feedback) {
      const a = Math.min(1, this.feedback.ms / FEEDBACK_MS);
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(cw / 14)}px ${FONT.display}`;
      const hit = this.feedback.kind === 'hit';
      ctx.fillStyle = rgba(hit ? COLORS.ok : COLORS.danger, a);
      ctx.fillText(hit ? 'NICE!' : 'MISS', cw / 2, ch * 0.66);
    }
    ctx.restore();
  }
}

register(new SimonSays());
