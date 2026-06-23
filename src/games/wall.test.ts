import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeSolid, pointInHole, POSES, pickPose, type Hole } from './wall.ts';
import { maskOverlap, type BinaryMask } from '../engine/mask.ts';

const circleHole: Hole = { name: 'c', shapes: [{ kind: 'circle', cx: 0.5, cy: 0.5, r: 0.25 }] };

test('pointInHole: inside a circle is true, outside is false', () => {
  assert.equal(pointInHole(circleHole, 0.5, 0.5), true);
  assert.equal(pointInHole(circleHole, 0.0, 0.0), false);
});

test('pointInHole: capsule is the thick segment, not the whole bounding box', () => {
  const cap: Hole = { name: 'cap', shapes: [{ kind: 'capsule', x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.5, r: 0.08 }] };
  assert.equal(pointInHole(cap, 0.5, 0.52), true); // on the segment
  assert.equal(pointInHole(cap, 0.5, 0.85), false); // far off it
});

test('rasterizeSolid: hole cells are 0 (clear), outside cells are 1 (solid)', () => {
  const solid = rasterizeSolid(circleHole, 10, 10);
  assert.equal(solid.data[5 * 10 + 5], 0); // center -> hole
  assert.equal(solid.data[0], 1); // corner -> solid
});

test('a player fully inside the hole has zero overlap with the solid wall (passes)', () => {
  const solid = rasterizeSolid(circleHole, 10, 10);
  const player: BinaryMask = { data: new Uint8Array(100), width: 10, height: 10 };
  player.data[5 * 10 + 5] = 1; // a body cell at the hole center
  assert.deepEqual(maskOverlap(player, solid), { hit: false, ratio: 0 });
});

test('a player over the solid wall registers overlap (fails)', () => {
  const solid = rasterizeSolid(circleHole, 10, 10);
  const player: BinaryMask = { data: new Uint8Array(100), width: 10, height: 10 };
  player.data[0] = 1; // a body cell in the corner -> solid wall
  assert.deepEqual(maskOverlap(player, solid), { hit: true, ratio: 1 });
});

test('every library pose carves a non-trivial hole (not all-solid, not all-open)', () => {
  for (const pose of POSES) {
    const solid = rasterizeSolid(pose, 48, 64);
    let open = 0;
    for (const c of solid.data) if (c === 0) open++;
    assert.ok(open > 0, `${pose.name} carved no hole`);
    assert.ok(open < solid.data.length, `${pose.name} is entirely open`);
  }
});

test('pickPose(avoid) never returns the avoided pose', () => {
  const a = POSES[0];
  for (let i = 0; i < 50; i++) assert.notEqual(pickPose(Math.random, a), a);
});
