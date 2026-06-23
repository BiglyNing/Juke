import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayFixture, type Fixture } from './fixture.ts';
import { smoothEMA, binarize, erode, maskOverlap, type Grid, type BinaryMask } from './mask.ts';

// A small committed recording: a 3x3 silhouette block sliding rightward across
// an 8x8 frame (see __fixtures__/sample.json). The "wall" is solid on the right
// half (cols 4-7), so as the block advances it overlaps the wall more and more.
const fixture: Fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/sample.json', import.meta.url), 'utf8'),
);

function solidFromColumn(w: number, h: number, fromCol: number): BinaryMask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = x >= fromCol ? 1 : 0;
  }
  return { data, width: w, height: h };
}

const WALL = solidFromColumn(8, 8, 4);

// Fresh pipeline closure each run so EMA history doesn't leak between replays.
function makePipeline() {
  let prev: Grid | null = null;
  return ({ grid }: { grid: Grid }) => {
    const smoothed = smoothEMA(prev, grid, 0.5);
    prev = smoothed;
    const player = erode(binarize(smoothed, 0.5), 0);
    return maskOverlap(player, WALL);
  };
}

test('headless replay is deterministic across runs', () => {
  const first = replayFixture(fixture, makePipeline());
  const second = replayFixture(fixture, makePipeline());
  assert.deepEqual(first, second);
});

test('overlap ratio climbs as the silhouette enters the wall', () => {
  const ratios = replayFixture(fixture, makePipeline()).map((r) => r.ratio);
  assert.deepEqual(ratios, [0, 0.25, 0.5]);
});

test('first frame is a clean miss; later frames register hits', () => {
  const hits = replayFixture(fixture, makePipeline()).map((r) => r.hit);
  assert.deepEqual(hits, [false, true, true]);
});
