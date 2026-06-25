/**
 * Attract figure (Phase 9, second attempt) — a glowing wireframe person that
 * slowly cycles through wall-style poses behind the menu/landing, so the very
 * first frame of the live link is already *moving* and already reads as "a body
 * is the controller" — never a dead title card for a reviewer who won't stand up.
 *
 * Why procedural, not the bundled fixture: the first attempt replayed the raw
 * segmentation mask, which read as a drifting blob rather than a person and was
 * removed. A clean, authored stick-figure cycling the contortion poses (arms up,
 * T-pose, star, lean) is unmistakably a person and never depends on a webcam.
 *
 * Pure canvas drawing — `Shell.drawIdle` calls {@link drawAttractFigure} each
 * frame with the current time and a faint alpha so menu text stays crisp.
 */

import { COLORS, rgba } from './theme';

type Pt = readonly [number, number];

// Joints in a local space centred on the figure: x right, y down, the whole
// body spanning roughly [-0.5, 0.5] tall. Authored as keyframe poses below.
type Joint =
  | 'head' | 'neck' | 'pelvis'
  | 'shoulderL' | 'elbowL' | 'wristL'
  | 'shoulderR' | 'elbowR' | 'wristR'
  | 'hipL' | 'kneeL' | 'ankleL'
  | 'hipR' | 'kneeR' | 'ankleR';

type Pose = Record<Joint, Pt>;

// Bones to stroke (head is drawn separately as a ring at `head`).
const BONES: [Joint, Joint][] = [
  ['neck', 'pelvis'],
  ['neck', 'shoulderL'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
  ['neck', 'shoulderR'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['pelvis', 'hipL'], ['hipL', 'kneeL'], ['kneeL', 'ankleL'],
  ['pelvis', 'hipR'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
];

// Parts shared by every pose (torso + shoulders + hips don't move much).
const TORSO = {
  head: [0, -0.46], neck: [0, -0.33], pelvis: [0, 0.04],
  shoulderL: [-0.12, -0.31], shoulderR: [0.12, -0.31],
  hipL: [-0.08, 0.05], hipR: [0.08, 0.05],
} as const;

const STRAIGHT_LEGS = {
  kneeL: [-0.09, 0.27], ankleL: [-0.1, 0.49],
  kneeR: [0.09, 0.27], ankleR: [0.1, 0.49],
} as const;

// The pose cycle — the "contort to fit the wall" vocabulary.
const POSES: Pose[] = [
  // Arms up in a V.
  { ...TORSO, ...STRAIGHT_LEGS,
    elbowL: [-0.2, -0.42], wristL: [-0.28, -0.56],
    elbowR: [0.2, -0.42], wristR: [0.28, -0.56] },
  // T-pose.
  { ...TORSO, ...STRAIGHT_LEGS,
    elbowL: [-0.26, -0.31], wristL: [-0.42, -0.31],
    elbowR: [0.26, -0.31], wristR: [0.42, -0.31] },
  // Star / jumping-jack — arms out-up, legs apart.
  { ...TORSO,
    elbowL: [-0.27, -0.4], wristL: [-0.42, -0.5],
    elbowR: [0.27, -0.4], wristR: [0.42, -0.5],
    kneeL: [-0.17, 0.27], ankleL: [-0.26, 0.47],
    kneeR: [0.17, 0.27], ankleR: [0.26, 0.47] },
  // Lean — one arm reaching aside, a slight stride.
  { ...TORSO,
    elbowL: [-0.24, -0.18], wristL: [-0.36, -0.06],
    elbowR: [0.12, -0.16], wristR: [0.08, 0.02],
    kneeL: [-0.1, 0.27], ankleL: [-0.15, 0.48],
    kneeR: [0.09, 0.27], ankleR: [0.13, 0.47] },
];

const SEG_MS = 2300; // hold + transition per pose
const TRANS = 0.42; // fraction of a segment spent moving (rest is a hold)

const smooth = (t: number): number => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The current interpolated pose for time `now`. */
function poseAt(now: number): Pose {
  const seg = now / SEG_MS;
  const i = Math.floor(seg);
  const frac = seg - i;
  const t = frac < TRANS ? smooth(frac / TRANS) : 1;
  const from = POSES[((i % POSES.length) + POSES.length) % POSES.length];
  const to = POSES[(i + 1) % POSES.length];
  const out = {} as Pose;
  for (const k of Object.keys(from) as Joint[]) {
    out[k] = [mix(from[k][0], to[k][0], t), mix(from[k][1], to[k][1], t)];
  }
  return out;
}

/**
 * Draw the attract figure centred in `(w, h)` at the given peak `alpha`. Faint by
 * design — it's ambient motion behind the menu, not the focus.
 */
export function drawAttractFigure(
  ctx: CanvasRenderingContext2D,
  now: number,
  w: number,
  h: number,
  alpha: number,
): void {
  const pose = poseAt(now);
  const scale = Math.min(w, h) * 0.66;
  const cx = w / 2;
  const cy = h * 0.52 + Math.sin(now / 1600) * scale * 0.015; // gentle bob
  const px = (j: Joint): number => cx + pose[j][0] * scale;
  const py = (j: Joint): number => cy + pose[j][1] * scale;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = COLORS.teal;
  ctx.shadowBlur = scale * 0.05;

  // Bones — teal limbs.
  ctx.strokeStyle = rgba(COLORS.teal, alpha);
  ctx.lineWidth = scale * 0.022;
  ctx.beginPath();
  for (const [a, b] of BONES) {
    ctx.moveTo(px(a), py(a));
    ctx.lineTo(px(b), py(b));
  }
  ctx.stroke();

  // Head — a magenta ring sitting above the neck.
  const hx = px('head');
  const hy = py('head');
  const hr = scale * 0.06;
  ctx.shadowColor = COLORS.magenta;
  ctx.strokeStyle = rgba(COLORS.magenta, alpha);
  ctx.lineWidth = scale * 0.02;
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.stroke();

  // Joint dots — a touch of magenta where bones meet.
  ctx.shadowBlur = scale * 0.03;
  ctx.fillStyle = rgba(COLORS.magenta, alpha * 0.9);
  for (const j of ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR',
    'pelvis', 'kneeL', 'kneeR', 'ankleL', 'ankleR'] as Joint[]) {
    ctx.beginPath();
    ctx.arc(px(j), py(j), scale * 0.012, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
