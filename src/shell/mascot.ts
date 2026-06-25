/**
 * Bit — the Juke mascot (Phase 11). A tiny neon arcade-screen character that
 * fills the reserved corner slot and *reacts*: it idle-bobs on the menu, hops
 * and grins when your score climbs, and winces (with a shake) when your run
 * frays. That's the P11 exit criterion — "the mascot reacts in at least one
 * game" — met without touching any game code: the shell drives it from the same
 * HUD score/health updates the games already emit.
 *
 * Pure DOM + inline SVG (three swappable faces); styles live in `style.css`
 * under `.mascot`. Honours `prefers-reduced-motion` via CSS.
 */

type Mood = 'idle' | 'cheer' | 'wince';

// Three faces on one 48×48 arcade-screen body. `currentColor` (set per-mood by
// CSS) tints the whole creature, so a cheer glows green and a wince glows red.
function face(mood: Mood): string {
  const body =
    '<rect x="9" y="11" width="30" height="28" rx="10" fill="rgba(29,26,58,0.85)"/>' +
    '<line x1="24" y1="11" x2="24" y2="6"/><circle cx="24" cy="5" r="1.7" fill="currentColor" stroke="none"/>';
  const eyes = {
    idle: '<circle cx="19" cy="23" r="2.4" fill="currentColor" stroke="none"/><circle cx="29" cy="23" r="2.4" fill="currentColor" stroke="none"/>',
    cheer: '<path d="M16 24q3-4 6 0"/><path d="M26 24q3-4 6 0"/>',
    wince: '<path d="M16 21l5 3-5 3"/><path d="M32 21l-5 3 5 3"/>',
  }[mood];
  const mouth = {
    idle: '<path d="M19.5 31q4.5 2.5 9 0"/>',
    cheer: '<path d="M18 30q6 6 12 0Z" fill="currentColor" stroke="none"/>',
    wince: '<path d="M19.5 33.5q4.5-3 9 0"/>',
  }[mood];
  return (
    `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}${eyes}${mouth}</svg>`
  );
}

let root: HTMLDivElement | null = null;
let revertTimer = 0;

function build(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'mascot mood-idle';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = face('idle');
  document.body.appendChild(el);
  root = el;
  return el;
}

/** Set the face + glow + reaction animation; transient moods auto-revert to idle. */
function setMood(mood: Mood, holdMs = 0): void {
  const el = root ?? build();
  window.clearTimeout(revertTimer);
  el.classList.remove('mood-idle', 'mood-cheer', 'mood-wince');
  el.classList.add(`mood-${mood}`);
  el.innerHTML = face(mood);
  // Restart the per-mood animation by forcing a reflow.
  el.classList.remove('react');
  void el.offsetWidth;
  if (mood !== 'idle') el.classList.add('react');
  if (holdMs > 0) {
    revertTimer = window.setTimeout(() => setMood('idle'), holdMs);
  }
}

export const mascot = {
  show(): void {
    (root ?? build()).classList.add('show');
  },
  hide(): void {
    root?.classList.remove('show');
  },
  idle(): void {
    setMood('idle');
  },
  /** A brief grin + hop — a good run beat. */
  cheer(): void {
    setMood('cheer', 850);
  },
  /** A brief wince + shake — something clipped you. */
  wince(): void {
    setMood('wince', 700);
  },
};
