/**
 * The juice manager (Phase 7) — the single front door games and the shell reach
 * for to make the screen feel alive. It owns one particle system, the time-warp
 * clock, the screen-shake trauma, and lists of active flashes/shockwaves, and it
 * exposes them through the plan's named services:
 *
 *   juice.particles.burst({ … })   — sparks / confetti / debris
 *   juice.camera.shake(mag)        — trauma (0..1) → whole-frame jolt
 *   juice.time.freeze(ms)          — freeze-frame
 *   juice.time.slowmo(scale, ms)   — slow-mo
 *   juice.fx.flash(color, peak)    — full-screen color wash (+ chromatic split)
 *   juice.fx.shockwave({ … })      — expanding ring
 *
 * It also *is* the engine's {@link FrameModulator}: the loop reads `timeScale()`
 * and `cameraOffset()` from it each frame. `update()` advances every effect on
 * real wall-clock time (so a freeze pauses the game but not the juice), and
 * `render(ctx)` draws the world-space effects over the game. One shared instance,
 * `juice`, is exported.
 */

import type { FrameModulator } from '../engine/loop';
import { ParticleSystem } from './particles';
import { TimeWarp } from './timewarp';
import { Shake } from './shake';
import { rgba } from '../shell/theme';

interface Flash {
  color: string; // #rrggbb
  ms: number;
  maxMs: number;
  peak: number; // max alpha
}

interface Shockwave {
  x: number;
  y: number;
  r0: number;
  maxR: number;
  ms: number;
  maxMs: number;
  color: string; // #rrggbb
  width: number;
}

export interface ShockwaveOptions {
  x: number;
  y: number;
  color: string;
  maxR: number;
  r0?: number;
  ms?: number;
  width?: number;
}

/** Particle effects are capped low enough that a weak laptop never drops frames. */
const PARTICLE_CAP = 360;
/** Clamp the real dt so a backgrounded tab doesn't fling every particle off-screen. */
const MAX_REAL_DT = 64;

class Juice implements FrameModulator {
  private system = new ParticleSystem(PARTICLE_CAP);
  private warp = new TimeWarp();
  private shaker = new Shake();
  private flashes: Flash[] = [];
  private waves: Shockwave[] = [];
  private lastNow = -1;
  private canvasW = 1280;

  /** Sparks / confetti / debris. See {@link ParticleSystem.burst}. */
  readonly particles = this.system;

  readonly camera = {
    /** Add `mag` (0..1) of shake trauma. */
    shake: (mag: number): void => this.shaker.add(mag),
  };

  readonly time = {
    freeze: (ms: number): void => this.warp.freeze(ms),
    slowmo: (scale: number, ms: number): void => this.warp.slowmo(scale, ms),
  };

  readonly fx = {
    /** Full-screen wash of `color` peaking at `peak` alpha, fading over `ms`. */
    flash: (color: string, peak = 0.3, ms = 320): void => {
      this.flashes.push({ color, peak, ms, maxMs: ms });
    },
    /** An expanding neon ring centered at (x, y) in device px. */
    shockwave: (o: ShockwaveOptions): void => {
      this.waves.push({
        x: o.x,
        y: o.y,
        r0: o.r0 ?? 0,
        maxR: o.maxR,
        ms: o.ms ?? 520,
        maxMs: o.ms ?? 520,
        color: o.color,
        width: o.width ?? Math.max(2, this.canvasW / 220),
      });
    },
  };

  // --- engine FrameModulator ----------------------------------------------

  timeScale(): number {
    return this.warp.scale;
  }

  cameraOffset(): { x: number; y: number } {
    return this.shaker.offset();
  }

  // --- per-frame lifecycle (driven from the engine overlay hook) ----------

  /** Advance every effect on real time. Call once per rendered frame. */
  update(now: number = performance.now()): void {
    const dt = this.lastNow < 0 ? 16 : Math.min(MAX_REAL_DT, now - this.lastNow);
    this.lastNow = now;
    this.warp.update(dt);
    this.shaker.update(dt);
    this.system.update(dt);
    this.flashes = this.flashes.filter((f) => (f.ms -= dt) > 0);
    this.waves = this.waves.filter((w) => (w.ms -= dt) > 0);
  }

  /** Draw the world-space effects (particles, shockwaves, flashes) over the game. */
  render(ctx: CanvasRenderingContext2D): void {
    this.canvasW = ctx.canvas.width;
    // Shake amplitude tracks canvas size so it reads the same at any resolution.
    this.shaker.maxPx = ctx.canvas.width * 0.016;

    this.renderShockwaves(ctx);
    this.renderParticles(ctx);
    this.renderFlashes(ctx);
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    if (this.system.count === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // additive => neon bloom where sparks overlap
    for (const p of this.system.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderShockwaves(ctx: CanvasRenderingContext2D): void {
    if (this.waves.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const w of this.waves) {
      const t = 1 - w.ms / w.maxMs; // 0..1 expansion
      const r = w.r0 + (w.maxR - w.r0) * t;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = w.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderFlashes(ctx: CanvasRenderingContext2D): void {
    if (this.flashes.length === 0) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.save();
    ctx.globalCompositeOperation = 'screen'; // brightens without flattening to a solid wall
    for (const f of this.flashes) {
      const a = f.peak * (f.ms / f.maxMs);
      ctx.fillStyle = rgba(f.color, a);
      ctx.fillRect(0, 0, w, h);
      // Cheap chromatic aberration on the strong flashes: offset red/cyan washes
      // so a crush reads with that glitchy arcade RGB-split, no per-pixel pass.
      if (a > 0.18) {
        const dx = w * 0.004 * (a / f.peak);
        ctx.fillStyle = rgba('#ff2e6e', a * 0.5);
        ctx.fillRect(-dx, 0, w, h);
        ctx.fillStyle = rgba('#2effe6', a * 0.5);
        ctx.fillRect(dx, 0, w, h);
      }
    }
    ctx.restore();
  }

  /** Wipe all active effects — call on scene changes (e.g. starting a run). */
  reset(): void {
    this.system.clear();
    this.warp.reset();
    this.shaker.reset();
    this.flashes.length = 0;
    this.waves.length = 0;
  }
}

/** The one shared juice instance — imported by the games, the shell, and main. */
export const juice = new Juice();
