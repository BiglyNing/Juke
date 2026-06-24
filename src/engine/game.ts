/**
 * The game contract + registry (Phase 3).
 *
 * `JukeGame` is the single seam every game implements, so the engine can drive,
 * build, and cut games independently. Games are written *to this contract* (fed
 * a normalized {@link PerceptionFrame} each tick), never around the engine.
 * Keep it minimal — add fields only when a real game needs one.
 */

import type { PerceptionFrame } from './frame';
import type { BodyProfile } from './calibration';

/** Perception capabilities a game requires; drives lazy model loading. */
export type Need = 'pose' | 'hands';

/** How physical the game is; drives the calibration branch (Phase 5). */
export type Intensity = 'standing' | 'seated';

/**
 * What the shell's calibration step hands a game before a run starts (Phase 5).
 * Standing games build their level from `profile`; seated (hand) games need no
 * body profile, so it's null for them.
 */
export interface CalibrationResult {
  profile: BodyProfile | null;
}

export interface JukeGame {
  readonly id: string;
  readonly title: string;
  /** Perception this game needs; the producer lazy-loads the hand model only if 'hands' is here. */
  readonly needs: Need[];
  readonly intensity: Intensity;

  /** Called once when the game becomes active (after `reset`). Allocate here. */
  init(): void;
  /**
   * Optional (Phase 5): receive the shell's calibration output once the player
   * is framed and the countdown has finished — i.e. the moment play begins.
   * Standing games build their first level from `result.profile`. Games that
   * need no calibration data can omit this.
   */
  configure?(result: CalibrationResult): void;
  /** Advance simulation by a fixed `dt` (ms). Read perception from `frame`. */
  update(frame: PerceptionFrame, dt: number): void;
  /** Draw the game. The engine clears the canvas before this and draws the HUD after. */
  render(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void;
  /** Current score. */
  score(): number;
  /**
   * Optional (Phase 7): remaining health as 0..1 (1 = full). When a game exposes
   * it, the shell HUD renders a "crack meter" that drains as the run frays; games
   * without a soft-fail mechanic omit it and the HUD shows none — the same opt-in
   * pattern as `configure?`.
   */
  health?(): number;
  /** True when the run has ended (the shell reads this in Phase 5). */
  isOver(): boolean;
  /** Return to a fresh, pre-run state. Called before `init` on (re)activation. */
  reset(): void;
}

const registry = new Map<string, JukeGame>();

/** Register a game by its `id`. Throws on a duplicate id (a wiring bug). */
export function register(game: JukeGame): void {
  if (registry.has(game.id)) {
    throw new Error(`Duplicate game id registered: "${game.id}"`);
  }
  registry.set(game.id, game);
}

export function getGame(id: string): JukeGame | undefined {
  return registry.get(id);
}

/** All registered games, in registration order — the Phase 5 menu builds from this. */
export function allGames(): JukeGame[] {
  return [...registry.values()];
}
