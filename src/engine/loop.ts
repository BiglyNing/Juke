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

export class Engine {
  private ctx: CanvasRenderingContext2D;
  private overlay?: OverlayFn;
  private producer: Producer | null = null;
  private game: JukeGame | null = null;
  private accumulator = 0;
  private last = performance.now();
  private fps = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, overlay?: OverlayFn) {
    this.ctx = canvas.getContext('2d')!;
    this.overlay = overlay;
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

  get activeGame(): JukeGame | null {
    return this.game;
  }

  start(): void {
    this.last = performance.now();
    const tick = (now: number): void => {
      const real = now - this.last;
      this.last = now;
      this.fps = this.fps === 0 ? 1000 / real : this.fps * 0.9 + (1000 / real) * 0.1;

      const frame = this.producer ? this.producer.produce(now) : null;

      if (frame && this.game) {
        this.accumulator = Math.min(this.accumulator + frame.dt, MAX_ACCUMULATED_MS);
        while (this.accumulator >= FIXED_STEP_MS) {
          this.game.update(frame, FIXED_STEP_MS);
          this.accumulator -= FIXED_STEP_MS;
        }
      }

      const ctx = this.ctx;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      if (frame && this.game) this.game.render(ctx, frame);
      this.overlay?.(ctx, frame, {
        now,
        fps: this.fps,
        inferenceMs: this.producer?.inferenceMs ?? 0,
      });

      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}
