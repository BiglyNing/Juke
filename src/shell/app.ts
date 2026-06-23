/**
 * The game shell (Phase 5): the wrapper that holds every game. It owns the
 * lifecycle state machine and the calibration step — both hoisted *out* of the
 * individual games so all games share one frame:
 *
 *   menu → calibrate → countdown → play → gameover → (retry → countdown | menu)
 *
 * The engine still owns the RAF loop and renders the active game; the shell
 * piggybacks on the engine's per-frame overlay hook (`tick`) to advance its own
 * lifecycle and draw the idle backdrop, and it drives the DOM screens in
 * `screens.ts`. During calibrate/countdown the active game sits in its
 * `waiting` phase rendering a live silhouette preview, so the shell never has
 * to duplicate perception drawing.
 */

import type { Engine, FrameStats } from '../engine/loop';
import type { PerceptionFrame } from '../engine/frame';
import { allGames, getGame, type JukeGame, type CalibrationResult } from '../engine/game';
import type { Producer } from '../engine/producer';
import { Calibrator, canCalibrate } from '../engine/calibration';
import { limbsFramed } from '../engine/pose';
import { COLORS, rgba } from './theme';
import * as screens from './screens';

type State = 'title' | 'menu' | 'calibrate' | 'countdown' | 'play' | 'gameover' | 'replay';

/** Per-game menu blurb (the contract stays minimal, so copy lives here). */
const BLURBS: Record<string, string> = {
  holeInWall: 'A wall with a person-shaped gap rushes you. Contort to fit — or get squashed.',
};

const SEATED_HOLD_MS = 1000; // hold a hand in view this long to pass seated calibration
const COUNTDOWN: { text: string; ms: number }[] = [
  { text: '3', ms: 650 },
  { text: '2', ms: 650 },
  { text: '1', ms: 650 },
  { text: 'GO', ms: 550 },
];

export class Shell {
  private engine: Engine;
  private state: State = 'title';

  private gameId: string | null = null;
  private game: JukeGame | null = null;

  private calibrator = new Calibrator();
  private result: CalibrationResult | null = null;
  private seatedHoldMs = 0;

  private cdIndex = 0;
  private cdTimer = 0;
  private hudScore = -1;

  constructor(engine: Engine) {
    this.engine = engine;
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Wire the live camera producer (called once perception is ready). */
  attachProducer(producer: Producer): void {
    this.engine.setProducer(producer);
  }

  // --- per-frame, driven by the engine overlay hook -----------------------

  tick(ctx: CanvasRenderingContext2D, frame: PerceptionFrame | null, stats: FrameStats): void {
    switch (this.state) {
      case 'calibrate':
        this.tickCalibrate(frame);
        break;
      case 'countdown':
        this.tickCountdown(frame);
        break;
      case 'play':
        this.tickPlay();
        break;
    }
    // Idle backdrop only where no game is rendering the canvas.
    if (this.state === 'title' || this.state === 'menu' || this.state === 'gameover') {
      this.drawIdle(ctx, stats.now);
    }
  }

  // --- menu ---------------------------------------------------------------

  async enterMenu(): Promise<void> {
    this.state = 'menu';
    this.game = null;
    this.gameId = null;
    this.engine.clearActiveGame();
    screens.showMenu(
      allGames()
        .filter((g) => g.id !== 'test')
        .map((g) => ({
          id: g.id,
          title: g.title,
          intensity: g.intensity,
          blurb: BLURBS[g.id] ?? '',
        })),
      (id) => void this.selectGame(id),
    );
  }

  private async selectGame(id: string): Promise<void> {
    const game = getGame(id);
    if (!game) return;
    this.gameId = id;
    this.game = game;
    screens.hideAll();
    // setActiveGame lazy-loads needs (e.g. the hand model) and resets+inits the
    // game into its `waiting` phase, where it renders the live preview.
    await this.engine.setActiveGame(id);
    this.calibrator.reset();
    this.seatedHoldMs = 0;
    this.result = null;
    this.state = 'calibrate';
    screens.showCalibrate(this.calibView(null));
  }

  // --- calibration --------------------------------------------------------

  private tickCalibrate(frame: PerceptionFrame | null): void {
    if (this.state !== 'calibrate') return;
    const view = this.calibView(frame);
    screens.updateCalibrate(view);

    if (this.game?.intensity === 'seated') {
      const handVisible = !!(frame?.hands && frame.hands.length > 0);
      this.seatedHoldMs = handVisible ? this.seatedHoldMs + (frame?.dt ?? 16) : 0;
      if (this.seatedHoldMs >= SEATED_HOLD_MS) {
        this.result = { profile: null };
        this.toCountdown();
      }
      return;
    }

    // Standing: accumulate calibration frames while the body (hands + legs) is
    // framed — feet are optional, so we never demand the player step all the way
    // back. The profile records whether feet were visible to adapt the poses.
    const pose = frame?.pose ?? null;
    const framed = pose ? limbsFramed(pose).bodyFramed && canCalibrate(pose) : false;
    if (framed) {
      const profile = this.calibrator.add(pose);
      if (profile) {
        this.result = { profile };
        this.toCountdown();
      }
    }
  }

  /** Build the calibration DOM view from the latest frame. */
  private calibView(frame: PerceptionFrame | null): screens.CalibView {
    if (this.game?.intensity === 'seated') {
      const handVisible = !!(frame?.hands && frame.hands.length > 0);
      return {
        intensity: 'seated',
        heading: handVisible ? 'HOLD IT' : 'SHOW YOUR HAND',
        hint: 'Hold an open hand up to the camera.',
        checks: [{ label: 'Hand in view', ok: handVisible }],
        progress: Math.min(1, this.seatedHoldMs / SEATED_HOLD_MS),
        ready: handVisible,
      };
    }
    const f = frame?.pose ? limbsFramed(frame.pose) : null;
    const ready = !!f?.bodyFramed && canCalibrate(frame?.pose ?? null);
    const feet = !!f?.ankleL && !!f?.ankleR;
    return {
      intensity: 'standing',
      heading: ready ? 'HOLD STILL' : 'STEP BACK',
      hint: ready
        ? feet
          ? 'Full body in frame — hold the pose.'
          : 'Legs in frame — hold still. (Show your feet too for wider poses.)'
        : 'Get your hands and legs in frame. Feet are optional. Plain background, face the light.',
      checks: [
        { label: 'Left hand', ok: !!f?.wristL },
        { label: 'Right hand', ok: !!f?.wristR },
        { label: 'Left leg', ok: !!f?.kneeL },
        { label: 'Right leg', ok: !!f?.kneeR },
      ],
      progress: this.calibrator.progress,
      ready,
    };
  }

  // --- countdown ----------------------------------------------------------

  private toCountdown(): void {
    this.state = 'countdown';
    this.cdIndex = 0;
    this.cdTimer = COUNTDOWN[0].ms;
    screens.showCountdown();
    screens.setCountdown(COUNTDOWN[0].text);
  }

  private tickCountdown(frame: PerceptionFrame | null): void {
    this.cdTimer -= frame?.dt ?? 16;
    if (this.cdTimer > 0) return;
    this.cdIndex++;
    if (this.cdIndex >= COUNTDOWN.length) {
      this.startPlay();
      return;
    }
    this.cdTimer = COUNTDOWN[this.cdIndex].ms;
    screens.setCountdown(COUNTDOWN[this.cdIndex].text);
  }

  // --- play / game over ---------------------------------------------------

  private startPlay(): void {
    const game = this.game;
    if (!game) return;
    game.configure?.(this.result ?? { profile: null });
    this.state = 'play';
    this.hudScore = -1;
    screens.hideAll(); // clear the countdown ("GO") before the HUD goes up
    screens.showHud(game.title);
  }

  private tickPlay(): void {
    const game = this.game;
    if (!game) return;
    if (game.isOver()) {
      this.toGameOver();
      return;
    }
    const s = game.score();
    if (s !== this.hudScore) {
      this.hudScore = s;
      screens.setHudScore(s);
    }
  }

  private toGameOver(): void {
    const score = this.game?.score() ?? 0;
    this.state = 'gameover';
    this.engine.clearActiveGame();
    screens.showGameOver({
      title: 'GAME OVER',
      score,
      onRetry: () => void this.retry(),
      onMenu: () => void this.enterMenu(),
    });
  }

  private async retry(): Promise<void> {
    if (!this.gameId) return;
    // Re-arm the same game (reset → waiting preview) and reuse the profile.
    await this.engine.setActiveGame(this.gameId);
    this.toCountdown();
  }

  // --- dev: headless fixture replay (F key / drag-drop) -------------------

  async enterReplay(producer: Producer): Promise<void> {
    this.attachProducer(producer);
    screens.hideAll();
    await this.engine.setActiveGame('test');
    this.game = getGame('test') ?? null;
    this.gameId = 'test';
    this.state = 'replay';
  }

  // --- input --------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (this.state === 'gameover') {
      if (e.key === 'Enter') void this.retry();
      else if (e.key === 'Escape') void this.enterMenu();
    } else if (this.state === 'play' && e.key === 'Escape') {
      void this.enterMenu();
    }
  }

  // --- idle backdrop ------------------------------------------------------

  private drawIdle(ctx: CanvasRenderingContext2D, now: number): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const pulse = 0.5 + 0.5 * Math.sin(now / 900);
    const r = Math.max(w, h) * (0.25 + pulse * 0.05);
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
    g.addColorStop(0, rgba(COLORS.teal, 0.05 + pulse * 0.06));
    g.addColorStop(0.6, rgba(COLORS.magenta, 0.03 + pulse * 0.03));
    g.addColorStop(1, rgba(COLORS.bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
