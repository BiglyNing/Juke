/**
 * Trauma-based screen shake (Phase 7 juice layer).
 *
 * Follows the well-worn "trauma" model (offset ∝ trauma², so big hits read as
 * violent and the tail decays gracefully to nothing). Pure and headless-testable:
 * `add()` injects trauma, `update(realDt)` decays it on real time and advances an
 * internal phase, and `offset()` reads a deterministic, bounded pixel offset from
 * a couple of out-of-phase sinusoids. The juice manager feeds `offset()` to the
 * engine's {@link FrameModulator} so the whole frame jolts.
 */

const TAU = Math.PI * 2;

export class Shake {
  private trauma = 0;
  private phase = 0;
  /** Max offset (px) at full trauma; the manager scales this to the canvas. */
  maxPx: number;
  private decayPerMs: number;

  constructor(maxPx = 26, recoverMs = 520) {
    this.maxPx = maxPx;
    this.decayPerMs = 1 / recoverMs;
  }

  /** Add `amount` (0..1) of trauma; clamped so it never over-saturates. */
  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(realDt: number): void {
    this.phase += realDt;
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - this.decayPerMs * realDt);
  }

  /** Current offset in px. Zero when no trauma remains. */
  offset(): { x: number; y: number } {
    const s = this.trauma * this.trauma;
    if (s === 0) return { x: 0, y: 0 };
    const amp = s * this.maxPx;
    // Two incommensurate frequencies on x/y so the motion looks chaotic, not orbital.
    return {
      x: amp * Math.sin(this.phase * 0.083 * TAU),
      y: amp * Math.sin(this.phase * 0.061 * TAU + 1.7),
    };
  }

  get active(): boolean {
    return this.trauma > 0;
  }

  reset(): void {
    this.trauma = 0;
  }
}
