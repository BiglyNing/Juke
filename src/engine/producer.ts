/**
 * Perception producers (Phase 3): turn a source of frames into one normalized
 * {@link PerceptionFrame} per tick. The engine loop is identical whether the
 * source is a live camera or a replayed fixture — that's the whole point.
 *
 * - {@link createLiveProducer}: camera + pose model (+ lazy hand model), pulls
 *   the segmentation mask, downsamples it to the raw collision grid, tracks
 *   inference time, and frees the GPU mask buffer each frame.
 * - {@link createFixtureProducer}: replays a recorded fixture with no webcam,
 *   so the loop runs deterministically (Phase 3 exit criterion).
 */

import { downsample } from './mask';
import type { PerceptionFrame } from './frame';
import type { Point } from './pose';
import type { Need } from './game';
import type { Fixture } from './fixture';
import type { CameraHandle } from './camera';
import { createHandPerception, type PosePerception, type HandPerception } from './perception';
import { debugParams } from '../shell/debug';

export interface Producer {
  /** Emit the next frame, or null if no new data is ready yet / replay is exhausted. */
  produce(now: number): PerceptionFrame | null;
  /** Lazily satisfy a game's needs (e.g. load the hand model). Safe to call repeatedly. */
  ensureNeeds(needs: Need[]): Promise<void>;
  /** Smoothed model inference time, ms (0 for replay). */
  readonly inferenceMs: number;
  close(): void;
}

/** Live camera + pose model, with the hand model loaded on demand. */
export function createLiveProducer(camera: CameraHandle, pose: PosePerception): Producer {
  let hands: HandPerception | null = null;
  let handsLoading: Promise<void> | null = null;
  let inferenceMs = 0;
  let lastNow = -1;

  return {
    get inferenceMs() {
      return inferenceMs;
    },

    async ensureNeeds(needs) {
      if (!needs.includes('hands') || hands) return;
      if (!handsLoading) {
        handsLoading = createHandPerception()
          .then((h) => {
            hands = h;
          })
          .catch(() => {
            // Leave hands null — the game still runs; Phase 6 surfaces this to the user.
            handsLoading = null;
          });
      }
      await handsLoading;
    },

    produce(now) {
      const video = camera.video;
      if (video.videoWidth === 0) return null;
      const dt = lastNow < 0 ? 1000 / 60 : now - lastNow;
      lastNow = now;

      const t0 = performance.now();
      const poseResult = pose.detect(video, now);
      const handResult = hands ? hands.detect(video, now) : null;
      const sample = performance.now() - t0;
      inferenceMs = inferenceMs === 0 ? sample : inferenceMs * 0.9 + sample * 0.1;

      // Raw downsampled occupancy = the collision grid (no EMA — that's the consumer's job).
      let silhouetteMask: Float32Array | null = null;
      let maskW = 0;
      let maskH = 0;
      const masks = poseResult.segmentationMasks;
      if (masks && masks.length > 0) {
        const m = masks[0];
        const floats = m.getAsFloat32Array();
        const dstW = debugParams.res;
        const dstH = Math.max(1, Math.round((dstW * m.height) / m.width));
        const grid = downsample(floats, m.width, m.height, dstW, dstH);
        silhouetteMask = grid.data;
        maskW = grid.width;
        maskH = grid.height;
        m.close(); // free the GPU buffer; the floats survive close()
      }

      return {
        silhouetteMask,
        maskW,
        maskH,
        pose: poseResult.landmarks.length > 0 ? (poseResult.landmarks[0] as Point[]) : null,
        hands: handResult && handResult.landmarks.length > 0 ? (handResult.landmarks as Point[][]) : null,
        video,
        dt,
      };
    },

    close() {
      pose.close();
      hands?.close();
      camera.stop();
    },
  };
}

/** Replay a recorded fixture frame-by-frame with no webcam. */
export function createFixtureProducer(fixture: Fixture, opts: { loop?: boolean } = {}): Producer {
  let i = 0;
  return {
    inferenceMs: 0,
    async ensureNeeds() {
      // A fixture carries exactly what it recorded; nothing to load.
    },
    produce() {
      if (i >= fixture.frames.length) {
        if (opts.loop && fixture.frames.length > 0) i = 0;
        else return null;
      }
      const fr = fixture.frames[i++];
      return {
        silhouetteMask: Float32Array.from(fr.mask),
        maskW: fr.maskW,
        maskH: fr.maskH,
        pose: fr.pose ?? null,
        hands: null,
        video: null,
        dt: fr.dt,
      };
    },
    close() {
      // nothing to release
    },
  };
}
