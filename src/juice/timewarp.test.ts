import test from 'node:test';
import assert from 'node:assert/strict';
import { TimeWarp } from './timewarp.ts';

test('default scale is 1', () => {
  assert.equal(new TimeWarp().scale, 1);
});

test('freeze drives scale to 0, then recovers after its duration', () => {
  const tw = new TimeWarp();
  tw.freeze(200);
  assert.equal(tw.scale, 0);
  tw.update(199);
  assert.equal(tw.scale, 0, 'still frozen just before the end');
  tw.update(1);
  assert.equal(tw.scale, 1, 'back to normal once the freeze elapses');
});

test('slowmo reports its scale until it elapses', () => {
  const tw = new TimeWarp();
  tw.slowmo(0.3, 100);
  assert.equal(tw.scale, 0.3);
  tw.update(100);
  assert.equal(tw.scale, 1);
});

test('freeze takes priority over an active slowmo', () => {
  const tw = new TimeWarp();
  tw.slowmo(0.5, 500);
  tw.freeze(100);
  assert.equal(tw.scale, 0, 'frozen even though slowmo is also active');
  tw.update(100);
  assert.equal(tw.scale, 0.5, 'slowmo resumes after the freeze ends');
});

test('reset clears all warps', () => {
  const tw = new TimeWarp();
  tw.freeze(1000);
  tw.slowmo(0.2, 1000);
  tw.reset();
  assert.equal(tw.scale, 1);
});
