import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from './particles.ts';

// A fixed RNG so spawn geometry is deterministic (mid-range values).
const rngHalf = (): number => 0.5;

test('burst spawns the requested count', () => {
  const ps = new ParticleSystem();
  ps.burst({ x: 0, y: 0, count: 20, color: '#fff', rng: rngHalf });
  assert.equal(ps.count, 20);
});

test('burst never exceeds the capacity cap', () => {
  const ps = new ParticleSystem(10);
  ps.burst({ x: 0, y: 0, count: 8, color: '#fff', rng: rngHalf });
  ps.burst({ x: 0, y: 0, count: 8, color: '#fff', rng: rngHalf });
  assert.equal(ps.count, 10, 'second burst is clamped to remaining capacity');
});

test('update integrates velocity (no gravity, no drag)', () => {
  const ps = new ParticleSystem();
  // angle 0, spread 0 => purely +x velocity; rng 0.5 => speed = mean*(0.5+0.5)=mean.
  ps.burst({
    x: 0, y: 0, count: 1, color: '#fff', speed: 0.2, spread: 0, drag: 1, life: 1000, rng: rngHalf,
  });
  ps.update(100);
  const p = ps.particles[0];
  assert.ok(Math.abs(p.x - 20) < 1e-9, `x advanced to ${p.x}, expected ~20`);
  assert.ok(Math.abs(p.y) < 1e-9, 'no y motion without gravity/angle');
});

test('gravity accelerates downward', () => {
  const ps = new ParticleSystem();
  ps.burst({
    x: 0, y: 0, count: 1, color: '#fff', speed: 0, spread: 0, drag: 1, gravity: 0.001, life: 1000, rng: rngHalf,
  });
  ps.update(100);
  assert.ok(ps.particles[0].vy > 0, 'gravity gives positive (downward) vy');
  assert.ok(ps.particles[0].y > 0, 'particle has fallen');
});

test('particles are culled when their life expires', () => {
  const ps = new ParticleSystem();
  // rng 0.5 => life = mean*(0.6+0.5*0.8) = mean. mean 100 => life 100ms.
  ps.burst({ x: 0, y: 0, count: 5, color: '#fff', life: 100, rng: rngHalf });
  ps.update(99);
  assert.equal(ps.count, 5, 'still alive just under their lifetime');
  ps.update(2);
  assert.equal(ps.count, 0, 'all culled once past their lifetime');
});

test('clear empties the system', () => {
  const ps = new ParticleSystem();
  ps.burst({ x: 0, y: 0, count: 5, color: '#fff', rng: rngHalf });
  ps.clear();
  assert.equal(ps.count, 0);
});
