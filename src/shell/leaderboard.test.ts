import test from 'node:test';
import assert from 'node:assert/strict';
import { foldScore, dayStamp, type GameBests } from './leaderboard.ts';

test('dayStamp formats local YYYY-MM-DD with zero-padding', () => {
  assert.equal(dayStamp(new Date(2026, 0, 5)), '2026-01-05'); // Jan = month 0
  assert.equal(dayStamp(new Date(2026, 11, 31)), '2026-12-31');
});

test('first run sets both bests and flags both records', () => {
  const { next, outcome } = foldScore(undefined, 7, '2026-06-24');
  assert.deepEqual(next, { allTime: 7, daily: 7, dailyDate: '2026-06-24' });
  assert.equal(outcome.allTimeBest, 7);
  assert.equal(outcome.dailyBest, 7);
  assert.ok(outcome.isAllTimeBest);
  assert.ok(outcome.isDailyBest);
});

test('a worse run keeps the bests and flags no record', () => {
  const prev: GameBests = { allTime: 10, daily: 10, dailyDate: '2026-06-24' };
  const { next, outcome } = foldScore(prev, 4, '2026-06-24');
  assert.deepEqual(next, { allTime: 10, daily: 10, dailyDate: '2026-06-24' });
  assert.equal(outcome.isAllTimeBest, false);
  assert.equal(outcome.isDailyBest, false);
});

test('beating only the daily best (new day) does not falsely claim all-time', () => {
  const prev: GameBests = { allTime: 20, daily: 20, dailyDate: '2026-06-23' };
  const { next, outcome } = foldScore(prev, 12, '2026-06-24');
  // New day: daily best resets, so 12 is today's best but not the all-time best.
  assert.deepEqual(next, { allTime: 20, daily: 12, dailyDate: '2026-06-24' });
  assert.equal(outcome.isDailyBest, true);
  assert.equal(outcome.isAllTimeBest, false);
  assert.equal(outcome.allTimeBest, 20);
  assert.equal(outcome.dailyBest, 12);
});

test('the daily best rolls over when the stored day changes', () => {
  const prev: GameBests = { allTime: 30, daily: 30, dailyDate: '2026-06-23' };
  // Even a score below the all-time best becomes the new day's daily best.
  const { next } = foldScore(prev, 5, '2026-06-24');
  assert.equal(next.daily, 5);
  assert.equal(next.dailyDate, '2026-06-24');
  assert.equal(next.allTime, 30);
});

test('a zero score never counts as a best', () => {
  const { outcome } = foldScore(undefined, 0, '2026-06-24');
  assert.equal(outcome.isAllTimeBest, false);
  assert.equal(outcome.isDailyBest, false);
});

test('tying the best is not a new record (strictly greater wins)', () => {
  const prev: GameBests = { allTime: 8, daily: 8, dailyDate: '2026-06-24' };
  const { outcome } = foldScore(prev, 8, '2026-06-24');
  assert.equal(outcome.isAllTimeBest, false);
  assert.equal(outcome.isDailyBest, false);
});
