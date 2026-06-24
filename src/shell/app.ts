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
import { audio } from '../juice/audio';
import { juice } from '../juice/juice';
import { capture } from '../juice/capture';
import { COLORS, rgba } from './theme';
import { showLoadingScreen, hideLoadingScreen } from './loadingScreen';
import { showOverlay, hideOverlay } from './overlay';
import { leaderboard } from './leaderboard';
import { renderShareCard, cardToBlob, downloadCard, copyCard } from './shareCard';
import * as screens from './screens';

type State = 'title' | 'menu' | 'calibrate' | 'countdown' | 'play' | 'gameover' | 'replay';

/** Per-game menu blurb (the contract stays minimal, so copy lives here). */
const BLURBS: Record<string, string> = {
  holeInWall: 'A wall with a person-shaped gap rushes you. Contort to fit — or get squashed.',
  simonSays: 'Mimic the hand sign before the timer runs out. Seated and laptop-friendly — just show your hand.',
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
  /** True once the lazy hand model has loaded — so we only show its loader once. */
  private handsReady = false;
  /** Stops the game-over replay-clip loop when we leave the screen. */
  private stopClipPreview: (() => void) | null = null;
  /** Reused offscreen canvas the death share card (Phase 8) is rendered into. */
  private shareCanvas = document.createElement('canvas');
  /** The finished run's score — for stamping the saved share-card filename. */
  private lastScore = 0;

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
    this.clearClipPreview();
    audio.startMusic(); // looping menu track (idempotent; no-op until audio is unlocked)
    audio.setIntensity(0);
    this.engine.clearActiveGame();
    screens.showMenu(
      allGames()
        .filter((g) => g.id !== 'test')
        .map((g) => ({
          id: g.id,
          title: g.title,
          intensity: g.intensity,
          blurb: BLURBS[g.id] ?? '',
          best: leaderboard.bests(g.id).allTime, // persisted across reloads (Phase 8)
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
    // game into its `waiting` phase, where it renders the live preview. Cover the
    // first hand-model download (seated games only) with the loading screen so the
    // menu→calibrate gap is never a dead frame. Body games never reach this.
    const needsHands = game.needs.includes('hands');
    if (needsHands && !this.handsReady) showLoadingScreen('Loading hand tracking…');
    try {
      await this.engine.setActiveGame(id);
    } catch (err) {
      // A model download failed (most likely the lazy hand model). Surface it
      // and bounce back to the menu instead of stalling on a calibration screen
      // that can never complete.
      hideLoadingScreen();
      showOverlay({
        title: "Couldn't load that game",
        body: err instanceof Error ? err.message : String(err),
        error: true,
        action: {
          label: 'Back to menu',
          onClick: () => {
            hideOverlay();
            void this.enterMenu();
          },
        },
      });
      return;
    }
    if (needsHands) {
      this.handsReady = true;
      hideLoadingScreen();
    }
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
    audio.beep(0); // "3"
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
    audio.beep(this.cdIndex); // "2" / "1" rising, then the "GO" downbeat
  }

  // --- play / game over ---------------------------------------------------

  private startPlay(): void {
    const game = this.game;
    if (!game) return;
    juice.reset(); // clear any stray effects from the previous run
    capture.start(); // begin the rolling replay-clip buffer
    game.configure?.(this.result ?? { profile: null });
    this.state = 'play';
    this.hudScore = -1;
    screens.hideAll(); // clear the countdown ("GO") before the HUD goes up
    screens.showHud(game.title, typeof game.health === 'function');
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
      // Music tightens as the run climbs (tempo up, lead octave past the midpoint).
      audio.setIntensity(Math.min(1, s / 12));
    }
    if (game.health) screens.setHudHealth(game.health());
  }

  private toGameOver(): void {
    const game = this.game;
    const score = game?.score() ?? 0;
    this.lastScore = score;
    // Read the game's flavor line before clearing it; build the card from the
    // freeze-frame the (now-stopped) capture buffer still holds.
    const tagline = game?.tagline?.() ?? '';
    const title = game?.title ?? '';
    this.state = 'gameover';
    this.clearClipPreview(); // stop any preview loop still running from a prior screen
    capture.stop(); // freeze the buffer; keep it for the preview + export
    audio.setIntensity(0);

    // Record the run (persists across reloads) and render the share card (Phase 8).
    const outcome = this.gameId ? leaderboard.record(this.gameId, score) : null;
    const source = capture.lastFrame();
    renderShareCard(this.shareCanvas, {
      score,
      game: title,
      caption: tagline,
      source,
      sourceW: source?.width,
      sourceH: source?.height,
    });
    if (outcome?.isAllTimeBest) audio.sting(); // celebrate a new personal best

    this.engine.clearActiveGame();

    const hasClip = capture.hasClip();
    screens.showGameOver({
      title: 'GAME OVER',
      score,
      best: outcome ? { value: outcome.allTimeBest, isRecord: outcome.isAllTimeBest } : undefined,
      onRetry: () => void this.retry(),
      onMenu: () => void this.enterMenu(),
      clip: hasClip ? { onSave: () => void this.saveClip() } : undefined,
      share: { onSave: () => void this.saveCard() },
    });

    // Preview hero: loop the motion clip when we have one, else show the static card.
    const preview = screens.gameOverPreviewCanvas();
    if (preview) {
      if (hasClip) this.stopClipPreview = capture.playPreview(preview);
      else this.blitShareCard(preview);
    }
  }

  /** Export the last couple of seconds to a WebM and download it (Phase 7). */
  private async saveClip(): Promise<void> {
    screens.setClipSaveLabel('Saving…');
    audio.click();
    const blob = await capture.exportWebM();
    if (blob) {
      capture.download(blob);
      screens.setClipSaveLabel('Saved ✓');
    } else {
      screens.setClipSaveLabel('Not supported');
    }
  }

  /** Download the death share card as a PNG and copy it to the clipboard (Phase 8). */
  private async saveCard(): Promise<void> {
    screens.setShareSaveLabel('Saving…');
    audio.click();
    const blob = await cardToBlob(this.shareCanvas);
    if (!blob) {
      screens.setShareSaveLabel('Not supported');
      return;
    }
    downloadCard(blob, `juke-${this.lastScore}.png`);
    const copied = await copyCard(blob);
    screens.setShareSaveLabel(copied ? 'Saved ✓ · copied' : 'Saved ✓');
  }

  /** Blit the rendered share card into the game-over preview canvas. */
  private blitShareCard(preview: HTMLCanvasElement): void {
    preview.width = this.shareCanvas.width;
    preview.height = this.shareCanvas.height;
    preview.getContext('2d')!.drawImage(this.shareCanvas, 0, 0);
  }

  private clearClipPreview(): void {
    this.stopClipPreview?.();
    this.stopClipPreview = null;
  }

  private async retry(): Promise<void> {
    if (!this.gameId) return;
    this.clearClipPreview();
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
    // Escape always backs out to the menu from any in-game state — so a player
    // is never trapped (e.g. on a calibration screen they can't satisfy).
    if (e.key === 'Escape') {
      if (this.state === 'calibrate' || this.state === 'countdown' || this.state === 'play' || this.state === 'gameover') {
        void this.enterMenu();
      }
      return;
    }
    if (e.key === 'Enter' && this.state === 'gameover') void this.retry();
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
