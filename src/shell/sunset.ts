/**
 * Vaporwave-sunset backdrop — the shared idle background for every non-gameplay
 * surface (title / menu / game-over). One animated scene so the whole shell reads
 * as a single CRT-vaporwave sunset rather than a patchwork of radial glows:
 *
 *   sky      — a vertical indigo → purple → magenta → sunset ramp (dark at the
 *              top so headings stay legible, warm at the horizon).
 *   sun      — a banded retro sun sitting on the horizon, the slits cut by
 *              re-painting the sky gradient over its lower half.
 *   grid     — a neon perspective floor that scrolls toward the viewer, the
 *              "endless drive into the sunset" motif.
 *
 * Pure canvas drawing in device pixels, driven off wall-clock `now` (so it keeps
 * moving regardless of the sim clock). `Shell.drawIdle` calls this each frame,
 * then layers the attract figure on top. The DOM screens (style.css) sit over it
 * with a light readability scrim, so this animated sunset shows through them; the
 * matching static ramp lives in `--sunset-*` there for the body / letterbox.
 */

import { COLORS, rgba } from './theme';

const HORIZON = 0.7; // fraction of the canvas height where sky meets ground

/** Paint the full sunset scene into `(w, h)` (device px) for wall-clock `now`. */
export function drawSunset(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void {
  const horizon = Math.round(h * HORIZON);
  const pulse = 0.5 + 0.5 * Math.sin(now / 1400);

  drawSky(ctx, w, horizon);
  drawSun(ctx, w, horizon, h, pulse);
  drawGround(ctx, w, horizon, h);
  drawGrid(ctx, now, w, horizon, h);
  drawHorizonGlow(ctx, w, horizon, pulse);
}

/** The sky ramp: deep indigo up top, warming through magenta to a sunset horizon. */
function drawSky(ctx: CanvasRenderingContext2D, w: number, horizon: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0.0, COLORS.base); // darkest at the top — keeps headings readable
  sky.addColorStop(0.42, COLORS.bg); // deep indigo
  sky.addColorStop(0.7, '#371a4d'); // purple
  sky.addColorStop(0.86, '#8a2b63'); // magenta-rose
  sky.addColorStop(0.95, '#d83f8f'); // hot pink
  sky.addColorStop(1.0, COLORS.sunset); // warm horizon band
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);
}

/**
 * The retro sun: a vertical-gradient disc on the horizon, sliced by horizontal
 * bands. The bands are cut by re-painting the sky gradient (same coordinates, so
 * it lines up exactly) over the disc's lower half — the classic "background shows
 * through" sunset sun.
 */
function drawSun(ctx: CanvasRenderingContext2D, w: number, horizon: number, h: number, pulse: number): void {
  const cx = w / 2;
  const r = Math.min(w, h) * 0.2;
  const cy = horizon; // bottom half dips below the horizon (hidden by the ground)

  // Soft glow halo behind the disc.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.1);
  halo.addColorStop(0, rgba(COLORS.sunset, 0.35 + pulse * 0.12));
  halo.addColorStop(0.5, rgba(COLORS.magenta, 0.12));
  halo.addColorStop(1, rgba(COLORS.sunset, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(cx - r * 2.1, cy - r * 2.1, r * 4.2, r * 2.1);

  // The disc — warm top fading to magenta at the base.
  const disc = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  disc.addColorStop(0, '#ffd27a');
  disc.addColorStop(0.5, COLORS.sunset);
  disc.addColorStop(1, COLORS.magenta);
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Slits: restore the sky in widening horizontal bands across the lower disc, so
  // the sun reads as stacked bars. Re-using the sky gradient keeps the cuts the
  // exact color of the sky behind the sun.
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0.0, COLORS.base);
  sky.addColorStop(0.42, COLORS.bg);
  sky.addColorStop(0.7, '#371a4d');
  sky.addColorStop(0.86, '#8a2b63');
  sky.addColorStop(0.95, '#d83f8f');
  sky.addColorStop(1.0, COLORS.sunset);
  ctx.fillStyle = sky;
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const t = i / bands; // 0 (mid-disc) → 1 (horizon)
    const bandY = cy - r * 0.45 + t * (r * 0.45);
    const thickness = r * (0.04 + t * 0.09); // wider toward the horizon
    ctx.fillRect(cx - r, bandY, r * 2, thickness);
  }
}

/** The ground plane: a warm reflection under the horizon fading to dark indigo. */
function drawGround(ctx: CanvasRenderingContext2D, w: number, horizon: number, h: number): void {
  const ground = ctx.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, rgba(COLORS.sunset, 0.5));
  ground.addColorStop(0.16, '#2a1330');
  ground.addColorStop(1, COLORS.base);
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, w, h - horizon);
}

/**
 * Neon perspective floor: horizontal rows that bunch toward the horizon and
 * scroll toward the viewer, plus verticals fanning out from the vanishing point.
 * Drawn additively for a glow, and clipped to the ground so it never bleeds into
 * the sky.
 */
function drawGrid(ctx: CanvasRenderingContext2D, now: number, w: number, horizon: number, h: number): void {
  const vpX = w / 2;
  const depth = h - horizon;
  const line = Math.max(1, w / 900);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizon, w, depth);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = line;

  // Verticals converging on the vanishing point.
  const cols = 12;
  ctx.strokeStyle = rgba(COLORS.teal, 0.18);
  ctx.shadowColor = rgba(COLORS.teal, 0.5);
  ctx.shadowBlur = line * 2;
  for (let i = -cols; i <= cols; i++) {
    const xb = vpX + (i / cols) * w * 1.5; // fan wide at the bottom edge
    ctx.beginPath();
    ctx.moveTo(vpX, horizon);
    ctx.lineTo(xb, h);
    ctx.stroke();
  }

  // Horizontals: t² spacing bunches them near the horizon; the scroll phase walks
  // them down toward the viewer on a loop.
  const rows = 13;
  const phase = (now / 2600) % 1;
  for (let i = 0; i < rows; i++) {
    const t = (i + phase) / rows; // 0 (horizon) → 1 (foreground)
    const y = horizon + depth * t * t;
    const a = 0.05 + 0.22 * t; // brighter as it nears the viewer
    ctx.strokeStyle = rgba(i % 3 === 0 ? COLORS.magenta : COLORS.teal, a);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** A bright pulsing seam where the sun meets the floor. */
function drawHorizonGlow(ctx: CanvasRenderingContext2D, w: number, horizon: number, pulse: number): void {
  const band = Math.max(2, horizon * 0.02);
  const glow = ctx.createLinearGradient(0, horizon - band, 0, horizon + band);
  glow.addColorStop(0, rgba(COLORS.sunset, 0));
  glow.addColorStop(0.5, rgba(COLORS.sunset, 0.55 + pulse * 0.25));
  glow.addColorStop(1, rgba(COLORS.sunset, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon - band, w, band * 2);
  ctx.restore();
}
