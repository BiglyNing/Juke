import './style.css';
import { PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { startCamera, CameraError, type CameraHandle } from './engine/camera';
import { createPosePerception, PerceptionError, type PosePerception } from './engine/perception';
import { showOverlay, hideOverlay } from './shell/overlay';
import { downsample, smoothEMA, binarize, erode, type Grid, type BinaryMask } from './engine/mask';
import { overBudget } from './engine/budget';
import { FixtureRecorder, downloadFixture } from './engine/fixture';
import {
  debugParams,
  isDebugOn,
  toggleDebug,
  setDebugVisible,
  setRecordingStatus,
} from './shell/debug';

// ---------------------------------------------------------------------------
// Phase 0: canvas + device-pixel-aware sizing + the always-on render loop.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// App state: idle until the user starts, then streaming perception frames.
// ---------------------------------------------------------------------------

interface Running {
  camera: CameraHandle;
  perception: PosePerception;
}

let running: Running | null = null;
let inferenceMs = 0;

// FPS smoothing.
let lastFrame = performance.now();
let fps = 0;

// Reused offscreen canvases: one for the silhouette overlay, one for the
// blocky debug collision grid.
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d')!;
const gridCanvas = document.createElement('canvas');
const gridCtx = gridCanvas.getContext('2d')!;

// Phase 2: temporal-smoothing history + fixture recorder.
let prevGrid: Grid | null = null;
const recorder = new FixtureRecorder();

function loop(now: number): void {
  const dt = now - lastFrame;
  lastFrame = now;
  fps = fps === 0 ? 1000 / dt : fps * 0.9 + (1000 / dt) * 0.1;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (running) {
    renderPerception(now, dt);
    drawHud();
  } else {
    drawIdle(now);
  }

  // Debug "force over budget": burn time so the HUD readout goes red and you
  // can confirm the budget alarm works without needing a slow machine.
  if (debugParams.stress) busyWait(40);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function busyWait(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* spin */
  }
}

// ---------------------------------------------------------------------------
// Idle background — a gentle pulse so the canvas is visibly alive (and proves
// the loop runs) before the camera starts.
// ---------------------------------------------------------------------------

function drawIdle(now: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(now / 900);
  const r = Math.max(canvas.width, canvas.height) * (0.25 + pulse * 0.05);
  const g = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    0,
    canvas.width / 2,
    canvas.height / 2,
    r,
  );
  g.addColorStop(0, `rgba(0, 230, 255, ${0.05 + pulse * 0.05})`);
  g.addColorStop(1, 'rgba(7, 8, 13, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------------------
// Phase 1: draw the video, the silhouette mask overlay, and the pose skeleton.
// Phase 2: also run the collision pipeline (downsample/EMA/erode), draw the
// debug grid, and feed the fixture recorder.
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** "object-fit: contain" rect so the whole body stays visible (no cropping). */
function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** Draw an image source mirrored (selfie view) into a destination rect. */
function drawMirrored(src: CanvasImageSource, rect: Rect): void {
  ctx.save();
  ctx.translate(rect.x + rect.w, rect.y);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0, rect.w, rect.h);
  ctx.restore();
}

function renderPerception(now: number, dt: number): void {
  const { camera, perception } = running!;
  const video = camera.video;
  if (video.videoWidth === 0) return;

  const rect = containRect(video.videoWidth, video.videoHeight, canvas.width, canvas.height);

  // Mirror normalized landmark coords into the display rect.
  const px = (nx: number): number => rect.x + (1 - nx) * rect.w;
  const py = (ny: number): number => rect.y + ny * rect.h;

  // Faded video so the neon overlays read clearly.
  ctx.globalAlpha = 0.85;
  drawMirrored(video, rect);
  ctx.globalAlpha = 1;

  const t0 = performance.now();
  const result = perception.detect(video, now);
  inferenceMs = inferenceMs * 0.9 + (performance.now() - t0) * 0.1;

  // Pull the mask floats once (they survive close()), then free the GPU buffer.
  let floats: Float32Array | null = null;
  let mw = 0;
  let mh = 0;
  const masks = result.segmentationMasks;
  if (masks && masks.length > 0) {
    const m = masks[0];
    mw = m.width;
    mh = m.height;
    floats = m.getAsFloat32Array();
    drawMaskOverlay(floats, mw, mh, rect);
    m.close();
  }

  const pose = result.landmarks.length > 0 ? result.landmarks[0] : null;

  // Phase 2 pipeline: only pay for it when the overlay is up or we're recording.
  if (floats && (isDebugOn() || recorder.active)) {
    const dstW = debugParams.res;
    const dstH = Math.max(1, Math.round((dstW * mh) / mw));
    const ds = downsample(floats, mw, mh, dstW, dstH);
    const smoothed = smoothEMA(prevGrid, ds, debugParams.alpha);
    prevGrid = smoothed;

    if (isDebugOn() && debugParams.showGrid) {
      const collision = erode(binarize(smoothed, 0.5), debugParams.erodePx);
      drawDebugGrid(collision, rect);
    }

    if (recorder.active) {
      // Record the raw downsample so replay can re-apply its own smoothing.
      const full = recorder.capture(ds, pose, dt);
      setRecordingStatus(`recording… ${recorder.count} frames`);
      if (full) {
        downloadFixture(recorder.toFixture(), 'juke-fixture.json');
        setRecordingStatus(`saved ${recorder.count}-frame fixture ✓`);
      }
    }
  } else if (!isDebugOn() && !recorder.active) {
    prevGrid = null; // drop stale history when the pipeline is idle
  }

  if (pose) drawSkeleton(pose, px, py);
}

/**
 * Paint the foreground-confidence mask as a translucent neon overlay. The mask
 * is a low-res float (0..1) buffer; we threshold lightly and scale it up.
 */
function drawMaskOverlay(data: Float32Array, w: number, h: number, rect: Rect): void {
  if (maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas.width = w;
    maskCanvas.height = h;
  }
  const img = maskCtx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = data[i];
    const a = v > 0.5 ? Math.min(255, Math.round(v * 200)) : 0;
    const o = i * 4;
    img.data[o] = 0; // R
    img.data[o + 1] = 230; // G
    img.data[o + 2] = 255; // B
    img.data[o + 3] = a; // A
  }
  maskCtx.putImageData(img, 0, 0);

  ctx.globalAlpha = 0.45;
  drawMirrored(maskCanvas, rect);
  ctx.globalAlpha = 1;
}

/**
 * Draw the low-res eroded collision mask as a blocky magenta grid over the
 * video, plus faint cell lines — this is what the game actually judges against,
 * made visible so tuning the sliders has an immediate, legible effect.
 */
function drawDebugGrid(mask: BinaryMask, rect: Rect): void {
  const { width: w, height: h } = mask;
  if (gridCanvas.width !== w || gridCanvas.height !== h) {
    gridCanvas.width = w;
    gridCanvas.height = h;
  }
  const img = gridCtx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (mask.data[i]) {
      img.data[o] = 255; // R
      img.data[o + 1] = 46; // G
      img.data[o + 2] = 136; // B
      img.data[o + 3] = 170; // A
    }
  }
  gridCtx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = false;
  drawMirrored(gridCanvas, rect);
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

const VISIBILITY_THRESHOLD = 0.5;

function drawSkeleton(
  landmarks: NormalizedLandmark[],
  px: (n: number) => number,
  py: (n: number) => number,
): void {
  // Skeleton lines.
  ctx.lineWidth = Math.max(2, canvas.width / 320);
  ctx.strokeStyle = '#00e6ff';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0, 230, 255, 0.8)';
  ctx.shadowBlur = 8;
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
    const a = landmarks[start];
    const b = landmarks[end];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(px(a.x), py(a.y));
    ctx.lineTo(px(b.x), py(b.y));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // Landmark dots, dimmed when low-visibility.
  const r = Math.max(3, canvas.width / 280);
  for (const lm of landmarks) {
    const visible = (lm.visibility ?? 0) >= VISIBILITY_THRESHOLD;
    ctx.fillStyle = visible ? '#ffffff' : 'rgba(255, 46, 136, 0.5)';
    ctx.beginPath();
    ctx.arc(px(lm.x), py(lm.y), r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Debug: per-landmark visibility scores listed down the side.
  if (isDebugOn()) drawVisibilityScores(landmarks);
}

const LANDMARK_LABELS = [
  'nose', 'L.eye-in', 'L.eye', 'L.eye-out', 'R.eye-in', 'R.eye', 'R.eye-out',
  'L.ear', 'R.ear', 'mouth-L', 'mouth-R', 'L.shoulder', 'R.shoulder', 'L.elbow',
  'R.elbow', 'L.wrist', 'R.wrist', 'L.pinky', 'R.pinky', 'L.index', 'R.index',
  'L.thumb', 'R.thumb', 'L.hip', 'R.hip', 'L.knee', 'R.knee', 'L.ankle',
  'R.ankle', 'L.heel', 'R.heel', 'L.foot', 'R.foot',
];

function drawVisibilityScores(landmarks: NormalizedLandmark[]): void {
  const size = Math.max(10, Math.round(canvas.width / 150));
  ctx.font = `${size}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  const x = canvas.width - Math.round(canvas.width / 4.5);
  let y = Math.round(canvas.height / 3);
  for (let i = 0; i < landmarks.length; i++) {
    const v = landmarks[i].visibility ?? 0;
    ctx.fillStyle = v >= VISIBILITY_THRESHOLD ? 'rgba(0, 230, 255, 0.9)' : 'rgba(255, 46, 136, 0.8)';
    ctx.fillText(`${(LANDMARK_LABELS[i] ?? i).padEnd(10)} ${v.toFixed(2)}`, x, y);
    y += size + 2;
  }
}

function drawHud(): void {
  const pad = Math.round(canvas.width / 80);
  const frameMs = 1000 / fps;
  const over = overBudget(frameMs, inferenceMs);
  ctx.font = `${Math.round(canvas.width / 90)}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = over ? '#ff2e88' : 'rgba(232, 236, 244, 0.85)';
  ctx.fillText(
    `${fps.toFixed(0)} fps · frame ${frameMs.toFixed(1)}ms · inference ${inferenceMs.toFixed(1)}ms` +
      (over ? '  ⚠ OVER BUDGET' : ''),
    pad,
    pad,
  );
}

// ---------------------------------------------------------------------------
// Debug + recording keys.
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === 'd') {
    toggleDebug();
  } else if (k === 'r') {
    if (!recorder.active) {
      recorder.start(90);
      setDebugVisible(true); // surface the status readout
      setRecordingStatus('recording… 0 frames');
    }
  }
});

// ---------------------------------------------------------------------------
// Start flow: user gesture -> camera -> model -> stream. Every failure shows a
// graceful, retryable message instead of crashing.
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

  let perception: PosePerception;
  try {
    showOverlay({ title: 'Loading pose model…', body: 'First load downloads the model — just a moment.' });
    perception = await createPosePerception();
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
  running = { camera, perception };
}

showOverlay({
  title: 'Juke',
  body: 'A webcam motion arcade. Stand back so your whole body is in frame, then move — you should see your silhouette and skeleton tracked live. Press D for the debug overlay.',
  action: { label: 'Enable camera & start', onClick: start },
});
