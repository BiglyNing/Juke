import test from 'node:test';
import assert from 'node:assert/strict';
import { limbAngle, jointAngle, fingerStates, limbsFramed, type Point } from './pose.ts';

const close = (a: number, b: number, eps = 1e-9): void =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('limbAngle: 0 along +x, +90 downward, -90 upward', () => {
  close(limbAngle({ x: 0, y: 0 }, { x: 1, y: 0 }), 0);
  close(limbAngle({ x: 0, y: 0 }, { x: 0, y: 1 }), 90);
  close(limbAngle({ x: 0, y: 0 }, { x: 0, y: -1 }), -90);
});

test('jointAngle: a right angle and a straight line', () => {
  close(jointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 90);
  close(jointAngle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180);
});

test('jointAngle returns 0 on a degenerate (zero-length) segment', () => {
  assert.equal(jointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 0);
});

test('limbsFramed: all four limbs visible -> allVisible true', () => {
  const pose: Point[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.9 }));
  const f = limbsFramed(pose);
  assert.deepEqual(f, { wristL: true, wristR: true, ankleL: true, ankleR: true, allVisible: true });
});

test('limbsFramed: a low-visibility ankle fails the gate', () => {
  const pose: Point[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.9 }));
  pose[27] = { x: 0, y: 0, visibility: 0.2 }; // left ankle occluded / out of frame
  const f = limbsFramed(pose);
  assert.equal(f.ankleL, false);
  assert.equal(f.allVisible, false);
});

test('fingerStates distinguishes extended from curled fingers', () => {
  const hand: Point[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  hand[0] = { x: 0, y: 0 }; // wrist
  hand[2] = { x: 1, y: 0 }; // thumb MCP
  hand[4] = { x: 2, y: 0 }; // thumb tip (farther -> extended)
  hand[6] = { x: 0, y: 2 }; // index PIP
  hand[8] = { x: 0, y: 4 }; // index tip (farther -> extended)
  hand[10] = { x: 1, y: 2 }; // middle PIP
  hand[12] = { x: 1, y: 1 }; // middle tip (closer -> curled)
  hand[14] = { x: 2, y: 2 }; // ring PIP
  hand[16] = { x: 2, y: 1 }; // ring tip (closer -> curled)
  hand[18] = { x: 3, y: 2 }; // pinky PIP
  hand[20] = { x: 3, y: 1 }; // pinky tip (closer -> curled)

  assert.deepEqual(fingerStates(hand), {
    thumb: true,
    index: true,
    middle: false,
    ring: false,
    pinky: false,
  });
});
