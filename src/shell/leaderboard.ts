/**
 * Local leaderboard (Phase 8) — per-game daily-best + all-time best, persisted in
 * `localStorage`. Entirely client-side: no backend, no network. The retention
 * hook for the death moment ("beat your best"), and the proof that a score
 * survives a reload.
 *
 * The fold logic is pure (`foldScore` / `dayStamp`) so it's unit-tested without a
 * browser; the `Leaderboard` class is just a thin `localStorage` wrapper around
 * it that degrades to in-memory-only when storage is unavailable (private mode,
 * disabled cookies) — the game never breaks just because it can't persist.
 */

const STORAGE_KEY = 'juke.leaderboard.v1';

export interface GameBests {
  /** Highest score ever recorded for this game. */
  allTime: number;
  /** Highest score recorded on `dailyDate`. */
  daily: number;
  /** The local day (YYYY-MM-DD) the `daily` best belongs to. */
  dailyDate: string;
}

export interface ScoreOutcome {
  score: number;
  allTimeBest: number;
  dailyBest: number;
  /** The run beat the previous all-time best (and actually scored). */
  isAllTimeBest: boolean;
  /** The run beat the previous best for today (and actually scored). */
  isDailyBest: boolean;
}

export type Store = Record<string, GameBests>;

/** Local calendar day as YYYY-MM-DD — the daily-reset key. */
export function dayStamp(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pure: fold a finished run's `score` into a game's stored bests for `today`.
 * Rolls the daily best over when the stored day no longer matches `today`.
 * Returns the next record to persist plus what kind of best (if any) the run set,
 * so the UI can celebrate a record. A zero score never counts as a "best".
 */
export function foldScore(
  prev: GameBests | undefined,
  score: number,
  today: string,
): { next: GameBests; outcome: ScoreOutcome } {
  const prevAllTime = prev?.allTime ?? 0;
  const prevDaily = prev && prev.dailyDate === today ? prev.daily : 0;
  const allTimeBest = Math.max(prevAllTime, score);
  const dailyBest = Math.max(prevDaily, score);
  return {
    next: { allTime: allTimeBest, daily: dailyBest, dailyDate: today },
    outcome: {
      score,
      allTimeBest,
      dailyBest,
      isAllTimeBest: score > prevAllTime && score > 0,
      isDailyBest: score > prevDaily && score > 0,
    },
  };
}

class Leaderboard {
  /** Record a finished run; persist the new bests and return what it achieved. */
  record(gameId: string, score: number): ScoreOutcome {
    const store = this.read();
    const { next, outcome } = foldScore(store[gameId], score, dayStamp());
    store[gameId] = next;
    this.write(store);
    return outcome;
  }

  /** Current bests for a game (daily reset to 0 once the stored day rolls over). */
  bests(gameId: string): { allTime: number; daily: number } {
    const b = this.read()[gameId];
    const today = dayStamp();
    return {
      allTime: b?.allTime ?? 0,
      daily: b && b.dailyDate === today ? b.daily : 0,
    };
  }

  private read(): Store {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
    } catch {
      return {}; // private mode / disabled storage / corrupt JSON — play on, just don't persist
    }
  }

  private write(store: Store): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* storage full / unavailable — non-fatal, the run just isn't saved */
    }
  }
}

/** The one shared leaderboard instance. */
export const leaderboard = new Leaderboard();
