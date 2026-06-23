/**
 * Pure pose/hand geometry helpers (Phase 2 utilities).
 *
 * All angles are in degrees and computed in the 2D image plane (x, y). Per the
 * plan, hand grading deliberately ignores z/palm-facing depth — depth from a
 * single webcam is too noisy to grade on.
 */

export interface Point {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

const DEG = 180 / Math.PI;

/**
 * Orientation of the limb segment a->b, in degrees, measured from the +x axis.
 * Range (-180, 180]. (Image y grows downward, so a downward segment reads +90.)
 */
export function limbAngle(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x) * DEG;
}

/**
 * Interior angle at vertex `b` formed by the points a-b-c, in degrees [0, 180].
 * Returns 0 if either segment has zero length.
 */
export function jointAngle(a: Point, b: Point, c: Point): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const du = Math.hypot(ux, uy);
  const dv = Math.hypot(vx, vy);
  if (du === 0 || dv === 0) return 0;
  let cos = (ux * vx + uy * vy) / (du * dv);
  cos = Math.max(-1, Math.min(1, cos));
  return Math.acos(cos) * DEG;
}

// MediaPipe pose landmark indices for the four limb extremities.
const WRIST_L = 15;
const WRIST_R = 16;
const ANKLE_L = 27;
const ANKLE_R = 28;

export interface FramingState {
  wristL: boolean;
  wristR: boolean;
  ankleL: boolean;
  ankleR: boolean;
  /** True only when all four limbs are visible above the threshold. */
  allVisible: boolean;
}

/**
 * The crude framing gate (Phase 4.5, seed of Phase 5 calibration): are all four
 * limb extremities (both wrists, both ankles) visible above `threshold`? If not,
 * the player is too close / cut off and leniency tuning would be wrong.
 */
export function limbsFramed(pose: Point[], threshold = 0.5): FramingState {
  const vis = (i: number): boolean => (pose[i]?.visibility ?? 0) >= threshold;
  const wristL = vis(WRIST_L);
  const wristR = vis(WRIST_R);
  const ankleL = vis(ANKLE_L);
  const ankleR = vis(ANKLE_R);
  return { wristL, wristR, ankleL, ankleR, allVisible: wristL && wristR && ankleL && ankleR };
}

export interface FingerStates {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

/**
 * Per-finger extended/curled state from the 21 MediaPipe hand landmarks.
 *
 * A finger is "extended" when its tip is farther from the wrist than its PIP
 * joint — a rotation-tolerant, depth-free heuristic good enough for the easy
 * tier of Hand Simon-Says. Landmark indices follow MediaPipe's hand model
 * (0 = wrist; tips at 4/8/12/16/20).
 */
export function fingerStates(hand: Point[]): FingerStates {
  const wrist = hand[0];
  const dist = (p: Point): number => Math.hypot(p.x - wrist.x, p.y - wrist.y);
  const extended = (tip: number, pip: number): boolean => dist(hand[tip]) > dist(hand[pip]);
  return {
    // Thumb has no comparable PIP in this projection; compare tip vs MCP.
    thumb: dist(hand[4]) > dist(hand[2]),
    index: extended(8, 6),
    middle: extended(12, 10),
    ring: extended(16, 14),
    pinky: extended(20, 18),
  };
}
