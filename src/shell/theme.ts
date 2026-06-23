/**
 * Design tokens — the single source of truth for Juke's visual identity
 * (Phase 5 "set the look once, here"). Direction: **CRT vaporwave** — deep
 * indigo, teal/magenta/sunset neon, scanlines, retro display type.
 *
 * These JS tokens mirror the CSS custom properties in `style.css` one-for-one.
 * The DOM reads the CSS vars; canvas-drawn UI (HUD, calibration, countdown)
 * reads from here so both stay in lockstep. Change a value in both places.
 */

/** Owned palette — intentionally NOT the stock cyan/magenta neon defaults. */
export const COLORS = {
  base: '#0c0a1c', // darkest backdrop
  bg: '#14122b', // app background (deep indigo)
  surface: '#1d1a3a', // panels / cards
  surfaceHi: '#2a2552', // raised / hover
  teal: '#2ee6c8', // primary
  magenta: '#ff4fd8', // accent
  sunset: '#ff9f45', // warm secondary
  text: '#eae6ff', // soft lavender-white
  muted: '#9b93c9', // secondary text
  ok: '#5cf0a8', // success (calibration check, clean pass)
  warn: '#ffc24b', // caution (framing not ready)
  danger: '#ff4f7e', // failure (squashed, errors)
} as const;

/** One webfont pair: a retro display face + a mono for UI/figures. */
export const FONT = {
  display: "'Orbitron', 'Chakra Petch', system-ui, sans-serif",
  mono: "'Space Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
} as const;

/** Motion language — durations (ms) and easings shared by DOM + canvas tweens. */
export const MOTION = {
  fast: 120,
  med: 240,
  slow: 420,
} as const;

/** Standard "ease-out" (matches the CSS `--ease-out` curve closely enough). */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** Symmetric ease-in-out, for pulses that grow and settle. */
export function easeInOut(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** `rgba()` string from a `#rrggbb` token + alpha — for canvas fills/strokes. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
