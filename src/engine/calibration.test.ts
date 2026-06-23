import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfile, canCalibrate, Calibrator, type BodyProfile } from './calibration.ts';
import type { Point } from './pose.ts';

/** A 33-landmark pose; everything visible by default, shoulders/hips/limbs placed. */
function makePose(opts: { ankles?: boolean; wrists?: boolean; shoulders?: boolean } = {}): Point[] {
  const ankles = opts.ankles ?? true;
  const wrists = opts.wrists ?? true;
  const shoulders = opts.shoulders ?? true;
  const p: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  p[0] = { x: 0.5, y: 0.2, visibility: 0.9 }; // nose
  p[11] = { x: 0.4, y: 0.3, visibility: shoulders ? 0.9 : 0.1 }; // L shoulder
  p[12] = { x: 0.6, y: 0.3, visibility: shoulders ? 0.9 : 0.1 }; // R shoulder
  p[15] = { x: 0.38, y: 0.5, visibility: wrists ? 0.9 : 0.1 }; // L wrist
  p[16] = { x: 0.62, y: 0.5, visibility: wrists ? 0.9 : 0.1 }; // R wrist
  p[23] = { x: 0.45, y: 0.6, visibility: 0.9 }; // L hip
  p[24] = { x: 0.55, y: 0.6, visibility: 0.9 }; // R hip
  p[27] = { x: 0.45, y: 0.9, visibility: ankles ? 0.9 : 0.1 }; // L ankle
  p[28] = { x: 0.55, y: 0.9, visibility: ankles ? 0.9 : 0.1 }; // R ankle
  return p;
}

test('canCalibrate needs shoulders and hips visible', () => {
  assert.equal(canCalibrate(makePose()), true);
  assert.equal(canCalibrate(makePose({ shoulders: false })), false);
  assert.equal(canCalibrate(null), false);
});

test('buildProfile derives size and detects legs when ankles are visible', () => {
  const prof = buildProfile(makePose()) as BodyProfile;
  assert.ok(prof);
  assert.ok(Math.abs(prof.unit - 0.2) < 1e-6, 'shoulder-width unit');
  assert.equal(prof.hasLegs, true);
  assert.equal(prof.hasArms, true);
  assert.ok(prof.torsoR > 0 && prof.limbR > 0);
});

test('buildProfile: no visible ankles -> hasLegs false (seated / close player)', () => {
  const prof = buildProfile(makePose({ ankles: false })) as BodyProfile;
  assert.equal(prof.hasLegs, false);
  assert.ok(prof.legLen > 0, 'still has a fallback leg length');
});

test('buildProfile returns null without shoulders/hips', () => {
  assert.equal(buildProfile(makePose({ shoulders: false })), null);
});

test('Calibrator yields a profile only after enough frames', () => {
  const cal = new Calibrator(3);
  assert.equal(cal.add(makePose()), null);
  assert.equal(cal.add(makePose()), null);
  const prof = cal.add(makePose());
  assert.ok(prof, 'third frame completes calibration');
  assert.equal(cal.progress, 1);
});

test('Calibrator ignores frames where the player is not framed', () => {
  const cal = new Calibrator(2);
  assert.equal(cal.add(null), null);
  assert.equal(cal.add(makePose({ shoulders: false })), null);
  assert.equal(cal.progress, 0, 'bad frames do not advance progress');
});
