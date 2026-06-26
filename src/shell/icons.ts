/**
 * Inline SVG icon set (Phase 11 visual-identity pass) — replaces the emoji that
 * were standing in for icons (the biggest "vibe-coded" tell after the palette).
 * Each is a 24×24 stroke icon using `currentColor`, so it inherits the button's
 * color and the theme glow; size it with `font-size` / `width` in CSS.
 *
 * Usage: `el.innerHTML = ICONS.soundOn` (these are trusted, static strings —
 * never interpolate user input into them).
 */

const svg = (paths: string): string =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const ICONS = {
  /** Speaker with waves — audio on. */
  soundOn: svg('<path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  /** Speaker with an X — muted. */
  soundOff: svg('<path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none"/><path d="m16 9 5 6M21 9l-5 6"/>'),
  /** Down-tray — download / save. */
  download: svg('<path d="M12 4v10m0 0 4-4m-4 4-4-4"/><path d="M5 18h14"/>'),
  /** Five-point star — a new record. */
  star: svg('<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7L6.8 19l1-5.8L3.5 9.2l5.9-.9L12 3Z" fill="currentColor" stroke="none"/>'),
  /** Check — a completed/saved action. */
  check: svg('<path d="m5 12 4.5 4.5L19 7"/>'),
  /** Question mark in a circle — "how to play". */
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.4-2.6 4"/><circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none"/>'),
  /** Lightning bolt — the daily challenge. */
  bolt: svg('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" stroke="none"/>'),
} as const;

/** Wrap an SVG icon string for inline placement alongside button text. */
export function iconSpan(name: keyof typeof ICONS): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'icon-wrap';
  span.innerHTML = ICONS[name];
  return span;
}
