import test from 'node:test';
import assert from 'node:assert/strict';
import { downsample, smoothEMA, binarize, erode, maskOverlap, circleOverlapRatio, type Grid } from './mask.ts';

test('downsample averages source pixels into cells', () => {
  // 4x4, left half = 1, right half = 0 -> 2x2 -> left column 1, right column 0.
  const src = new Float32Array(16);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) src[y * 4 + x] = x < 2 ? 1 : 0;
  const g = downsample(src, 4, 4, 2, 2);
  assert.deepEqual(Array.from(g.data), [1, 0, 1, 0]);
  assert.equal(g.width, 2);
  assert.equal(g.height, 2);
});

test('downsample of a half-filled cell yields a fraction', () => {
  const g = downsample(new Float32Array([1, 0]), 2, 1, 1, 1);
  assert.equal(g.data[0], 0.5);
});

test('smoothEMA passes next through when prev is null', () => {
  const next: Grid = { data: new Float32Array([1, 1, 1, 1]), width: 2, height: 2 };
  assert.deepEqual(Array.from(smoothEMA(null, next, 0.5).data), [1, 1, 1, 1]);
});

test('smoothEMA blends prev and next by alpha', () => {
  const prev: Grid = { data: new Float32Array([0, 0, 0, 0]), width: 2, height: 2 };
  const next: Grid = { data: new Float32Array([1, 1, 1, 1]), width: 2, height: 2 };
  assert.deepEqual(Array.from(smoothEMA(prev, next, 0.5).data), [0.5, 0.5, 0.5, 0.5]);
});

test('binarize thresholds occupancy at the given level', () => {
  const g: Grid = { data: new Float32Array([0.2, 0.5, 0.8, 0.49]), width: 2, height: 2 };
  assert.deepEqual(Array.from(binarize(g, 0.5).data), [0, 1, 1, 0]);
});

test('erode by 1 removes the border of a full mask, leaving the inner core', () => {
  const out = erode({ data: new Uint8Array(16).fill(1), width: 4, height: 4 }, 1);
  const sum = out.data.reduce((a, b) => a + b, 0);
  assert.equal(sum, 4); // only the inner 2x2 survive
  assert.equal(out.data[1 * 4 + 1], 1); // an inner cell
  assert.equal(out.data[0], 0); // a corner cell
});

test('erode by 0 is an identity copy', () => {
  const out = erode({ data: new Uint8Array([1, 0, 1, 0]), width: 2, height: 2 }, 0);
  assert.deepEqual(Array.from(out.data), [1, 0, 1, 0]);
});

test('maskOverlap reports intersection over the area of a', () => {
  const a = { data: new Uint8Array([1, 1, 1, 0]), width: 2, height: 2 };
  const b = { data: new Uint8Array([1, 0, 1, 1]), width: 2, height: 2 };
  const { hit, ratio } = maskOverlap(a, b);
  assert.equal(hit, true);
  assert.equal(ratio, 2 / 3); // a has 3 cells; 2 of them fall inside b
});

test('maskOverlap of an empty silhouette is no hit, zero ratio', () => {
  const a = { data: new Uint8Array([0, 0, 0, 0]), width: 2, height: 2 };
  const b = { data: new Uint8Array([1, 1, 1, 1]), width: 2, height: 2 };
  assert.deepEqual(maskOverlap(a, b), { hit: false, ratio: 0 });
});

test('circleOverlapRatio: a circle over a full mask is fully covered', () => {
  const full = { data: new Uint8Array(64).fill(1), width: 8, height: 8 };
  assert.equal(circleOverlapRatio(full, 4, 4, 2), 1);
});

test('circleOverlapRatio: a circle over an empty mask covers nothing', () => {
  const empty = { data: new Uint8Array(64), width: 8, height: 8 };
  assert.equal(circleOverlapRatio(empty, 4, 4, 2), 0);
});

test('circleOverlapRatio: half-occupied mask covers about half the circle', () => {
  // Left half occupied; a circle centered on the seam should be ~50% covered.
  const data = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) data[y * 8 + x] = x < 4 ? 1 : 0;
  const ratio = circleOverlapRatio({ data, width: 8, height: 8 }, 4, 4, 3);
  assert.ok(ratio > 0.4 && ratio < 0.6, `expected ~0.5, got ${ratio}`);
});

test('circleOverlapRatio: a circle entirely off the grid is empty (0)', () => {
  const full = { data: new Uint8Array(64).fill(1), width: 8, height: 8 };
  assert.equal(circleOverlapRatio(full, -5, -5, 1), 0);
});
