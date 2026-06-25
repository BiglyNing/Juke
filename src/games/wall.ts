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

// --- profile-driven poses ------------------------------------------------
//
// A pose is a *variation* — a direction for each limb — applied to the player's
// calibrated body. The hole's anchors (head/torso/shoulders/hips) come straight
// from the BodyProfile, so the hole is always the player's size and position; the
// variation just aims the limbs. Legs are added whenever the player's legs (knees)
// were in frame — feet optional; wide-stance poses (`needsFeet`) only appear when
// the feet are framed too. A truly close/seated player (no knees) gets upper-body
// holes.

import type { BodyProfile, Vec } from '../engine/calibration';

export interface Variation {
  name: string;
  /** If true, this wide-stance pose is only offered when the player's feet are in frame. */
  needsFeet: boolean;
  /**
   * Fatten the hole's circle/capsule radii by this factor (default 1). Poses with a
   * narrow silhouette — the leans (arms swung to one side) and the arms-near-center
   * poses — are otherwise unforgiving, so we give them a wider hole to fit through.
   */
  widen?: number;
  /**
   * Draw the legs as one centered column instead of a split pair. The "turn" poses
   * want the player to rotate their whole body sideways; a divided-leg hole reads as
   * "stand and splay your legs", which confuses people — a single column reads "turn".
   */
  legsTogether?: boolean;
  /** Limb aim directions (frame space, y points down); magnitude is normalized. */
  armL: Vec;
  armR: Vec;
  legL?: Vec;
  legR?: Vec;
}

/** A small set of distinct poses; arms are the main discriminator. */
export const VARIATIONS: Variation[] = [
  { name: 'Arms up', needsFeet: false, widen: 1.3, armL: { x: -0.25, y: -1 }, armR: { x: 0.25, y: -1 } },
  { name: 'T-pose', needsFeet: false, armL: { x: -1, y: -0.05 }, armR: { x: 1, y: -0.05 } },
  { name: 'Arms down', needsFeet: false, widen: 1.3, armL: { x: -0.35, y: 1 }, armR: { x: 0.35, y: 1 } },
  { name: 'Cactus', needsFeet: false, armL: { x: -0.7, y: -0.7 }, armR: { x: 0.7, y: -0.7 } },
  // Diagonal one-up/one-down poses: asymmetric, so a small arm misalignment spills
  // onto the wall — widened to stay fair.
  { name: 'One arm up', needsFeet: false, widen: 1.3, armL: { x: -0.3, y: -1 }, armR: { x: 0.35, y: 1 } },
  // Diagonal "disco" — mirror of One arm up so they don't read as the same pose.
  { name: 'Disco', needsFeet: false, widen: 1.3, armL: { x: -0.5, y: 0.85 }, armR: { x: 0.5, y: -1 } },
  // Turn your whole body sideways: both arms swung to one side over a single leg
  // column (no split), so the silhouette reads as a turn, not a wide stance. Narrow,
  // so the hole gets widened to stay fair.
  { name: 'Turn left', needsFeet: false, widen: 1.35, legsTogether: true, armL: { x: -1, y: -0.25 }, armR: { x: -0.5, y: 0.5 } },
  { name: 'Turn right', needsFeet: false, widen: 1.35, legsTogether: true, armL: { x: 0.5, y: 0.5 }, armR: { x: 1, y: -0.25 } },
  {
    name: 'Star',
    needsFeet: true,
    armL: { x: -0.8, y: -1 },
    armR: { x: 0.8, y: -1 },
    legL: { x: -0.6, y: 1 },
    legR: { x: 0.6, y: 1 },
  },
  // T-pose arms with a wide stance — only when the feet are framed.
  {
    name: 'Scarecrow',
    needsFeet: true,
    armL: { x: -1, y: -0.05 },
    armR: { x: 1, y: -0.05 },
    legL: { x: -0.5, y: 1 },
    legR: { x: 0.5, y: 1 },
  },
  // Arms down-and-out over a near-vertical stance (legs run off the bottom edge).
  {
    name: 'Skier',
    needsFeet: true,
    armL: { x: -0.45, y: 0.9 },
    armR: { x: 0.45, y: 0.9 },
    legL: { x: -0.2, y: 1 },
    legR: { x: 0.2, y: 1 },
  },
];

function norm(v: Vec): Vec {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}
function reach(from: Vec, dir: Vec, len: number): Vec {
  const d = norm(dir);
  return { x: clamp01(from.x + d.x * len), y: clamp01(from.y + d.y * len) };
}
function clamp01(x: number): number {
  return Math.max(0.02, Math.min(0.98, x));
}

// Legs run off the bottom edge of the frame: a standing player's legs always
// reach the floor, so if the hole's legs stopped mid-frame the solid wall below
// them would clip the player's shins and force a jump to clear it. Extending the
// leg capsules past the bottom keeps that strip open, so only the leg *angle*
// (the sideways spread near the hips) is judged, never their length.
const LEG_OFFSCREEN_Y = 1.2; // below the visible 0..1 frame

/** A leg endpoint that runs off the bottom edge, following `dir`'s sideways spread. */
function reachLeg(from: Vec, dir: Vec): Vec {
  const d = norm(dir);
  const dy = Math.max(0.25, d.y); // always travelling downward, never flat
  const t = (LEG_OFFSCREEN_Y - from.y) / dy; // distance to clear the bottom edge
  return { x: clamp01(from.x + d.x * t), y: LEG_OFFSCREEN_Y };
}

/** Build a wall hole for `v`, fitted to the calibrated `p`. */
export function holeFromProfile(p: BodyProfile, v: Variation): Hole {
  const cap = (a: Vec, b: Vec, r: number): Capsule => ({ kind: 'capsule', x0: a.x, y0: a.y, x1: b.x, y1: b.y, r });
  // Narrow poses (leans, arms-near-center) get a wider hole so they're not unfair.
  const w = v.widen ?? 1;
  const headR = p.headR * w;
  const torsoR = p.torsoR * w;
  const limbR = p.limbR * w;
  const shapes: Shape[] = [
    { kind: 'circle', cx: p.head.x, cy: p.head.y, r: headR },
    cap(p.neck, p.pelvis, torsoR),
    cap(p.shoulderL, reach(p.shoulderL, v.armL, p.armLen), limbR),
    cap(p.shoulderR, reach(p.shoulderR, v.armR, p.armLen), limbR),
  ];
  if (p.hasLegs) {
    if (v.legsTogether) {
      // One centered column running off the bottom — a turned-sideways body, no split.
      shapes.push(cap(p.pelvis, reachLeg(p.pelvis, { x: 0, y: 1 }), limbR));
    } else {
      shapes.push(
        cap(p.hipL, reachLeg(p.hipL, v.legL ?? { x: -0.15, y: 1 }), limbR),
        cap(p.hipR, reachLeg(p.hipR, v.legR ?? { x: 0.15, y: 1 }), limbR),
      );
    }
  }
  return { name: v.name, shapes };
}

/** Pick a variation valid for this body (no wide-stance poses without feet), avoiding a repeat. */
export function pickVariation(
  profile: BodyProfile,
  rand: () => number = Math.random,
  avoid?: Variation,
): Variation {
  const pool = VARIATIONS.filter((v) => profile.hasFeet || !v.needsFeet);
  let pick = pool[Math.floor(rand() * pool.length)];
  if (avoid && pool.length > 1) {
    while (pick === avoid) pick = pool[Math.floor(rand() * pool.length)];
  }
  return pick;
}
