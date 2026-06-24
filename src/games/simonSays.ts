/**
 * Hand Simon-Says (Phase 6) — the seated, laptop-friendly second mode.
 *
 * The lowest-friction game for an online reviewer: no standing, no clearing
 * space, just a hand at the laptop. It flashes a target hand-sign; you have a
 * (shrinking) window to make it. Match → score + streak + faster tempo; let the
 * timer run out → lose a life; out of lives → the shell's GAME OVER.
 *
 * Easy tier: targets are MediaPipe's built-in gesture labels, matched directly
 * against `frame.gestures` (the Gesture Recognizer's top label). No landmark
 * grading yet — the rich tier (arbitrary poses) is deferred to Phase 11.
 *
 * Lifecycle: written to the Phase 5 shell contract just like Hole-in-the-Wall —
 *   waiting → play → dead. The shell runs the seated calibration ("show your
 *   hand") and the countdown; `configure()` is the shell's "begin now" signal.
 */

import { register, type JukeGame, type Need, type Intensity } from '../engine/game';
import type { PerceptionFrame } from '../engine/frame';
import { perceptionRect, drawCameraFeed, drawHandSkeleton } from '../render/perception';
import { juice } from '../juice/juice';
import { audio } from '../juice/audio';
import { COLORS, FONT, rgba } from '../shell/theme';

interface Sign {
  /** MediaPipe Gesture Recognizer label. */
  label: string;
  name: string;
  emoji: string;
}

const SIGNS: Sign[] = [
  { label: 'Open_Palm', name: 'Open Palm', emoji: '✋' },
  { label: 'Closed_Fist', name: 'Fist', emoji: '✊' },
  { label: 'Victory', name: 'Peace', emoji: '✌️' },
  { label: 'Thumb_Up', name: 'Thumbs Up', emoji: '👍' },
  { label: 'Thumb_Down', name: 'Thumbs Down', emoji: '👎' },
  { label: 'Pointing_Up', name: 'Point Up', emoji: '☝️' },
  { label: 'ILoveYou', name: 'Rock On', emoji: '🤟' },
];

const START_LIVES = 3;
const BASE_ROUND_MS = 3500;
const MIN_ROUND_MS = 1400;
const RAMP_MS = 130; // shaved off the round timer per point of streak
const MATCH_SCORE = 0.5; // recognizer confidence required to count
const FEEDBACK_MS = 480;

type Phase = 'waiting' | 'play' | 'dead';

class SimonSays implements JukeGame {
  readonly id = 'simonSays';
  readonly title = 'Hand Simon-Says';
  readonly needs: Need[] = ['hands'];
  readonly intensity: Intensity = 'seated';

  private phase: Phase = 'waiting';
  private target: Sign = SIGNS[0];
  private timeLeft = 0;
  private roundTime = BASE_ROUND_MS;
  /** A round only counts once the player isn't already holding the target sign. */
  private armed = false;
  private scoreValue = 0;
  private streak = 0;
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
    this.lives = START_LIVES;
    this.feedback = null;
    this.armed = false;
    this.pendingFx = null;
  }

  /** The shell's "begin the run" signal (after seated calibration + countdown). */
  configure(): void {
    this.scoreValue = 0;
    this.streak = 0;
    this.lives = START_LIVES;
    this.feedback = null;
    this.pendingFx = null;
    // First target avoids Open Palm, since seated calibration just had the player
    // show an open hand — otherwise round 1 could auto-complete.
    this.target = this.pickSign('Open_Palm');
    this.roundTime = BASE_ROUND_MS;
    this.timeLeft = BASE_ROUND_MS;
    this.armed = false;
    this.phase = 'play';
  }

  update(frame: PerceptionFrame, dt: number): void {
    if (this.phase !== 'play') return;

    if (this.feedback) {
      this.feedback.ms -= dt;
      if (this.feedback.ms <= 0) this.feedback = null;
    }

    const g = frame.gestures && frame.gestures.length > 0 ? frame.gestures[0] : null;
    const cur = g?.name ?? 'None';
    if (!this.armed && (cur === 'None' || cur !== this.target.label)) this.armed = true;

    if (this.armed && g !== null && g.name === this.target.label && g.score >= MATCH_SCORE) {
      this.scoreValue++;
      this.streak++;
      this.feedback = { kind: 'hit', ms: FEEDBACK_MS };
      this.pendingFx = 'hit';
      this.nextRound();
      return;
    }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.lives--;
      this.streak = 0;
      this.feedback = { kind: 'miss', ms: FEEDBACK_MS };
      if (this.lives <= 0) {
        this.phase = 'dead';
        this.pendingFx = 'dead';
      } else {
        this.pendingFx = 'miss';
        this.nextRound();
      }
    }
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

  private nextRound(): void {
    this.target = this.pickSign(this.target.label);
    this.roundTime = Math.max(MIN_ROUND_MS, BASE_ROUND_MS - this.streak * RAMP_MS);
    this.timeLeft = this.roundTime;
    this.armed = false;
  }

  private pickSign(avoid?: string): Sign {
    let s = SIGNS[Math.floor(Math.random() * SIGNS.length)];
    for (let i = 0; avoid && s.label === avoid && i < 12; i++) {
      s = SIGNS[Math.floor(Math.random() * SIGNS.length)];
    }
    return s;
  }

  score(): number {
    return this.scoreValue;
  }

  /** Lives as 0..1 — the shell HUD renders this as a crack meter. */
  health(): number {
    return Math.max(0, this.lives) / START_LIVES;
  }

  isOver(): boolean {
    return this.phase === 'dead';
  }

  // --- rendering -----------------------------------------------------------

  render(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void {
    const rect = perceptionRect(ctx, frame);
    const playing = this.phase === 'play';
    if (frame.video) drawCameraFeed(ctx, frame.video, rect, playing ? 0.55 : 0.8);

    const g = frame.gestures && frame.gestures.length > 0 ? frame.gestures[0] : null;
    const matching = playing && this.armed && g?.name === this.target.label && g.score >= MATCH_SCORE;
    const hand = frame.hands && frame.hands.length > 0 ? frame.hands[0] : null;
    if (hand) {
      drawHandSkeleton(ctx, hand, rect, matching ? COLORS.ok : COLORS.teal);
    }

    // Fire queued juice at the hand (palm landmark) if visible, else screen center.
    if (this.pendingFx) {
      const palm = hand?.[9];
      const x = palm ? rect.x + (1 - palm.x) * rect.w : ctx.canvas.width / 2;
      const y = palm ? rect.y + palm.y * rect.h : ctx.canvas.height / 2;
      this.fireFx(x, y, ctx.canvas.width);
    }

    if (playing) this.drawRound(ctx, g);
  }

  private drawRound(ctx: CanvasRenderingContext2D, live: { name: string; score: number } | null): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.save();
    ctx.textAlign = 'center';

    // Prompt label + big target sign.
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(cw / 60)}px ${FONT.display}`;
    ctx.fillStyle = rgba(COLORS.muted, 0.95);
    ctx.fillText('MAKE THIS SIGN', cw / 2, ch * 0.16);

    ctx.font = `${Math.round(cw / 9)}px ${FONT.mono}`;
    ctx.fillText(this.target.emoji, cw / 2, ch * 0.3);

    ctx.font = `${Math.round(cw / 34)}px ${FONT.display}`;
    ctx.fillStyle = rgba(COLORS.text, 0.95);
    ctx.fillText(this.target.name.toUpperCase(), cw / 2, ch * 0.42);

    // Timer bar.
    const t = Math.max(0, this.timeLeft / this.roundTime);
    const barW = cw * 0.4;
    const barH = Math.max(6, ch * 0.014);
    const barX = (cw - barW) / 2;
    const barY = ch * 0.47;
    ctx.fillStyle = rgba(COLORS.text, 0.14);
    ctx.fillRect(barX, barY, barW, barH);
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
