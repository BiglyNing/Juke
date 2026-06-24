/**
 * A tiny, allocation-light particle system (Phase 7 juice layer).
 *
 * Deliberately pure — no canvas, no DOM, no `performance.now()` — so the physics
 * is unit-testable headlessly (the same "tested utilities first" discipline as
 * the Phase 2 mask/pose math). Positions are in device pixels, velocities in
 * px/ms, time in ms, matching the engine's fixed `dt`. The juice manager owns the
 * one live system and draws it; games never touch this directly.
 *
 * A hard `cap` bounds the live count so a weak laptop never chokes on a confetti
 * storm — Phase 7's "particle counts are capped" exit criterion lives here.
 */

export interface Particle {
  x: number;
  y: number;
  /** Velocity in px/ms. */
  vx: number;
  vy: number;
  /** Remaining life and original life (ms) — alpha fades with life/maxLife. */
  life: number;
  maxLife: number;
  /** Radius in px. */
  size: number;
  /** Canvas fill string (already resolved, e.g. an rgba()). */
  color: string;
  /** Downward acceleration in px/ms² (0 = floaty spark, >0 = falling debris). */
  gravity: number;
  /** Velocity retained per ms, in [0, 1] — 1 = frictionless, <1 = air drag. */
  drag: number;
}

export interface BurstOptions {
  x: number;
  y: number;
  /** Number of particles to *try* to spawn (clamped to remaining capacity). */
  count: number;
  color: string;
  /** Mean ejection speed (px/ms); each particle randomizes ±50% around it. */
  speed?: number;
  /** Mean lifetime (ms); randomized ±40%. */
  life?: number;
  size?: number;
  gravity?: number;
  drag?: number;
  /** Emission cone center (radians) and half-width; default is a full circle. */
  angle?: number;
  spread?: number;
  /** Injectable RNG for deterministic tests; defaults to Math.random. */
  rng?: () => number;
}

export class ParticleSystem {
  readonly particles: Particle[] = [];
  private cap: number;

  constructor(cap = 400) {
    this.cap = cap;
  }

  get count(): number {
    return this.particles.length;
  }

  /** Spawn a radial burst, never exceeding the capacity cap. */
  burst(opts: BurstOptions): void {
    const rng = opts.rng ?? Math.random;
    const speed = opts.speed ?? 0.25;
    const life = opts.life ?? 700;
    const size = opts.size ?? 3;
    const gravity = opts.gravity ?? 0;
    const drag = opts.drag ?? 0.985;
    const angle = opts.angle ?? 0;
    const spread = opts.spread ?? Math.PI; // half-cone; PI => full circle
    const n = Math.min(opts.count, Math.max(0, this.cap - this.particles.length));
    for (let i = 0; i < n; i++) {
      const a = angle + (rng() * 2 - 1) * spread;
      const sp = speed * (0.5 + rng());
      const lf = life * (0.6 + rng() * 0.8);
      this.particles.push({
        x: opts.x,
        y: opts.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: lf,
        maxLife: lf,
        size: size * (0.6 + rng() * 0.8),
        color: opts.color,
        gravity,
        drag,
      });
    }
  }

  /** Integrate one step of `dt` ms and cull dead particles in place. */
  update(dt: number): void {
    const ps = this.particles;
    // Per-ms drag compounded over dt keeps motion frame-rate independent.
    let w = 0;
    for (let r = 0; r < ps.length; r++) {
      const p = ps[r];
      p.life -= dt;
      if (p.life <= 0) continue; // drop it (don't copy forward)
      p.vy += p.gravity * dt;
      const d = Math.pow(p.drag, dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ps[w++] = p; // compact survivors toward the front
    }
    ps.length = w;
  }

  clear(): void {
    this.particles.length = 0;
  }
}
