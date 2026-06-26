/**
 * Daily Challenge (Phase 12) — one featured game per calendar day, the same for
 * everyone, rotating deterministically from the date. It gives the menu a "come
 * back tomorrow" hook on top of the per-game leaderboard: a best for *today's*
 * pick plus a play streak that grows each consecutive day you finish a run and
 * resets when you skip one (the Wordle pattern).
 *
 * The pick + fold logic is pure (`dailyGameId` / `foldDaily` / `dayDiff`) so it's
 * unit-tested without a browser; the `Daily` class is a thin `localStorage`
 * wrapper that degrades to in-memory-only when storage is unavailable — same
 * resilience contract as `leaderboard.ts`, whose `dayStamp` it reuses for the
 * day key.
 */

import { dayStamp } from './leaderboard.ts';

const STORAGE_KEY = 'juke.daily.v1';

export interface DailyState {
  /** Highest score on the day `bestDate`. */
  best: number;
  /** The local day (YYYY-MM-DD) `best` belongs to. */
  bestDate: string;
  /** Consecutive days the challenge has been completed. */
  streak: number;
  /** The local day (YYYY-MM-DD) the streak was last extended. */
  streakDate: string;
}

export interface DailyOutcome {
  score: number;
  /** Today's best after folding in this run. */
  best: number;
  /** The run beat the previous best for today (and actually scored). */
  isBest: boolean;
  /** The streak after this run (1 on a fresh/broken streak). */
  streak: number;
  /** This run extended an existing streak (yesterday → today). */
  isStreakExtended: boolean;
}

/** Parse a YYYY-MM-DD day key to a UTC-midnight epoch (for whole-day diffs). */
function parseDay(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function dayDiff(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / 86_400_000);
}

/** Stable, order-independent hash of a day key → non-negative int. */
function hashDay(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * Pure: pick the featured game id for `today` from `ids`, deterministically — so
 * the same date always yields the same game and it rotates as the date advances.
 * Returns `''` for an empty pool (no games registered yet).
 */
export function dailyGameId(ids: string[], today: string): string {
  if (ids.length === 0) return '';
  return ids[hashDay(today) % ids.length];
}

/**
 * Pure: fold a finished daily run's `score` into the stored state for `today`.
 * Rolls the best over on a new day; extends the streak when the last play was
 * yesterday, holds it when already played today, and resets it to 1 after a gap.
 * A zero score still counts toward the streak (you showed up), but never as a best.
 */
export function foldDaily(
  prev: DailyState | undefined,
  score: number,
  today: string,
): { next: DailyState; outcome: DailyOutcome } {
  const prevBest = prev && prev.bestDate === today ? prev.best : 0;
  const best = Math.max(prevBest, score);

  let streak: number;
  let isStreakExtended = false;
  if (!prev) {
    streak = 1;
  } else if (prev.streakDate === today) {
    streak = prev.streak; // already counted a run today — don't double-count
  } else if (dayDiff(prev.streakDate, today) === 1) {
    streak = prev.streak + 1; // consecutive day
    isStreakExtended = true;
  } else {
    streak = 1; // gap (or a clock moved backwards) — start over
  }

  return {
    next: { best, bestDate: today, streak, streakDate: today },
    outcome: { score, best, isBest: score > prevBest && score > 0, streak, isStreakExtended },
  };
}

class Daily {
  /** The featured game id for today, chosen from the given pool. */
  gameId(ids: string[]): string {
    return dailyGameId(ids, dayStamp());
  }

  /**
   * Live view for the menu: today's best (0 if not played today) and the current
   * streak — counted as live only if the last play was today or yesterday,
   * otherwise it has lapsed and reads 0.
   */
  view(): { best: number; streak: number } {
    const s = this.read();
    const today = dayStamp();
    const best = s && s.bestDate === today ? s.best : 0;
    const live = !!s && dayDiff(s.streakDate, today) <= 1 && dayDiff(s.streakDate, today) >= 0;
    return { best, streak: live ? s!.streak : 0 };
  }

  /** Record a finished daily run; persist the new state and return what it achieved. */
  record(score: number): DailyOutcome {
    const { next, outcome } = foldDaily(this.read(), score, dayStamp());
    this.write(next);
    return outcome;
  }

  private read(): DailyState | undefined {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as DailyState) : undefined;
    } catch {
      return undefined; // private mode / disabled storage / corrupt JSON — play on
    }
  }

  private write(state: DailyState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full / unavailable — non-fatal, the run just isn't saved */
    }
  }
}

/** The one shared daily-challenge instance. */
export const daily = new Daily();
