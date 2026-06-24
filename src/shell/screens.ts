/**
 * Shell DOM screens (Phase 5): the arcade menu, the calibration panel, the
 * countdown, the in-run HUD, and the game-over screen. All built from the
 * design-system components in `style.css` (`.card`, `.btn`, `.wordmark`, …) so
 * the shell never reaches for framework/browser defaults.
 *
 * These layer *over* the canvas — calibration and countdown are click-through
 * (you see the live silhouette behind them); the menu and game-over capture
 * input. The state machine in `app.ts` decides which is shown; this module just
 * builds/toggles the DOM and exposes a few `update…` setters for per-frame data.
 */

export interface MenuCard {
  id: string;
  title: string;
  intensity: 'standing' | 'seated';
  blurb: string;
  /** All-time best for this game (Phase 8), shown when > 0. */
  best?: number;
}

export interface CalibView {
  intensity: 'standing' | 'seated';
  heading: string;
  hint: string;
  checks: { label: string; ok: boolean }[];
  /** 0..1 calibration progress. */
  progress: number;
  /** All required parts framed — show the green "ready" state. */
  ready: boolean;
}

export interface GameOverView {
  title: string;
  score: number;
  /** All-time best to show under the score (Phase 8); `isRecord` flags a new best. */
  best?: { value: number; isRecord: boolean };
  onRetry: () => void;
  onMenu: () => void;
  /** When present, the screen loops the replay clip in the preview + a "Save clip" button (Phase 7). */
  clip?: { onSave: () => void };
  /** When present, a "Save image" button exports the PNG share card (Phase 8). */
  share?: { onSave: () => void };
}

// One root layer for all lifecycle screens, between the message overlay (z 40)
// and the CRT overlay (z 100).
let rootEl: HTMLDivElement | null = null;

let menuEl: HTMLDivElement | null = null;
let calibEl: HTMLDivElement | null = null;
let calibChecks: HTMLElement[] = [];
let calibHeadEl: HTMLElement | null = null;
let calibHintEl: HTMLElement | null = null;
let calibBarEl: HTMLElement | null = null;
let countdownEl: HTMLDivElement | null = null;
let countdownNumEl: HTMLElement | null = null;
let hudEl: HTMLDivElement | null = null;
let hudTitleEl: HTMLElement | null = null;
let hudScoreEl: HTMLElement | null = null;
let hudHealthEl: HTMLElement | null = null;
let hudHealthFillEl: HTMLElement | null = null;
let gameoverEl: HTMLDivElement | null = null;
let gameoverPreviewEl: HTMLCanvasElement | null = null;
let gameoverClipSaveEl: HTMLButtonElement | null = null;
let gameoverShareSaveEl: HTMLButtonElement | null = null;

function root(): HTMLDivElement {
  if (!rootEl) {
    rootEl = document.createElement('div');
    rootEl.id = 'screens';
    document.body.appendChild(rootEl);
  }
  return rootEl;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// --- Menu ------------------------------------------------------------------

export function showMenu(cards: MenuCard[], onSelect: (id: string) => void): void {
  hideAll();
  if (!menuEl) {
    menuEl = el('div', 'menu screen');
    root().appendChild(menuEl);
  }
  menuEl.replaceChildren();

  const head = el('div', 'menu__head');
  const mark = el('div', 'wordmark menu__mark', 'JUKE');
  const tag = el('p', 'menu__tag', 'Pick a game — your body is the controller.');
  head.append(mark, tag);

  const grid = el('div', 'menu__grid');
  for (const c of cards) {
    const card = el('button', 'card');
    card.type = 'button';
    const title = el('div', 'card__title', c.title);
    const badge = el('span', `card__badge card__badge--${c.intensity}`, c.intensity);
    const blurb = el('p', 'card__blurb', c.blurb);
    card.append(badge, title, blurb);
    if (c.best && c.best > 0) card.append(el('div', 'card__best', `BEST ${c.best}`));
    card.addEventListener('click', () => onSelect(c.id));
    grid.appendChild(card);
  }

  menuEl.append(head, grid);
  menuEl.classList.add('show');
}

// --- Calibration -----------------------------------------------------------

export function showCalibrate(view: CalibView): void {
  hideAll();
  if (!calibEl) {
    calibEl = el('div', 'calib screen');
    root().appendChild(calibEl);
  }
  calibEl.replaceChildren();
  calibChecks = [];

  const panel = el('div', 'calib__panel');
  calibHeadEl = el('div', 'calib__head wordmark', view.heading);
  calibHintEl = el('p', 'calib__hint', view.hint);

  const list = el('div', 'calib__checks');
  for (const c of view.checks) {
    const row = el('div', 'calib__check');
    const dot = el('span', 'calib__dot');
    const label = el('span', 'calib__label', c.label);
    row.append(dot, label);
    list.appendChild(row);
    calibChecks.push(row);
  }

  const bar = el('div', 'calib__bar');
  calibBarEl = el('div', 'calib__fill');
  bar.appendChild(calibBarEl);

  panel.append(calibHeadEl, calibHintEl, list, bar);
  calibEl.appendChild(panel);
  calibEl.classList.add('show');
  updateCalibrate(view);
}

export function updateCalibrate(view: CalibView): void {
  if (!calibEl) return;
  if (calibHeadEl) calibHeadEl.textContent = view.heading;
  if (calibHintEl) calibHintEl.textContent = view.hint;
  if (calibBarEl) calibBarEl.style.width = `${Math.round(view.progress * 100)}%`;
  calibEl.classList.toggle('is-ready', view.ready);
  view.checks.forEach((c, i) => {
    calibChecks[i]?.classList.toggle('ok', c.ok);
  });
}

// --- Countdown -------------------------------------------------------------

export function showCountdown(): void {
  hideAll();
  if (!countdownEl) {
    countdownEl = el('div', 'countdown screen');
    countdownNumEl = el('div', 'countdown__num wordmark');
    countdownEl.appendChild(countdownNumEl);
    root().appendChild(countdownEl);
  }
  countdownEl.classList.add('show');
}

export function setCountdown(text: string): void {
  if (!countdownNumEl) return;
  countdownNumEl.textContent = text;
  // Restart the pop animation by forcing a reflow.
  countdownNumEl.classList.remove('pop');
  void countdownNumEl.offsetWidth;
  countdownNumEl.classList.add('pop');
}

// --- HUD -------------------------------------------------------------------

export function showHud(title: string, hasHealth = false): void {
  if (!hudEl) {
    hudEl = el('div', 'hud');
    hudTitleEl = el('div', 'hud__title');
    const left = el('div', 'hud__left');
    hudHealthEl = el('div', 'hud__health');
    hudHealthFillEl = el('div', 'hud__health-fill');
    hudHealthEl.appendChild(hudHealthFillEl);
    left.append(hudTitleEl, hudHealthEl);
    hudScoreEl = el('div', 'hud__score', '0');
    hudEl.append(left, hudScoreEl);
    root().appendChild(hudEl);
  }
  if (hudTitleEl) hudTitleEl.textContent = title;
  if (hudScoreEl) hudScoreEl.textContent = '0';
  if (hudHealthEl) hudHealthEl.style.display = hasHealth ? 'block' : 'none';
  setHudHealth(1);
  hudEl.classList.add('show');
}

export function setHudScore(score: number): void {
  if (!hudScoreEl) return;
  hudScoreEl.textContent = String(score);
  hudScoreEl.classList.remove('pop');
  void hudScoreEl.offsetWidth;
  hudScoreEl.classList.add('pop');
}

/** Drain/fill the HUD crack meter (0..1). Goes red as it nears empty. */
export function setHudHealth(health: number): void {
  if (!hudHealthFillEl) return;
  const h = Math.max(0, Math.min(1, health));
  hudHealthFillEl.style.width = `${Math.round(h * 100)}%`;
  hudHealthFillEl.classList.toggle('is-low', h <= 0.34);
}

function hideHud(): void {
  hudEl?.classList.remove('show');
}

// --- Game over -------------------------------------------------------------

export function showGameOver(view: GameOverView): void {
  hideAll();
  if (!gameoverEl) {
    gameoverEl = el('div', 'gameover screen');
    root().appendChild(gameoverEl);
  }
  gameoverEl.replaceChildren();

  gameoverPreviewEl = null;
  gameoverClipSaveEl = null;
  gameoverShareSaveEl = null;

  const title = el('div', 'gameover__title wordmark', view.title);
  const scoreWrap = el('div', 'gameover__scorewrap');
  scoreWrap.append(
    el('div', 'gameover__scorelabel', 'SCORE'),
    el('div', 'gameover__score', String(view.score)),
  );
  if (view.best) {
    const best = el(
      'div',
      `gameover__best${view.best.isRecord ? ' is-record' : ''}`,
      view.best.isRecord ? `★ NEW BEST ${view.best.value}` : `BEST ${view.best.value}`,
    );
    scoreWrap.appendChild(best);
  }

  gameoverEl.append(title, scoreWrap);

  // Preview hero + exports (Phase 7 clip · Phase 8 share card). The preview canvas
  // always exists — the shell loops the replay clip into it, or (no clip) blits the
  // static share card — so the screen is never a bare wall of buttons.
  const previewRow = el('div', 'gameover__cliprow');
  gameoverPreviewEl = el('canvas', 'gameover__clip');
  previewRow.appendChild(gameoverPreviewEl);

  const exports = el('div', 'gameover__exports');
  if (view.share) {
    gameoverShareSaveEl = el('button', 'btn btn--ghost', 'Save image ⬇');
    gameoverShareSaveEl.type = 'button';
    gameoverShareSaveEl.addEventListener('click', view.share.onSave);
    exports.appendChild(gameoverShareSaveEl);
  }
  if (view.clip) {
    gameoverClipSaveEl = el('button', 'btn btn--ghost', 'Save clip ⬇');
    gameoverClipSaveEl.type = 'button';
    gameoverClipSaveEl.addEventListener('click', view.clip.onSave);
    exports.appendChild(gameoverClipSaveEl);
  }
  if (exports.childElementCount) previewRow.appendChild(exports);
  gameoverEl.appendChild(previewRow);

  const actions = el('div', 'gameover__actions');
  const retry = el('button', 'btn', 'Retry');
  retry.type = 'button';
  retry.addEventListener('click', view.onRetry);
  const menu = el('button', 'btn btn--ghost', 'Menu');
  menu.type = 'button';
  menu.addEventListener('click', view.onMenu);
  actions.append(retry, menu);

  const hint = el('p', 'gameover__hint', 'Enter to retry · Esc for menu');

  gameoverEl.append(actions, hint); // title/score/preview already appended above
  gameoverEl.classList.add('show');
}

/** The game-over preview canvas — looped clip (Phase 7) or static share card (Phase 8). */
export function gameOverPreviewCanvas(): HTMLCanvasElement | null {
  return gameoverPreviewEl;
}

/** Update the "Save clip" button label (e.g. while exporting). */
export function setClipSaveLabel(text: string): void {
  if (gameoverClipSaveEl) gameoverClipSaveEl.textContent = text;
}

/** Update the "Save image" (share card) button label. */
export function setShareSaveLabel(text: string): void {
  if (gameoverShareSaveEl) gameoverShareSaveEl.textContent = text;
}

// --- shared ----------------------------------------------------------------

/** Hide every transient screen (menu / calibrate / countdown / game over). HUD is separate. */
export function hideAll(): void {
  menuEl?.classList.remove('show');
  calibEl?.classList.remove('show');
  countdownEl?.classList.remove('show');
  gameoverEl?.classList.remove('show');
  hideHud();
}
