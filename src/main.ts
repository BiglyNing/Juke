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
import { showLoadingScreen, hideLoadingScreen } from './shell/loadingScreen';
import { COLORS, FONT, rgba } from './shell/theme';
import {
  debugParams,
  isDebugOn,
  toggleDebug,
  setDebugVisible,
  setRecordingStatus,
} from './shell/debug';
import { containRect, drawMirrored, type Rect } from './render/canvas';
import { Shell } from './shell/app';
import { juice } from './juice/juice';
import { audio } from './juice/audio';
import { capture } from './juice/capture';
import sampleFixtureJson from './engine/__fixtures__/sample.json';

// Registering a game is a side-effect import. Adding a game = import its module.
import './games/holeInWall';
import './games/simonSays';
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
// Engine + shell. The engine owns the RAF loop and the active-game slot; the
// shell (shell/app.ts) owns the lifecycle (menu → calibrate → countdown → play
// → gameover) and advances each frame via the engine's overlay hook. main.ts
// keeps only the dev instrumentation: the always-on FPS/budget readout, the
// debug collision grid, and fixture record/replay.
// ---------------------------------------------------------------------------

// `juice` doubles as the engine's FrameModulator: it bends simulation time
// (freeze / slow-mo) and shakes the camera. `capture` samples this canvas into a
// rolling replay-clip buffer.
const engine = new Engine(canvas, drawOverlay, juice);
const shell = new Shell(engine);
// The menu/landing attract loop replays this bundled fixture (no camera needed).
shell.loadAttract(sampleFixtureJson as unknown as Fixture);
capture.attach(canvas);
engine.start();

let liveProducer: Producer | null = null;
const recorder = new FixtureRecorder();

// Reused offscreen canvas + EMA history for the debug collision grid.
const gridCanvas = document.createElement('canvas');
const gridCtx = gridCanvas.getContext('2d')!;
let debugPrevGrid: Grid | null = null;

// ---------------------------------------------------------------------------
// Per-frame overlay (engine hook): advance the shell lifecycle + draw its idle
// backdrop, then the always-on dev instrumentation — debug collision grid /
// visibility scores, fixture recording, and the FPS/budget readout — on top.
// ---------------------------------------------------------------------------

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: PerceptionFrame | null,
  stats: FrameStats,
): void {
  shell.tick(ctx, frame, stats);

  // Juice: advance every effect on real time, then draw it over the game. Sample
  // the composited frame into the replay buffer *before* the dev HUD/grid so
  // clips stay clean.
  juice.update(stats.now);
  juice.render(ctx);
  capture.sample(stats.now);

  if (frame) {
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
  } else {
    debugPrevGrid = null;
  }

  drawFpsHud(ctx, stats);

  if (debugParams.stress) busyWait(40); // force the budget alarm for testing
}

function busyWait(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* spin */
  }
}

function drawFpsHud(ctx: CanvasRenderingContext2D, stats: FrameStats): void {
  const pad = Math.round(ctx.canvas.width / 80);
  const frameMs = 1000 / stats.fps;
  const over = overBudget(frameMs, stats.inferenceMs);
  ctx.font = `${Math.round(ctx.canvas.width / 90)}px ${FONT.mono}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = over ? COLORS.danger : rgba(COLORS.text, 0.85);
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
      img.data[o] = 255; // R  (magenta accent)
      img.data[o + 1] = 79; // G
      img.data[o + 2] = 216; // B
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
  ctx.font = `${size}px ${FONT.mono}`;
  ctx.textBaseline = 'top';
  const x = ctx.canvas.width - Math.round(ctx.canvas.width / 4.5);
  let y = Math.round(ctx.canvas.height / 3);
  for (let i = 0; i < pose.length; i++) {
    const v = pose[i].visibility ?? 0;
    ctx.fillStyle = v >= 0.5 ? rgba(COLORS.teal, 0.9) : rgba(COLORS.danger, 0.8);
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
  } else if (k === 'm') {
    audio.toggleMute();
    syncMuteButton();
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

// --- Mute toggle (Phase 7): always-reachable so a reviewer can silence the tab.
const muteBtn = document.createElement('button');
muteBtn.className = 'mute-btn';
muteBtn.type = 'button';
muteBtn.setAttribute('aria-label', 'Toggle sound');
muteBtn.title = 'Toggle sound (M)';
muteBtn.addEventListener('click', () => {
  audio.unlock(); // a click here also satisfies the autoplay gesture requirement
  audio.toggleMute();
  syncMuteButton();
});
document.body.appendChild(muteBtn);

function syncMuteButton(): void {
  const muted = audio.isMuted();
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.classList.toggle('is-muted', muted);
}
syncMuteButton();

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
  await shell.enterReplay(createFixtureProducer(fixture, { loop: true }));
}

// ---------------------------------------------------------------------------
// Start flow: user gesture -> camera -> model -> live producer -> active game.
// Every failure shows a graceful, retryable message instead of crashing.
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  audio.unlock(); // this click is the user gesture browsers require to start audio
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

  showLoadingScreen();
  try {
    const pose = await createPosePerception();
    liveProducer = createLiveProducer(camera, pose);
  } catch (err) {
    hideLoadingScreen();
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

  hideLoadingScreen();
  hideOverlay();
  shell.attachProducer(liveProducer);
  await shell.enterMenu(); // the shell takes over: menu → calibrate → countdown → play
}

showOverlay({
  title: 'Juke',
  body: 'A webcam motion arcade — your body is the controller. Enable your camera, pick a game from the menu, get framed, and play. Press D for the debug overlay.',
  action: { label: 'Enable camera & start', onClick: start },
});
