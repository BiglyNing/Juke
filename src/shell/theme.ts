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

// Motion tokens (easing curves + durations) live only in `style.css`
// (`--ease-*` / `--dur-*`) since today every animation is CSS-driven. When the
// juice layer (Phase 7) starts tweening on the canvas, add the shared easing
// helpers here so DOM and canvas motion stay in lockstep — see the "Future
// directions" appendix in IMPLEMENTATION.md.

/** `rgba()` string from a `#rrggbb` token + alpha — for canvas fills/strokes. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
