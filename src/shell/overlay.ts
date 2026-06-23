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

interface OverlayOptions {
  title: string;
  body?: string;
  /** Renders the title in the error accent color. */
  error?: boolean;
  action?: OverlayAction;
}

export function showOverlay({ title, body, error, action }: OverlayOptions): void {
  el.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = title;
  if (error) h1.classList.add('error-title');
  el.appendChild(h1);

  if (body) {
    const p = document.createElement('p');
    p.textContent = body;
    el.appendChild(p);
  }

  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    el.appendChild(btn);
  }

  el.classList.add('show');
}

export function hideOverlay(): void {
  el.classList.remove('show');
  el.replaceChildren();
}
