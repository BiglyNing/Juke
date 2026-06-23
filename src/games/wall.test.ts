import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rasterizeSolid,
  pointInHole,
  holeFromProfile,
  pickVariation,
  VARIATIONS,
  type Hole,
} from './wall.ts';
import { maskOverlap, type BinaryMask } from '../engine/mask.ts';
import type { BodyProfile } from '../engine/calibration.ts';

const circleHole: Hole = { name: 'c', shapes: [{ kind: 'circle', cx: 0.5, cy: 0.5, r: 0.25 }] };

// A synthetic standing profile (legs in frame).
const standing: BodyProfile = {
  head: { x: 0.5, y: 0.15 },
  headR: 0.08,
  neck: { x: 0.5, y: 0.25 },
  pelvis: { x: 0.5, y: 0.55 },
  shoulderL: { x: 0.4, y: 0.27 },
  shoulderR: { x: 0.6, y: 0.27 },
  hipL: { x: 0.45, y: 0.55 },
  hipR: { x: 0.55, y: 0.55 },
  unit: 0.2,
  armLen: 0.25,
  legLen: 0.35,
  torsoR: 0.12,
  limbR: 0.06,
  hasArms: true,
  hasLegs: true,
  hasFeet: true,
};
// Legs (knees) in frame but feet cropped — gets leg poses, no wide-stance ones.
const legsNoFeet: BodyProfile = { ...standing, hasFeet: false };
// Truly close/seated — no legs at all.
const seated: BodyProfile = { ...standing, hasLegs: false, hasFeet: false };

test('pointInHole: inside a circle is true, outside is false', () => {
  assert.equal(pointInHole(circleHole, 0.5, 0.5), true);
  assert.equal(pointInHole(circleHole, 0.0, 0.0), false);
});

test('rasterizeSolid: hole cells are 0 (clear), outside cells are 1 (solid)', () => {
  const solid = rasterizeSolid(circleHole, 10, 10);
  assert.equal(solid.data[5 * 10 + 5], 0); // center -> hole
  assert.equal(solid.data[0], 1); // corner -> solid
});

test('a player inside the hole passes; over the solid wall fails', () => {
  const solid = rasterizeSolid(circleHole, 10, 10);
  const inside: BinaryMask = { data: new Uint8Array(100), width: 10, height: 10 };
  inside.data[5 * 10 + 5] = 1;
  assert.deepEqual(maskOverlap(inside, solid), { hit: false, ratio: 0 });
  const outside: BinaryMask = { data: new Uint8Array(100), width: 10, height: 10 };
  outside.data[0] = 1;
  assert.deepEqual(maskOverlap(outside, solid), { hit: true, ratio: 1 });
});

test('holeFromProfile: standing body carves a non-trivial hole with legs', () => {
  const armsUp = VARIATIONS.find((v) => v.name === 'Arms up')!;
  const hole = holeFromProfile(standing, armsUp);
  assert.equal(hole.shapes.length, 6); // head + torso + 2 arms + 2 legs
  const solid = rasterizeSolid(hole, 48, 64);
  let open = 0;
  for (const c of solid.data) if (c === 0) open++;
  assert.ok(open > 0 && open < solid.data.length, 'hole should be partially open');
});

test('holeFromProfile: a legless (seated) body omits the leg capsules', () => {
  const armsUp = VARIATIONS.find((v) => v.name === 'Arms up')!;
  assert.equal(holeFromProfile(seated, armsUp).shapes.length, 4); // head + torso + 2 arms
});

test('holeFromProfile: knees-in-frame but feet-cropped body still carves legs', () => {
  const armsUp = VARIATIONS.find((v) => v.name === 'Arms up')!;
  assert.equal(holeFromProfile(legsNoFeet, armsUp).shapes.length, 6); // head + torso + 2 arms + 2 legs
});

test('pickVariation never offers a wide-stance (feet) pose to a body without feet', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(pickVariation(seated, Math.random).needsFeet, false);
    assert.equal(pickVariation(legsNoFeet, Math.random).needsFeet, false);
  }
});

test('pickVariation(avoid) does not repeat the previous pose', () => {
  const a = VARIATIONS[0];
  for (let i = 0; i < 50; i++) assert.notEqual(pickVariation(standing, Math.random, a), a);
});
