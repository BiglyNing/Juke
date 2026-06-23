/**
 * The normalized per-tick perception input (Phase 3).
 *
 * Every game consumes this one shape, fed by a `Producer` (live camera or a
 * replayed fixture). It is deliberately the *same* shape the Phase 2 fixture
 * records/replays — so a recording round-trips through the engine unchanged and
 * games can be regression-tested headlessly. See engine/fixture.ts.
 *
 * `silhouetteMask` is the **raw** downsampled occupancy grid (0..1), i.e. the
 * collision input before any temporal smoothing — matching what the fixture
 * stores. Temporal smoothing (EMA), binarize, and erode are the *consumer's*
 * pipeline (replayFixture re-applies them deterministically), not the producer's.
 */

import type { Grid } from './mask';
import type { Point } from './pose';

export interface PerceptionFrame {
  /** Row-major foreground occupancy (0..1), length `maskW*maskH`. Null until the first mask arrives. */
  silhouetteMask: Float32Array | null;
  maskW: number;
  maskH: number;
  /** 33 body pose landmarks (normalized), or null if none detected / not needed. */
  pose: Point[] | null;
  /** Hands (21 landmarks each); only populated when the active game `needs` 'hands'. */
  hands: Point[][] | null;
  /** Live video for rendering the feed; null during headless/fixture replay. */
  video: HTMLVideoElement | null;
  /** Real milliseconds since the previous frame (matches recorded fixtures). */
  dt: number;
}

/** Bridge the frame's flat mask to the {@link Grid} shape the mask utilities take. */
export function maskGrid(frame: PerceptionFrame): Grid | null {
  return frame.silhouetteMask
    ? { data: frame.silhouetteMask, width: frame.maskW, height: frame.maskH }
    : null;
}
