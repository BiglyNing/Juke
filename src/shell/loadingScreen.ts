/**
 * Model-load screen with personality (Phase 5).
 *
 * The 2–3 s MediaPipe download is the worst first impression in the app — a
 * stranger on the live link sees a frozen page. This covers it with a branded,
 * always-moving loading state: a pulsing JUKE wordmark with a sweeping
 * highlight (CSS-animated, so it keeps moving even while the main thread is busy
 * initializing the model), an indeterminate progress bar, and rotating tips.
 *
 * Pure DOM + CSS (styles live in `style.css` under `.loader`). Reused by the
 * shell's `loading` state once Phase 5's state machine lands.
 */

const TIPS: string[] = [
  'Stand back <b>~6&nbsp;ft</b> so your whole body fits in frame.',
  'Face a window or light — even, front lighting reads best.',
  'A <b>plain background</b> helps the camera find your silhouette.',
  'Your body is the controller. No mouse, no keyboard.',
  'Hand Simon-Says works <b>seated</b> — just show your hand.',
  'Everything runs on your machine. The video never leaves it.',
];

const TIP_MS = 2600;

let root: HTMLDivElement | null = null;
let tipEl: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;
let timer = 0;
let tipIndex = 0;

function build(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'loader';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  const logo = document.createElement('div');
  logo.className = 'loader__logo wordmark';
  logo.textContent = 'JUKE';

  const bar = document.createElement('div');
  bar.className = 'loader__bar';

  const tip = document.createElement('p');
  tip.className = 'loader__tip';

  const label = document.createElement('div');
  label.className = 'loader__label';
  label.textContent = 'Warming up the camera AI…';

  el.append(logo, bar, tip, label);
  document.body.appendChild(el);

  root = el;
  tipEl = tip;
  labelEl = label;
  return el;
}

function rotateTip(): void {
  if (!tipEl) return;
  tipEl.style.opacity = '0';
  window.setTimeout(() => {
    if (!tipEl) return;
    tipIndex = (tipIndex + 1) % TIPS.length;
    tipEl.innerHTML = TIPS[tipIndex];
    tipEl.style.opacity = '1';
  }, 240);
}

/** Show the loading screen. `label` overrides the small status line. */
export function showLoadingScreen(label?: string): void {
  const el = root ?? build();
  if (label && labelEl) labelEl.textContent = label;
  tipIndex = Math.floor(Math.random() * TIPS.length);
  if (tipEl) {
    tipEl.innerHTML = TIPS[tipIndex];
    tipEl.style.opacity = '1';
  }
  el.classList.add('show');
  window.clearInterval(timer);
  timer = window.setInterval(rotateTip, TIP_MS);
}

export function hideLoadingScreen(): void {
  window.clearInterval(timer);
  timer = 0;
  root?.classList.remove('show');
}
