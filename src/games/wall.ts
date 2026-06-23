/**
 * Hole-in-the-Wall geometry (Phase 4.2+).
 *
 * A wall is a solid panel with a person-shaped *hole* cut out of it. The hole is
 * a generous humanoid silhouette in a pose (head circle + torso/limb capsules),
 * defined in normalized frame coordinates (0..1). To fit, the player strikes the
 * pose so their silhouette lands inside the hole; any of them over the SOLID part
 * is what gets judged (see maskOverlap in mask.ts).
 *
 * Everything here is pure and deterministic, so the rasterizer is unit-tested and
 * the same shapes drive both collision (low-res mask) and rendering (canvas).
 */

import type { BinaryMask } from './../engine/mask';

export interface Circle {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface Capsule {
  kind: 'capsule';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
}

export type Shape = Circle | Capsule;

export interface Hole {
  name: string;
  shapes: Shape[];
}

/** Squared distance from point (px,py) to segment (x0,y0)-(x1,y1). */
function distSqToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + t * dx;
  const cy = y0 + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/** Is the normalized point (x,y) inside the hole (i.e. inside any of its shapes)? */
export function pointInHole(hole: Hole, x: number, y: number): boolean {
  for (const s of hole.shapes) {
    if (s.kind === 'circle') {
      const dx = x - s.cx;
      const dy = y - s.cy;
      if (dx * dx + dy * dy <= s.r * s.r) return true;
    } else {
      if (distSqToSegment(x, y, s.x0, s.y0, s.x1, s.y1) <= s.r * s.r) return true;
    }
  }
  return false;
}

/**
 * Rasterize the wall's SOLID region into a `w x h` binary mask (1 = solid wall,
 * 0 = hole), sampling each cell at its center. This shares the dimensions of the
 * player's silhouette grid so maskOverlap(player, solid) judges the fit directly.
 */
export function rasterizeSolid(hole: Hole, w: number, h: number): BinaryMask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w;
      data[y * w + x] = pointInHole(hole, nx, ny) ? 0 : 1;
    }
  }
  return { data, width: w, height: h };
}

// --- pose library --------------------------------------------------------
//
// A generous humanoid: fixed head/torso/hips, with arms and legs aimed at the
// given hand/foot targets. Radii are intentionally fat so a real body in the
// pose fits through with room to spare (leniency does the rest).

interface Limbs {
  handL: [number, number];
  handR: [number, number];
  footL: [number, number];
  footR: [number, number];
}

const SHOULDER_L: [number, number] = [0.385, 0.27];
const SHOULDER_R: [number, number] = [0.615, 0.27];
const HIP_L: [number, number] = [0.44, 0.57];
const HIP_R: [number, number] = [0.56, 0.57];

function humanoid(name: string, l: Limbs): Hole {
  const cap = (a: [number, number], b: [number, number], r: number): Capsule => ({
    kind: 'capsule',
    x0: a[0],
    y0: a[1],
    x1: b[0],
    y1: b[1],
    r,
  });
  return {
    name,
    shapes: [
      { kind: 'circle', cx: 0.5, cy: 0.14, r: 0.085 }, // head
      cap([0.5, 0.22], [0.5, 0.6], 0.135), // torso
      cap(SHOULDER_L, l.handL, 0.07), // left arm
      cap(SHOULDER_R, l.handR, 0.07), // right arm
      cap(HIP_L, l.footL, 0.08), // left leg
      cap(HIP_R, l.footR, 0.08), // right leg
    ],
  };
}

const FEET_TOGETHER = { footL: [0.45, 0.95] as [number, number], footR: [0.55, 0.95] as [number, number] };
const FEET_APART = { footL: [0.3, 0.93] as [number, number], footR: [0.7, 0.93] as [number, number] };

/** A small set of visually distinct poses; the arms are the main discriminator. */
export const POSES: Hole[] = [
  humanoid('Arms down', { handL: [0.33, 0.52], handR: [0.67, 0.52], ...FEET_TOGETHER }),
  humanoid('Arms up', { handL: [0.34, 0.06], handR: [0.66, 0.06], ...FEET_TOGETHER }),
  humanoid('T-pose', { handL: [0.16, 0.27], handR: [0.84, 0.27], ...FEET_TOGETHER }),
  humanoid('Star', { handL: [0.2, 0.07], handR: [0.8, 0.07], ...FEET_APART }),
];

/** Pick a pose, optionally avoiding the previous one so walls don't repeat. */
export function pickPose(rand: () => number = Math.random, avoid?: Hole): Hole {
  let pose = POSES[Math.floor(rand() * POSES.length)];
  if (avoid && POSES.length > 1) {
    while (pose === avoid) pose = POSES[Math.floor(rand() * POSES.length)];
  }
  return pose;
}
