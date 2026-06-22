/**
 * Perception foundation (Phase 1's central technical bet).
 *
 * Loads the MediaPipe Pose Landmarker (Tasks Vision) with segmentation masks
 * enabled and the GPU delegate, then exposes a single per-frame `detect()` that
 * returns the 33 pose landmarks plus the foreground silhouette mask. Everything
 * downstream (collision, games) consumes this layer, so it is intentionally
 * small and replaceable.
 */

import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

// Pin the WASM runtime to the installed package version so the npm dep and the
// CDN runtime never drift apart.
const TASKS_VISION_VERSION = '0.10.35';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

// 'lite' keeps the model small/fast for the target laptop. Phase 1 risk note:
// if perception is too slow, this and the camera resolution are the first dials.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export class PerceptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerceptionError';
  }
}

export interface PosePerception {
  /**
   * Run inference for one video frame. `timestampMs` must strictly increase
   * across calls (VIDEO running mode requirement).
   */
  detect(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult;
  close(): void;
}

export async function createPosePerception(): Promise<PosePerception> {
  let landmarker: PoseLandmarker;
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      outputSegmentationMasks: true,
    });
  } catch (err) {
    throw new PerceptionError(
      `Failed to load the pose model. Check your connection and try again. (${
        (err as Error)?.message ?? 'unknown error'
      })`,
    );
  }

  // Guards against passing a non-increasing timestamp to detectForVideo, which
  // throws. requestAnimationFrame can occasionally repeat a timestamp.
  let lastTs = -1;

  return {
    detect(video, timestampMs) {
      const ts = timestampMs <= lastTs ? lastTs + 1 : timestampMs;
      lastTs = ts;
      return landmarker.detectForVideo(video, ts);
    },
    close() {
      landmarker.close();
    },
  };
}
