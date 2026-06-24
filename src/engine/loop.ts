/**
 * The engine loop (Phase 3): a fixed-timestep update + render driving whichever
 * game occupies the single "active game" slot, fed by whichever {@link Producer}
 * is set. Swapping games or swapping a live camera for a replayed fixture are
 * each one call (`setActiveGame` / `setProducer`).
 *
 * Fixed timestep keeps simulation deterministic and frame-rate independent: we
 * accumulate real elapsed time and step `update` in fixed `FIXED_STEP_MS` chunks,
 * then render once with the latest perception frame.
 */

import type { Producer } from './producer';
import { getGame, type JukeGame } from './game';
import type { PerceptionFrame } from './frame';

/** Fixed simulation step (ms) — games advance by exactly this per `update`. */
export const FIXED_STEP_MS = 1000 / 60;
/** Cap accumulated time so a stall can't trigger a death-spiral of catch-up steps. */
const MAX_ACCUMULATED_MS = 250;

/** Shared zero offset so the no-shake path allocates nothing per frame. */
const ZERO_OFFSET = { x: 0, y: 0 } as const;

export interface FrameStats {
  now: number;
  fps: number;
  inferenceMs: number;
}

/** Called after the active game renders — the shell draws HUD/debug here. */
export type OverlayFn = (
  ctx: CanvasRenderingContext2D,
  frame: PerceptionFrame | null,
  stats: FrameStats,
) => void;

/**
 * An optional, game-agnostic seam (Phase 7) for the juice layer to bend time and
 * shake the camera without the engine knowing what juice *is*. The juice manager
 * implements this; the engine just multiplies the simulation `dt` by `timeScale`
 * (so `0` = freeze-frame, `<1` = slow-mo) and translates the whole rendered frame
 * by `cameraOffset` (screen shake). With no modulator wired, the loop behaves
 * exactly as before (scale 1, zero offset).
 */
export interface FrameModulator {
  /** Multiplier applied to game-update time. 1 = normal, 0 = frozen, <1 = slow-mo. */
  timeScale(): number;
  /** Per-frame screen-shake offset in device pixels. */
  cameraOffset(): { x: number; y: number };
}

export class Engine {
  private ctx: CanvasRenderingContext2D;
  private overlay?: OverlayFn;
  private modulator?: FrameModulator;
  private producer: Producer | null = null;
  private game: JukeGame | null = null;
  private accumulator = 0;
  private last = performance.now();
  private fps = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, overlay?: OverlayFn, modulator?: FrameModulator) {
    this.ctx = canvas.getContext('2d')!;
    this.overlay = overlay;
    this.modulator = modulator;
  }

  /** Swap the frame source (live camera ⇄ fixture replay). Caller owns the old producer's lifetime. */
  setProducer(producer: Producer | null): void {
    this.producer = producer;
    this.accumulator = 0;
  }

  /**
   * Make `id` the active game: ensure its perception needs are loaded, then
   * reset + init it. This is the "swapping the active game is a one-line change".
   */
  async setActiveGame(id: string): Promise<void> {
    const next = getGame(id);
    if (!next) throw new Error(`No game registered with id "${id}"`);
    if (this.producer) await this.producer.ensureNeeds(next.needs);
    next.reset();
    next.init();
    this.game = next;
    this.accumulator = 0;
  }

  /** Empty the active-game slot (e.g. returning to the menu). */
  clearActiveGame(): void {
    this.game = null;
    this.accumulator = 0;
  }

  start(): void {
    this.last = performance.now();
    const tick = (now: number): void => {
      // The whole frame is wrapped so a single throw (a game bug, a juice/audio
      // glitch on some browser) can never kill the RAF loop and freeze the app —
      // we log it and keep going. Vital for a "works first-try on a stranger's
      // machine" arcade. The next frame is always scheduled in `finally`.
      try {
        this.step(now);
      } catch (err) {
        console.error('[engine] frame error (recovering):', err);
      } finally {
        this.raf = requestAnimationFrame(tick);
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** One frame: advance fps, pull perception, step the sim, render game + overlay. */
  private step(now: number): void {
    const real = now - this.last;
    this.last = now;
    this.fps = this.fps === 0 ? 1000 / real : this.fps * 0.9 + (1000 / real) * 0.1;

    const frame = this.producer ? this.producer.produce(now) : null;

    // The juice layer can scale simulation time (freeze / slow-mo). Real frame
    // time still drives the juice clock itself (in the overlay) — only the game
    // update is bent, so a freeze pauses gameplay while effects keep animating.
    const scale = this.modulator?.timeScale() ?? 1;
    if (frame && this.game) {
      this.accumulator = Math.min(this.accumulator + frame.dt * scale, MAX_ACCUMULATED_MS);
      while (this.accumulator >= FIXED_STEP_MS) {
        this.game.update(frame, FIXED_STEP_MS);
        this.accumulator -= FIXED_STEP_MS;
      }
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // Screen shake: translate the whole rendered frame (game + juice overlay)
    // by the modulator's offset, so a crush physically jolts the scene.
    const off = this.modulator?.cameraOffset() ?? ZERO_OFFSET;
    const shaking = off.x !== 0 || off.y !== 0;
    if (shaking) {
      ctx.save();
      ctx.translate(off.x, off.y);
    }
    if (frame && this.game) this.game.render(ctx, frame);
    this.overlay?.(ctx, frame, {
      now,
      fps: this.fps,
      inferenceMs: this.producer?.inferenceMs ?? 0,
    });
    if (shaking) ctx.restore();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}
