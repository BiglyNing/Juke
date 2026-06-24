import test from 'node:test';
import assert from 'node:assert/strict';
import { Shake } from './shake.ts';

test('no trauma means no offset', () => {
  const s = new Shake();
  assert.deepEqual(s.offset(), { x: 0, y: 0 });
  assert.equal(s.active, false);
});

test('offset is bounded by maxPx', () => {
  const s = new Shake(30);
  s.add(1);
  // Sample across a range of phases; none may exceed the amplitude bound.
  for (let i = 0; i < 200; i++) {
    s.update(8);
    const o = s.offset();
    assert.ok(Math.abs(o.x) <= 30 + 1e-9, `|x|=${Math.abs(o.x)} exceeds maxPx`);
    assert.ok(Math.abs(o.y) <= 30 + 1e-9, `|y|=${Math.abs(o.y)} exceeds maxPx`);
    s.add(1); // keep it saturated to test the bound at full trauma
  }
});

test('trauma decays to zero on real time', () => {
  const s = new Shake(30, 500); // fully recovers ~500ms after a full hit
  s.add(1);
  assert.ok(s.active);
  s.update(600);
  assert.equal(s.active, false, 'trauma gone after the recovery window');
  assert.deepEqual(s.offset(), { x: 0, y: 0 });
});

test('add clamps trauma to 1 (offset never exceeds maxPx)', () => {
  const s = new Shake(10);
  s.add(5); // way over 1
  s.update(8);
  const o = s.offset();
  assert.ok(Math.abs(o.x) <= 10 + 1e-9 && Math.abs(o.y) <= 10 + 1e-9);
});

test('reset clears trauma immediately', () => {
  const s = new Shake();
  s.add(1);
  s.reset();
  assert.deepEqual(s.offset(), { x: 0, y: 0 });
});
