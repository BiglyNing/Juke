/**
 * Perception fixtures: record a short burst of live frames to a JSON file, and
 * replay a saved fixture through the pipeline headlessly (no webcam).
 *
 * This is the cheap insurance for the riskiest layer — once you have a fixture,
 * you can refactor the engine and verify collision/scoring deterministically in
 * a unit test instead of standing up in front of the camera again.
 *
 * We store the *downsampled* occupancy grid (the collision input), not the
 * full-res mask, so fixtures stay small and replay reproduces the exact numbers
 * the game logic will see.
 */

import type { Grid } from './mask';
import type { Point } from './pose';

export interface FixtureFrame {
  dt: number;
  maskW: number;
  maskH: number;
  /** Row-major occupancy (0..1), length maskW*maskH. */
  mask: number[];
  /** Pose landmarks for this frame, or null if none detected. */
  pose: Array<{ x: number; y: number; z?: number; visibility?: number }> | null;
}

export interface Fixture {
  version: 1;
  recordedAt: string;
  frames: FixtureFrame[];
}

/** Re-export so callers don't need a second import for the grid shape. */
export type { Grid };

/**
 * Accumulates downsampled frames while active, then yields a serializable
 * fixture. Auto-stops once `maxFrames` is reached so a recording is bounded.
 */
export class FixtureRecorder {
  private frames: FixtureFrame[] = [];
  private recording = false;
  private maxFrames = 90;

  start(maxFrames = 90): void {
    this.frames = [];
    this.maxFrames = maxFrames;
    this.recording = true;
  }

  get active(): boolean {
    return this.recording;
  }

  get count(): number {
    return this.frames.length;
  }

  /** Returns true once it has just auto-stopped (buffer full), else false. */
  capture(grid: Grid, pose: Point[] | null, dt: number): boolean {
    if (!this.recording) return false;
    this.frames.push({
      dt,
      maskW: grid.width,
      maskH: grid.height,
      mask: Array.from(grid.data),
      pose: pose ? pose.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) : null,
    });
    if (this.frames.length >= this.maxFrames) {
      this.recording = false;
      return true;
    }
    return false;
  }

  toFixture(): Fixture {
    this.recording = false;
    return { version: 1, recordedAt: new Date().toISOString(), frames: this.frames.slice() };
  }
}

/** Reconstruct a fixture frame's stored occupancy back into a {@link Grid}. */
export function frameToGrid(frame: FixtureFrame): Grid {
  return { data: Float32Array.from(frame.mask), width: frame.maskW, height: frame.maskH };
}

/**
 * Feed every frame of a fixture through `process` (in order) and collect the
 * results. Pure with respect to the fixture — given the same fixture and the
 * same `process`, the output is identical on every run, which is exactly what
 * makes it usable as a regression check.
 */
export function replayFixture<T>(
  fixture: Fixture,
  process: (frame: { grid: Grid; pose: Point[] | null; dt: number }) => T,
): T[] {
  return fixture.frames.map((fr) =>
    process({ grid: frameToGrid(fr), pose: fr.pose ?? null, dt: fr.dt }),
  );
}

/** Trigger a browser download of a fixture as pretty-printed JSON. */
export function downloadFixture(fixture: Fixture, filename = 'juke-fixture.json'): void {
  const blob = new Blob([JSON.stringify(fixture, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
