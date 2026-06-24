/**
 * Replay-clip capture (Phase 7) — the raw material for the Phase 9 share
 * artifacts, built now because the freeze-frame work makes it nearly free.
 *
 * It keeps a rolling ~2.5 s ring buffer of downscaled canvas frames (sampled at
 * a modest fps so a weak laptop doesn't notice), so at game-over we already hold
 * "the last couple of seconds". From that buffer it can:
 *   - `playPreview()` — loop the clip into a small on-screen canvas, and
 *   - `exportWebM()`  — re-render the frames through a MediaRecorder to produce a
 *     downloadable WebM with *zero* dependencies. (GIF would need an encoder lib;
 *     WebM via MediaRecorder is the dependency-free path the plan allows.)
 *
 * Frames are stored in reused offscreen canvases (a small pool), so steady-state
 * capture allocates nothing. Everything degrades gracefully where MediaRecorder
 * or captureStream is missing — the preview still works, export just returns null.
 */

const CAPTURE_FPS = 15;
const SAMPLE_MS = 1000 / CAPTURE_FPS;
const CLIP_SECONDS = 2.5;
const MAX_FRAMES = Math.round(CLIP_SECONDS * CAPTURE_FPS);
const CLIP_W = 360;

interface ClipFrame {
  canvas: HTMLCanvasElement;
  /** Real ms since the previous captured frame (for true-speed playback). */
  ms: number;
}

class Capture {
  private source: HTMLCanvasElement | null = null;
  private buffer: ClipFrame[] = [];
  private pool: HTMLCanvasElement[] = [];
  private active = false;
  private lastSample = -1;
  private clipH = Math.round((CLIP_W * 9) / 16);
  private previewRaf = 0;

  /** Point the recorder at the main canvas once at startup. */
  attach(source: HTMLCanvasElement): void {
    this.source = source;
  }

  /** Begin sampling into a fresh buffer (call when a run starts). */
  start(): void {
    this.recycleAll();
    this.active = true;
    this.lastSample = -1;
    const s = this.source;
    if (s && s.width > 0) this.clipH = Math.max(1, Math.round((CLIP_W * s.height) / s.width));
  }

  /** Stop sampling but keep the buffer, so game-over can still read the clip. */
  stop(): void {
    this.active = false;
  }

  /** Capture one frame if enough real time has elapsed. Cheap to call every frame. */
  sample(now: number): void {
    if (!this.active || !this.source) return;
    const dt = this.lastSample < 0 ? SAMPLE_MS : now - this.lastSample;
    if (dt < SAMPLE_MS) return;
    this.lastSample = now;

    const slot = this.pool.pop() ?? document.createElement('canvas');
    if (slot.width !== CLIP_W || slot.height !== this.clipH) {
      slot.width = CLIP_W;
      slot.height = this.clipH;
    }
    const c = slot.getContext('2d')!;
    c.drawImage(this.source, 0, 0, CLIP_W, this.clipH);
    this.buffer.push({ canvas: slot, ms: Math.max(40, Math.min(140, dt)) });
    while (this.buffer.length > MAX_FRAMES) {
      const old = this.buffer.shift()!;
      this.pool.push(old.canvas); // reuse the offscreen, don't realloc
    }
  }

  hasClip(): boolean {
    return this.buffer.length >= 4;
  }

  /**
   * The most recent captured frame — i.e. the death freeze-frame — or null if the
   * buffer is empty. Clean (sampled before the dev HUD/grid), so it's the right
   * source for the Phase 8 share card.
   */
  lastFrame(): HTMLCanvasElement | null {
    return this.buffer.length ? this.buffer[this.buffer.length - 1].canvas : null;
  }

  /** Loop the buffered clip into `target` until the returned stop fn is called. */
  playPreview(target: HTMLCanvasElement): () => void {
    cancelAnimationFrame(this.previewRaf);
    if (!this.hasClip()) return () => {};
    target.width = CLIP_W;
    target.height = this.clipH;
    const tctx = target.getContext('2d')!;
    const frames = this.buffer;
    let i = 0;
    let acc = 0;
    let last = performance.now();
    const step = (now: number): void => {
      acc += now - last;
      last = now;
      while (acc >= frames[i].ms) {
        acc -= frames[i].ms;
        i = (i + 1) % frames.length;
      }
      tctx.drawImage(frames[i].canvas, 0, 0);
      this.previewRaf = requestAnimationFrame(step);
    };
    this.previewRaf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(this.previewRaf);
  }

  /** True if this browser can encode a clip to WebM. */
  supported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
      !!this.pickMime()
    );
  }

  /** Re-render the buffered frames through MediaRecorder → a WebM Blob (or null). */
  async exportWebM(): Promise<Blob | null> {
    const mime = this.pickMime();
    if (!this.supported() || !this.hasClip() || !mime) return null;
    const frames = this.buffer.slice();
    const out = document.createElement('canvas');
    out.width = CLIP_W;
    out.height = this.clipH;
    const octx = out.getContext('2d')!;
    const stream = out.captureStream(CAPTURE_FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e): void => {
      if (e.data.size) chunks.push(e.data);
    };
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = (): void => resolve(new Blob(chunks, { type: mime }));
    });
    rec.start();
    octx.drawImage(frames[0].canvas, 0, 0);
    for (const f of frames) {
      octx.drawImage(f.canvas, 0, 0);
      await sleep(f.ms);
    }
    await sleep(450); // hold the final freeze-frame a beat
    rec.stop();
    return done;
  }

  /** Trigger a browser download of a captured Blob. */
  download(blob: Blob, filename = 'juke-clip.webm'): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  private pickMime(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  private recycleAll(): void {
    for (const f of this.buffer) this.pool.push(f.canvas);
    this.buffer.length = 0;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The one shared capture instance. */
export const capture = new Capture();
