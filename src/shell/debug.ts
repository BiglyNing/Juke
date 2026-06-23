/**
 * Developer overlay (Phase 2): a toggleable DOM panel of tuning sliders plus
 * the live, slider-driven values the perception pipeline reads each frame.
 *
 * Kept deliberately dependency-free (plain DOM, no dat.GUI) so it stays tiny and
 * never ships weight to the game. main.ts owns the canvas-side rendering of the
 * mask grid; this module owns state + the panel + key toggle.
 */

export interface DebugParams {
  /** Downsample width in cells; height is derived from the video aspect. */
  res: number;
  /** EMA smoothing factor (weight of the newest frame). */
  alpha: number;
  /** Erosion radius in cells (edge tolerance). */
  erodePx: number;
  /** Leniency threshold — pass if overlap ratio < tol (used from Phase 4 on). */
  tol: number;
  /** Force the frame over the perf budget, to prove the red readout works. */
  stress: boolean;
  /** Draw the downsampled collision grid over the video. */
  showGrid: boolean;
}

export const debugParams: DebugParams = {
  res: 64,
  alpha: 0.5,
  erodePx: 1,
  tol: 0.08,
  stress: false,
  showGrid: true,
};

let visible = false;
let statusEl: HTMLElement;
let panel: HTMLElement;

export function isDebugOn(): boolean {
  return visible;
}

export function setDebugVisible(v: boolean): void {
  visible = v;
  panel.style.display = v ? 'block' : 'none';
}

export function toggleDebug(): void {
  setDebugVisible(!visible);
}

export function setRecordingStatus(text: string): void {
  statusEl.textContent = text;
}

// --- panel construction --------------------------------------------------

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'dbg-row';
  const name = document.createElement('span');
  name.className = 'dbg-name';
  const value = document.createElement('span');
  value.className = 'dbg-val';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(get());
  const render = (): void => {
    name.textContent = label;
    value.textContent = get().toString();
  };
  input.addEventListener('input', () => {
    set(parseFloat(input.value));
    render();
  });
  render();
  row.append(name, input, value);
  return row;
}

function checkbox(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'dbg-row dbg-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  const name = document.createElement('span');
  name.className = 'dbg-name';
  name.textContent = label;
  row.append(input, name);
  return row;
}

function buildPanel(): void {
  panel = document.createElement('div');
  panel.className = 'debug-panel';
  panel.style.display = 'none';

  const title = document.createElement('div');
  title.className = 'dbg-title';
  title.textContent = 'DEBUG · D toggle · R record';
  panel.appendChild(title);

  panel.appendChild(
    slider('mask res', 16, 160, 4, () => debugParams.res, (v) => (debugParams.res = Math.round(v))),
  );
  panel.appendChild(
    slider('EMA alpha', 0, 1, 0.05, () => debugParams.alpha, (v) => (debugParams.alpha = v)),
  );
  panel.appendChild(
    slider('erode px', 0, 5, 1, () => debugParams.erodePx, (v) => (debugParams.erodePx = Math.round(v))),
  );
  panel.appendChild(
    slider('TOL', 0, 0.5, 0.01, () => debugParams.tol, (v) => (debugParams.tol = v)),
  );
  panel.appendChild(checkbox('show grid', () => debugParams.showGrid, (v) => (debugParams.showGrid = v)));
  panel.appendChild(
    checkbox('force over budget', () => debugParams.stress, (v) => (debugParams.stress = v)),
  );

  statusEl = document.createElement('div');
  statusEl.className = 'dbg-status';
  statusEl.textContent = 'not recording';
  panel.appendChild(statusEl);

  document.body.appendChild(panel);
}

buildPanel();
