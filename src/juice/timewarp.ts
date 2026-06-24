/**
 * Time-warp clock for the juice layer (Phase 7): freeze-frames and slow-mo.
 *
 * Pure and headless-testable — it just tracks two countdown timers in *real* ms
 * and reports the resulting `scale`. The engine multiplies its fixed simulation
 * `dt` by that scale (see {@link FrameModulator} in engine/loop.ts), so:
 *   - `freeze(ms)` → scale 0 → gameplay pauses (the crush "freeze-frame"),
 *   - `slowmo(s, ms)` → scale s → time crawls (a clean-pass slow-mo),
 *   - otherwise → scale 1.
 * Freeze always wins over slow-mo while it's active. Timers advance on real time
 * so the effect lasts a wall-clock duration regardless of the simulation pause.
 */

export class TimeWarp {
  private freezeMs = 0;
  private slowMs = 0;
  private slowScale = 1;

  /** Hold the simulation still for `ms` (longest pending freeze wins). */
  freeze(ms: number): void {
    this.freezeMs = Math.max(this.freezeMs, ms);
  }

  /** Run the simulation at `scale` (0..1) for `ms`. */
  slowmo(scale: number, ms: number): void {
    if (ms <= this.slowMs && scale >= this.slowScale) return;
    this.slowScale = scale;
    this.slowMs = Math.max(this.slowMs, ms);
  }

  /** Advance both timers by `realDt` ms (call once per rendered frame). */
  update(realDt: number): void {
    if (this.freezeMs > 0) this.freezeMs = Math.max(0, this.freezeMs - realDt);
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - realDt);
  }

  /** Current simulation-time multiplier. */
  get scale(): number {
    if (this.freezeMs > 0) return 0;
    if (this.slowMs > 0) return this.slowScale;
    return 1;
  }

  reset(): void {
    this.freezeMs = 0;
    this.slowMs = 0;
    this.slowScale = 1;
  }
}
