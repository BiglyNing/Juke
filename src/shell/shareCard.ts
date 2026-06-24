/**
 * Result share card (Phase 8) — turns the death freeze-frame into a downloadable,
 * branded PNG: the last clean game frame rendered as a neon-duotone silhouette,
 * with the score, the game, and a flavor caption. This is the shareable artifact
 * for an online, link-first submission, and the raw material the Phase 9
 * README/GIF lean on.
 *
 * `renderShareCard` has no DOM side effects — it just draws onto a canvas — so
 * the shell can both show it as a preview and export it. Export is a PNG download
 * plus a best-effort clipboard copy; both degrade gracefully where unsupported.
 */

import { COLORS, FONT, rgba } from './theme';

const CARD_W = 1200;
const CARD_H = 675; // 16:9 — the OG/Twitter card ratio, and the camera feed's shape
const LIVE_URL = 'biglyning.github.io/Juke';

export interface ShareCardData {
  score: number;
  /** Game title (e.g. "Hole in the Wall"). */
  game: string;
  /** Short flavor line — the pose that crushed you, a top streak, etc. */
  caption?: string;
  /** The death freeze-frame (clean, no dev HUD). Drawn as the neon backdrop. */
  source: CanvasImageSource | null;
  sourceW?: number;
  sourceH?: number;
}

/** Draw the share card onto `canvas` (resizing it to the card). Returns it. */
export function renderShareCard(canvas: HTMLCanvasElement, data: ShareCardData): HTMLCanvasElement {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;

  // Base fill (also the backdrop when there's no freeze-frame to show).
  ctx.fillStyle = COLORS.base;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Freeze-frame → neon duotone: cover the card, desaturate, then tint by a
  // teal→magenta gradient keyed to image brightness ('color' keeps luminance).
  if (data.source) {
    ctx.save();
    // Crush the mids toward black so highlights (the player, the skeleton) read
    // as the glowing subject once the duotone goes on.
    ctx.filter = 'grayscale(1) contrast(1.15) brightness(0.8)';
    drawCover(ctx, data.source, data.sourceW ?? CARD_W, data.sourceH ?? CARD_H);
    ctx.filter = 'none';
    const tint = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    tint.addColorStop(0, COLORS.teal);
    tint.addColorStop(1, COLORS.magenta);
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.restore();
  }

  // Legibility scrims: darken top-left (wordmark) and bottom (score) bands.
  const top = ctx.createLinearGradient(0, 0, 0, CARD_H * 0.4);
  top.addColorStop(0, rgba(COLORS.base, 0.8));
  top.addColorStop(1, rgba(COLORS.base, 0));
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CARD_W, CARD_H * 0.4);

  const bottom = ctx.createLinearGradient(0, CARD_H * 0.45, 0, CARD_H);
  bottom.addColorStop(0, rgba(COLORS.base, 0));
  bottom.addColorStop(1, rgba(COLORS.base, 0.92));
  ctx.fillStyle = bottom;
  ctx.fillRect(0, CARD_H * 0.45, CARD_W, CARD_H * 0.55);

  // Vignette for depth — mirrors the app's CRT corner darkening.
  const vig = ctx.createRadialGradient(
    CARD_W / 2, CARD_H / 2, CARD_H * 0.3,
    CARD_W / 2, CARD_H / 2, CARD_W * 0.72,
  );
  vig.addColorStop(0, rgba(COLORS.base, 0));
  vig.addColorStop(1, rgba(COLORS.base, 0.55));
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // CRT scanlines — the house texture, kept faint so the photo still reads.
  ctx.fillStyle = rgba(COLORS.base, 0.26);
  for (let y = 0; y < CARD_H; y += 3) ctx.fillRect(0, y, CARD_W, 1);

  // Inset neon frame with a soft outer glow — the "arcade cabinet" edge.
  ctx.save();
  ctx.strokeStyle = rgba(COLORS.teal, 0.6);
  ctx.lineWidth = 3;
  ctx.shadowColor = rgba(COLORS.teal, 0.55);
  ctx.shadowBlur = 18;
  const inset = 18;
  ctx.strokeRect(inset, inset, CARD_W - inset * 2, CARD_H - inset * 2);
  ctx.restore();

  const pad = 64;

  // Wordmark (top-left), teal→magenta like the CSS `.wordmark`.
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `900 64px ${FONT.display}`;
  const markGrad = ctx.createLinearGradient(0, pad, 0, pad + 64);
  markGrad.addColorStop(0, COLORS.teal);
  markGrad.addColorStop(1, COLORS.magenta);
  glowText(ctx, 'JUKE', pad, pad, markGrad, rgba(COLORS.teal, 0.6), 24);
  ctx.font = `700 20px ${FONT.mono}`;
  ctx.fillStyle = rgba(COLORS.muted, 0.95);
  ctx.fillText('WEBCAM MOTION ARCADE', pad + 4, pad + 74);

  // Game title (top-right).
  ctx.textAlign = 'right';
  ctx.font = `700 28px ${FONT.display}`;
  ctx.fillStyle = rgba(COLORS.text, 0.95);
  ctx.fillText(data.game.toUpperCase(), CARD_W - pad, pad + 6);

  // Score (bottom-left) — the hero figure.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 24px ${FONT.mono}`;
  ctx.fillStyle = rgba(COLORS.muted, 0.95);
  ctx.fillText('SCORE', pad + 4, CARD_H - 196);

  ctx.font = `900 168px ${FONT.display}`;
  glowText(ctx, String(data.score), pad, CARD_H - 56, COLORS.teal, rgba(COLORS.teal, 0.6), 36);

  // Caption (flavor line) above the URL.
  if (data.caption) {
    ctx.textAlign = 'right';
    ctx.font = `700 26px ${FONT.mono}`;
    ctx.fillStyle = rgba(COLORS.sunset, 0.95);
    ctx.fillText(data.caption, CARD_W - pad, CARD_H - 96);
  }

  // Live URL (bottom-right).
  ctx.textAlign = 'right';
  ctx.font = `700 24px ${FONT.mono}`;
  ctx.fillStyle = rgba(COLORS.text, 0.9);
  ctx.fillText(LIVE_URL, CARD_W - pad, CARD_H - 52);

  return canvas;
}

/** Fill text with a soft neon glow, then a crisp pass on top. */
function glowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string | CanvasGradient,
  glow: string,
  blur: number,
): void {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = blur;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillText(text, x, y); // second pass keeps the edge sharp over the glow
  ctx.restore();
}

/** Draw `img` to fill the whole card, cropping the overflow (object-fit: cover). */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  iw: number,
  ih: number,
): void {
  if (iw <= 0 || ih <= 0) return;
  const scale = Math.max(CARD_W / iw, CARD_H / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(img, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
}

// --- export ----------------------------------------------------------------

/** The card canvas → a PNG Blob (or null if the browser can't encode). */
export function cardToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/** Trigger a browser download of the PNG. */
export function downloadCard(blob: Blob, filename = 'juke-score.png'): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Best-effort copy of the PNG to the clipboard. Returns whether it worked. */
export async function copyCard(blob: Blob): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    }
  } catch {
    /* clipboard blocked (permissions / non-secure context) — download still works */
  }
  return false;
}
