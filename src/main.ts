import './style.css';
import { PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { startCamera, CameraError, type CameraHandle } from './engine/camera';
import { createPosePerception, PerceptionError, type PosePerception } from './engine/perception';
import { showOverlay, hideOverlay } from './shell/overlay';

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

// Reused offscreen canvas for painting the low-res segmentation mask before it
// is scaled up onto the stage.
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d')!;

function loop(now: number): void {
  const dt = now - lastFrame;
  lastFrame = now;
  fps = fps === 0 ? 1000 / dt : fps * 0.9 + (1000 / dt) * 0.1;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (running) {
    renderPerception(now);
    drawHud();
  } else {
    drawIdle(now);
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

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

function renderPerception(now: number): void {
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

  const masks = result.segmentationMasks;
  if (masks && masks.length > 0) {
    drawMask(masks[0], rect);
  }

  const poses = result.landmarks;
  if (poses.length > 0) {
    drawSkeleton(poses[0], px, py);
  }
}

/**
 * Paint the foreground-confidence mask as a translucent neon overlay. The mask
 * is a low-res float (0..1) buffer; we threshold lightly and scale it up.
 */
function drawMask(mask: { width: number; height: number; getAsFloat32Array(): Float32Array; close(): void }, rect: Rect): void {
  const { width: w, height: h } = mask;
  const data = mask.getAsFloat32Array();

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

  // Free the GPU-backed mask buffer.
  mask.close();
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
}

function drawHud(): void {
  const pad = Math.round(canvas.width / 80);
  ctx.font = `${Math.round(canvas.width / 90)}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(232, 236, 244, 0.85)';
  ctx.fillText(`${fps.toFixed(0)} fps  ·  inference ${inferenceMs.toFixed(1)} ms`, pad, pad);
}

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
  body: 'A webcam motion arcade. Stand back so your whole body is in frame, then move — you should see your silhouette and skeleton tracked live.',
  action: { label: 'Enable camera & start', onClick: start },
});
