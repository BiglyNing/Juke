import './style.css';
import { startCamera, CameraError, type CameraHandle } from './engine/camera';
import { createPosePerception, PerceptionError } from './engine/perception';
import { Engine, type FrameStats } from './engine/loop';
import { createLiveProducer, createFixtureProducer, type Producer } from './engine/producer';
import type { PerceptionFrame } from './engine/frame';
import { maskGrid } from './engine/frame';
import { smoothEMA, binarize, erode, type Grid, type BinaryMask } from './engine/mask';
import { overBudget } from './engine/budget';
import { FixtureRecorder, downloadFixture, type Fixture } from './engine/fixture';
import { showOverlay, hideOverlay } from './shell/overlay';
import {
  debugParams,
  isDebugOn,
  toggleDebug,
  setDebugVisible,
  setRecordingStatus,
} from './shell/debug';
import { containRect, drawMirrored, type Rect } from './render/canvas';
import sampleFixtureJson from './engine/__fixtures__/sample.json';

// Registering a game is a side-effect import. Adding a game = import its module.
import './games/testGame';

// ---------------------------------------------------------------------------
// Canvas + device-pixel-aware sizing.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('stage') as HTMLCanvasElement;

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Engine: one active-game slot, fed by whichever producer is set. The shell
// (this file) owns the always-on overlay drawn on top of the active game.
// ---------------------------------------------------------------------------

const engine = new Engine(canvas, drawOverlay);
engine.start();

let liveProducer: Producer | null = null;
const recorder = new FixtureRecorder();

// Reused offscreen canvas + EMA history for the debug collision grid.
const gridCanvas = document.createElement('canvas');
const gridCtx = gridCanvas.getContext('2d')!;
let debugPrevGrid: Grid | null = null;

// ---------------------------------------------------------------------------
// Overlay: idle pulse when there's no frame; otherwise HUD + (debug) collision
// grid / visibility scores + fixture recording. Drawn after the active game.
// ---------------------------------------------------------------------------

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: PerceptionFrame | null,
  stats: FrameStats,
): void {
  if (!frame) {
    drawIdle(ctx, stats.now);
    debugPrevGrid = null;
    return;
  }

  const srcW = frame.video?.videoWidth || frame.maskW || ctx.canvas.width;
  const srcH = frame.video?.videoHeight || frame.maskH || ctx.canvas.height;
  const rect = containRect(srcW, srcH, ctx.canvas.width, ctx.canvas.height);

  if (isDebugOn() && frame.silhouetteMask) {
    const grid = maskGrid(frame)!;
    const smoothed = smoothEMA(debugPrevGrid, grid, debugParams.alpha);
    debugPrevGrid = smoothed;
    if (debugParams.showGrid) {
      drawDebugGrid(ctx, erode(binarize(smoothed, 0.5), debugParams.erodePx), rect);
    }
    if (frame.pose) drawVisibilityScores(ctx, frame.pose);
  } else {
    debugPrevGrid = null;
  }

  if (recorder.active && frame.silhouetteMask) {
    const full = recorder.capture(maskGrid(frame)!, frame.pose, frame.dt);
    setRecordingStatus(`recording… ${recorder.count} frames`);
    if (full) {
      downloadFixture(recorder.toFixture(), 'juke-fixture.json');
      setRecordingStatus(`saved ${recorder.count}-frame fixture ✓`);
    }
  }

  drawHud(ctx, stats);

  if (debugParams.stress) busyWait(40); // force the budget alarm for testing
}

function busyWait(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* spin */
  }
}

function drawIdle(ctx: CanvasRenderingContext2D, now: number): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const pulse = 0.5 + 0.5 * Math.sin(now / 900);
  const r = Math.max(w, h) * (0.25 + pulse * 0.05);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
  g.addColorStop(0, `rgba(0, 230, 255, ${0.05 + pulse * 0.05})`);
  g.addColorStop(1, 'rgba(7, 8, 13, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawHud(ctx: CanvasRenderingContext2D, stats: FrameStats): void {
  const pad = Math.round(ctx.canvas.width / 80);
  const frameMs = 1000 / stats.fps;
  const over = overBudget(frameMs, stats.inferenceMs);
  ctx.font = `${Math.round(ctx.canvas.width / 90)}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = over ? '#ff2e88' : 'rgba(232, 236, 244, 0.85)';
  ctx.fillText(
    `${stats.fps.toFixed(0)} fps · frame ${frameMs.toFixed(1)}ms · inference ${stats.inferenceMs.toFixed(1)}ms` +
      (over ? '  ⚠ OVER BUDGET' : ''),
    pad,
    pad,
  );
}

function drawDebugGrid(ctx: CanvasRenderingContext2D, mask: BinaryMask, rect: Rect): void {
  const { width: w, height: h } = mask;
  if (gridCanvas.width !== w || gridCanvas.height !== h) {
    gridCanvas.width = w;
    gridCanvas.height = h;
  }
  const img = gridCtx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (mask.data[i]) {
      const o = i * 4;
      img.data[o] = 255; // R
      img.data[o + 1] = 46; // G
      img.data[o + 2] = 136; // B
      img.data[o + 3] = 170; // A
    }
  }
  gridCtx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = false;
  drawMirrored(ctx, gridCanvas, rect);
  ctx.imageSmoothingEnabled = true;

  // Cell lines (a uniform grid is mirror-symmetric, so no transform needed).
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= w; c++) {
    const x = Math.round(rect.x + (c / w) * rect.w) + 0.5;
    ctx.moveTo(x, rect.y);
    ctx.lineTo(x, rect.y + rect.h);
  }
  for (let r = 0; r <= h; r++) {
    const y = Math.round(rect.y + (r / h) * rect.h) + 0.5;
    ctx.moveTo(rect.x, y);
    ctx.lineTo(rect.x + rect.w, y);
  }
  ctx.stroke();
}

const LANDMARK_LABELS = [
  'nose', 'L.eye-in', 'L.eye', 'L.eye-out', 'R.eye-in', 'R.eye', 'R.eye-out',
  'L.ear', 'R.ear', 'mouth-L', 'mouth-R', 'L.shoulder', 'R.shoulder', 'L.elbow',
  'R.elbow', 'L.wrist', 'R.wrist', 'L.pinky', 'R.pinky', 'L.index', 'R.index',
  'L.thumb', 'R.thumb', 'L.hip', 'R.hip', 'L.knee', 'R.knee', 'L.ankle',
  'R.ankle', 'L.heel', 'R.heel', 'L.foot', 'R.foot',
];

function drawVisibilityScores(ctx: CanvasRenderingContext2D, pose: { visibility?: number }[]): void {
  const size = Math.max(10, Math.round(ctx.canvas.width / 150));
  ctx.font = `${size}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  const x = ctx.canvas.width - Math.round(ctx.canvas.width / 4.5);
  let y = Math.round(ctx.canvas.height / 3);
  for (let i = 0; i < pose.length; i++) {
    const v = pose[i].visibility ?? 0;
    ctx.fillStyle = v >= 0.5 ? 'rgba(0, 230, 255, 0.9)' : 'rgba(255, 46, 136, 0.8)';
    ctx.fillText(`${(LANDMARK_LABELS[i] ?? i).toString().padEnd(10)} ${v.toFixed(2)}`, x, y);
    y += size + 2;
  }
}

// ---------------------------------------------------------------------------
// Keys: D debug · R record · F replay the bundled fixture (no camera needed).
// Drag-and-drop a recorded fixture JSON to replay it through the same loop.
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === 'd') {
    toggleDebug();
  } else if (k === 'r') {
    if (!recorder.active) {
      recorder.start(90);
      setDebugVisible(true);
      setRecordingStatus('recording… 0 frames');
    }
  } else if (k === 'f') {
    void replayFixture(sampleFixtureJson as unknown as Fixture);
  }
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    const fixture = JSON.parse(await file.text()) as Fixture;
    await replayFixture(fixture);
  } catch {
    showOverlay({ title: "Couldn't read that fixture", body: 'Drop a JSON file recorded with the R key.', error: true });
  }
});

/** Swap the live camera for a replayed fixture — same loop, no webcam. */
async function replayFixture(fixture: Fixture): Promise<void> {
  hideOverlay();
  engine.setProducer(createFixtureProducer(fixture, { loop: true }));
  await engine.setActiveGame('test');
}

// ---------------------------------------------------------------------------
// Start flow: user gesture -> camera -> model -> live producer -> active game.
// Every failure shows a graceful, retryable message instead of crashing.
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  let camera: CameraHandle;
  try {
    showOverlay({ title: 'Starting camera…', body: 'Allow camera access if your browser asks.' });
    camera = await startCamera();
  } catch (err) {
    const message = err instanceof CameraError ? err.message : String(err);
    showOverlay({
      title: 'Camera unavailable',
      body: message,
      error: true,
      action: { label: 'Try again', onClick: start },
    });
    return;
  }

  try {
    showOverlay({ title: 'Loading pose model…', body: 'First load downloads the model — just a moment.' });
    const pose = await createPosePerception();
    liveProducer = createLiveProducer(camera, pose);
  } catch (err) {
    camera.stop();
    const message = err instanceof PerceptionError ? err.message : String(err);
    showOverlay({
      title: "Couldn't load perception",
      body: message,
      error: true,
      action: { label: 'Try again', onClick: start },
    });
    return;
  }

  hideOverlay();
  engine.setProducer(liveProducer);
  await engine.setActiveGame('test'); // swapping the active game is this one line
}

showOverlay({
  title: 'Juke',
  body: 'A webcam motion arcade. Stand back so your whole body is in frame, then move — you should see your silhouette and skeleton tracked live. Press D for the debug overlay, F to replay the demo fixture.',
  action: { label: 'Enable camera & start', onClick: start },
});
