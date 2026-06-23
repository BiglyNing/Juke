/**
 * The game contract + registry (Phase 3).
 *
 * `JukeGame` is the single seam every game implements, so the engine can drive,
 * build, and cut games independently. Games are written *to this contract* (fed
 * a normalized {@link PerceptionFrame} each tick), never around the engine.
 * Keep it minimal — add fields only when a real game needs one.
 */

import type { PerceptionFrame } from './frame';

/** Perception capabilities a game requires; drives lazy model loading. */
export type Need = 'pose' | 'hands';

/** How physical the game is; drives the calibration branch (Phase 5). */
export type Intensity = 'standing' | 'seated';

export interface JukeGame {
  readonly id: string;
  readonly title: string;
  /** Perception this game needs; the producer lazy-loads the hand model only if 'hands' is here. */
  readonly needs: Need[];
  readonly intensity: Intensity;

  /** Called once when the game becomes active (after `reset`). Allocate here. */
  init(): void;
  /** Advance simulation by a fixed `dt` (ms). Read perception from `frame`. */
  update(frame: PerceptionFrame, dt: number): void;
  /** Draw the game. The engine clears the canvas before this and draws the HUD after. */
  render(ctx: CanvasRenderingContext2D, frame: PerceptionFrame): void;
  /** Current score. */
  score(): number;
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
