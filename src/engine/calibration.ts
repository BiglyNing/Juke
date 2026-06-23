/**
 * Body calibration (player-fitted walls).
 *
 * The problem: not everyone can fit their whole body in frame (seated, small
 * room, laptop on a desk). Fixed full-body holes assume they can. So instead we
 * *measure the player* — where they are, how big they appear, and which limbs are
 * actually visible — and build every wall's hole from that profile. If the legs
 * aren't in frame, the holes become upper-body only.
 *
 * `buildProfile` is pure (unit-tested); `Calibrator` just averages a few frames
 * of pose for a stable profile before the run starts.
 */

import type { Point } from './pose';

export interface Vec {
  x: number;
  y: number;
}

export interface BodyProfile {
  head: Vec;
  headR: number;
  neck: Vec;
  pelvis: Vec;
  shoulderL: Vec;
  shoulderR: Vec;
  hipL: Vec;
  hipR: Vec;
  /** Shoulder width — the player's apparent size unit (scales every hole). */
  unit: number;
  /** Measured arm reach (shoulder→wrist) and leg reach (hip→ankle), in frame units. */
  armLen: number;
  legLen: number;
  /** Hole radii derived from `unit` so holes are generous for this body. */
  torsoR: number;
  limbR: number;
  /** Which limbs were visible at calibration — drives which poses are generated. */
  hasArms: boolean;
  hasLegs: boolean;
}

// MediaPipe BlazePose landmark indices.
const NOSE = 0;
const SH_L = 11;
const SH_R = 12;
const WR_L = 15;
const WR_R = 16;
const HIP_L = 23;
const HIP_R = 24;
const AN_L = 27;
const AN_R = 28;

const VIS = 0.5;

function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function mid(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function pt(pose: Point[], i: number): Vec {
  return { x: pose[i].x, y: pose[i].y };
}

/** Can a profile even be built from this frame? (Need shoulders + hips.) */
export function canCalibrate(pose: Point[] | null): boolean {
  if (!pose || pose.length < 33) return false;
  const v = (i: number): boolean => (pose[i]?.visibility ?? 0) >= VIS;
  return v(SH_L) && v(SH_R) && v(HIP_L) && v(HIP_R);
}

/** Build a body profile from one (ideally averaged) pose, or null if unusable. */
export function buildProfile(pose: Point[]): BodyProfile | null {
  if (!canCalibrate(pose)) return null;
  const v = (i: number): boolean => (pose[i]?.visibility ?? 0) >= VIS;

  const shoulderL = pt(pose, SH_L);
  const shoulderR = pt(pose, SH_R);
  const hipL = pt(pose, HIP_L);
  const hipR = pt(pose, HIP_R);
  const unit = Math.max(0.05, dist(shoulderL, shoulderR));
  const neck = mid(shoulderL, shoulderR);
  const pelvis = mid(hipL, hipR);

  const head = v(NOSE) ? { x: pose[NOSE].x, y: pose[NOSE].y - unit * 0.2 } : { x: neck.x, y: neck.y - unit * 0.7 };

  const hasArms = v(WR_L) && v(WR_R);
  const armLen = hasArms
    ? (dist(shoulderL, pt(pose, WR_L)) + dist(shoulderR, pt(pose, WR_R))) / 2
    : unit * 1.7;

  const hasLegs = v(AN_L) && v(AN_R);
  const legLen = hasLegs
    ? (dist(hipL, pt(pose, AN_L)) + dist(hipR, pt(pose, AN_R))) / 2
    : unit * 2.2;

  return {
    head,
    headR: unit * 0.5,
    neck,
    pelvis,
    shoulderL,
    shoulderR,
    hipL,
    hipR,
    unit,
    armLen,
    legLen,
    torsoR: unit * 0.62,
    limbR: unit * 0.4,
    hasArms,
    hasLegs,
  };
}

/** Averages a short burst of pose frames into one stable {@link BodyProfile}. */
export class Calibrator {
  private sum: { x: number; y: number; v: number }[] = [];
  private count = 0;
  private need: number;

  constructor(need = 24) {
    this.need = need;
  }

  get progress(): number {
    return Math.min(1, this.count / this.need);
  }

  reset(): void {
    this.sum = [];
    this.count = 0;
  }

  /** Feed a frame's pose; returns a profile once enough usable frames are gathered. */
  add(pose: Point[] | null): BodyProfile | null {
    if (!canCalibrate(pose)) return null;
    const p = pose as Point[];
    if (this.sum.length === 0) this.sum = p.map(() => ({ x: 0, y: 0, v: 0 }));
    for (let i = 0; i < p.length; i++) {
      this.sum[i].x += p[i].x;
      this.sum[i].y += p[i].y;
      this.sum[i].v += p[i].visibility ?? 0;
    }
    this.count++;
    if (this.count < this.need) return null;
    const avg: Point[] = this.sum.map((s) => ({
      x: s.x / this.count,
      y: s.y / this.count,
      visibility: s.v / this.count,
    }));
    return buildProfile(avg);
  }
}
