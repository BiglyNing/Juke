import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyGameId, foldDaily, dayDiff, type DailyState } from './daily.ts';

test('dayDiff counts whole calendar days, signed', () => {
  assert.equal(dayDiff('2026-06-24', '2026-06-25'), 1);
  assert.equal(dayDiff('2026-06-24', '2026-06-24'), 0);
  assert.equal(dayDiff('2026-06-25', '2026-06-24'), -1);
  assert.equal(dayDiff('2026-06-24', '2026-07-01'), 7); // across a month boundary
});

test('dailyGameId is deterministic and rotates with the date', () => {
  const ids = ['holeInWall', 'simonSays', 'dodge'];
  assert.equal(dailyGameId(ids, '2026-06-24'), dailyGameId(ids, '2026-06-24')); // stable
  // Over a week the pick lands on more than one game (it is not a constant).
  const week = new Set(
    ['24', '25', '26', '27', '28', '29', '30'].map((d) => dailyGameId(ids, `2026-06-${d}`)),
  );
  assert.ok(week.size > 1);
  // Every pick is from the pool.
  for (const id of week) assert.ok(ids.includes(id));
});

test('dailyGameId handles an empty pool', () => {
  assert.equal(dailyGameId([], '2026-06-24'), '');
});

test('first run sets the best and starts the streak at 1', () => {
  const { next, outcome } = foldDaily(undefined, 7, '2026-06-24');
  assert.deepEqual(next, { best: 7, bestDate: '2026-06-24', streak: 1, streakDate: '2026-06-24' });
  assert.equal(outcome.isBest, true);
  assert.equal(outcome.streak, 1);
  assert.equal(outcome.isStreakExtended, false);
});

test('a consecutive day extends the streak', () => {
  const prev: DailyState = { best: 7, bestDate: '2026-06-24', streak: 3, streakDate: '2026-06-24' };
  const { next, outcome } = foldDaily(prev, 4, '2026-06-25');
  assert.equal(next.streak, 4);
  assert.equal(outcome.isStreakExtended, true);
  // New day's best resets from 0, so even a low score becomes today's best.
  assert.equal(next.best, 4);
  assert.equal(next.bestDate, '2026-06-25');
});

test('a second run on the same day holds the streak and keeps the best', () => {
  const prev: DailyState = { best: 10, bestDate: '2026-06-24', streak: 2, streakDate: '2026-06-24' };
  const { next, outcome } = foldDaily(prev, 6, '2026-06-24');
  assert.equal(next.streak, 2); // not double-counted
  assert.equal(outcome.isStreakExtended, false);
  assert.equal(next.best, 10); // worse run doesn't lower the best
  assert.equal(outcome.isBest, false);
});

test('a skipped day resets the streak to 1', () => {
  const prev: DailyState = { best: 9, bestDate: '2026-06-24', streak: 5, streakDate: '2026-06-24' };
  const { next, outcome } = foldDaily(prev, 3, '2026-06-26'); // skipped the 25th
  assert.equal(next.streak, 1);
  assert.equal(outcome.isStreakExtended, false);
});

test('a zero score still counts for the streak but never as a best', () => {
  const prev: DailyState = { best: 5, bestDate: '2026-06-24', streak: 1, streakDate: '2026-06-24' };
  const { next, outcome } = foldDaily(prev, 0, '2026-06-25');
  assert.equal(next.streak, 2); // showed up
  assert.equal(outcome.isBest, false);
  assert.equal(next.best, 0); // new day, no real score yet
});
