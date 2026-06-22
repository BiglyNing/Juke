/**
 * Minimal full-screen message layer for the start prompt, loading states, and
 * graceful failure screens. Phase 5 replaces/extends this with the real menu +
 * state machine; for now it just needs to never leave the user staring at a
 * frozen canvas with no explanation.
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
