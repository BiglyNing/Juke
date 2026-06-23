/**
 * Perception foundation (Phase 1's central technical bet) + the lazy hand path
 * the engine reaches for only when a game `needs: ['hands']` (Phase 3/6).
 *
 * Loads MediaPipe Tasks Vision models with the GPU delegate. The Pose Landmarker
 * (segmentation mask + 33 body landmarks) is the body games' input; the Hand
 * Landmarker (21 keypoints/hand) is loaded separately and only on demand, so the
 * body games never pay its download/inference cost. Everything downstream
 * consumes this layer, so it is intentionally small and replaceable.
 */

import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker,
  type PoseLandmarkerResult,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';

// Pin the WASM runtime to the installed package version so the npm dep and the
// CDN runtime never drift apart.
const TASKS_VISION_VERSION = '0.10.35';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

// 'lite' keeps the model small/fast for the target laptop. Phase 1 risk note:
// if perception is too slow, this and the camera resolution are the first dials.
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class PerceptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerceptionError';
  }
}

// The WASM fileset is shared by every model — resolve it once and reuse.
let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
function vision(): ReturnType<typeof FilesetResolver.forVisionTasks> {
  if (!visionPromise) visionPromise = FilesetResolver.forVisionTasks(WASM_BASE);
  return visionPromise;
}

/**
 * Guards against passing a non-increasing timestamp to detectForVideo (which
 * throws) — requestAnimationFrame can occasionally repeat a timestamp.
 */
function monotonic(): (ts: number) => number {
  let last = -1;
  return (ts) => {
    const t = ts <= last ? last + 1 : ts;
    last = t;
    return t;
  };
}

export interface PosePerception {
  /** Run inference for one video frame. `timestampMs` must strictly increase across calls. */
  detect(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult;
  close(): void;
}

export interface HandPerception {
  detect(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResult;
  close(): void;
}

export async function createPosePerception(): Promise<PosePerception> {
  let landmarker: PoseLandmarker;
  try {
    landmarker = await PoseLandmarker.createFromOptions(await vision(), {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
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

  const tick = monotonic();
  return {
    detect: (video, ts) => landmarker.detectForVideo(video, tick(ts)),
    close: () => landmarker.close(),
  };
}

/**
 * Lazy-loaded hand model — created only when a game declares `needs: ['hands']`
 * (Hand Simon-Says, Phase 6). Body games must never call this.
 */
export async function createHandPerception(): Promise<HandPerception> {
  let landmarker: HandLandmarker;
  try {
    landmarker = await HandLandmarker.createFromOptions(await vision(), {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
  } catch (err) {
    throw new PerceptionError(
      `Failed to load the hand model. Check your connection and try again. (${
        (err as Error)?.message ?? 'unknown error'
      })`,
    );
  }

  const tick = monotonic();
  return {
    detect: (video, ts) => landmarker.detectForVideo(video, tick(ts)),
    close: () => landmarker.close(),
  };
}
