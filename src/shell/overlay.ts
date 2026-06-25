/**
 * Full-screen message layer for the title/start prompt and graceful failure
 * screens (camera unavailable, model-load errors). The Phase 5 shell
 * (shell/app.ts + screens.ts) owns the menu, calibration, HUD, and game-over;
 * this layer is what it falls back to for the entry point and hard errors, so
 * the user is never left staring at a frozen canvas with no explanation.
 */

const el = document.getElementById('overlay') as HTMLDivElement;

export interface OverlayAction {
  label: string;
  onClick: () => void;
}

/** A numbered "how to play" step on the branded start screen. */
export interface OverlayStep {
  title: string;
  text: string;
}

interface OverlayOptions {
  title: string;
  body?: string;
  /** Renders the title in the error accent color. */
  error?: boolean;
  /** Renders the title as the big gradient JUKE wordmark (the start screen). */
  brand?: boolean;
  /** Numbered how-to-play steps, shown between the body and the action button. */
  steps?: OverlayStep[];
  action?: OverlayAction;
  /** Small muted footnote under the action (e.g. keyboard hints). */
  note?: string;
}

export function showOverlay({ title, body, error, brand, steps, action, note }: OverlayOptions): void {
  el.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = title;
  if (error) h1.classList.add('error-title');
  if (brand) h1.classList.add('wordmark', 'overlay__brand');
  el.appendChild(h1);

  if (body) {
    const p = document.createElement('p');
    p.textContent = body;
    el.appendChild(p);
  }

  if (steps && steps.length) {
    const list = document.createElement('ol');
    list.className = 'overlay__steps';
    steps.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'overlay__step';
      const num = document.createElement('span');
      num.className = 'overlay__step-n';
      num.textContent = String(i + 1);
      const txt = document.createElement('div');
      const t = document.createElement('b');
      t.textContent = s.title;
      const d = document.createElement('span');
      d.textContent = s.text;
      txt.append(t, d);
      li.append(num, txt);
      list.appendChild(li);
    });
    el.appendChild(list);
  }

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    el.appendChild(btn);
  }

  if (note) {
    const n = document.createElement('p');
    n.className = 'overlay__note';
    n.textContent = note;
    el.appendChild(n);
  }

  el.classList.add('show');
}

export function hideOverlay(): void {
  el.classList.remove('show');
  el.replaceChildren();
}
