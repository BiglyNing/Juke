/**
 * Pure mask math for the collision pipeline (Phase 2 utilities).
 *
 * The pipeline is: raw float mask -> downsample -> smoothEMA (temporal) ->
 * binarize -> erode -> maskOverlap. Everything here is deterministic and
 * side-effect free so it can be unit-tested and replayed headlessly from a
 * recorded fixture (see fixture.ts) without a webcam.
 *
 * Note: the plan sketched `downsample(...) -> Uint8Array`. We carry a Float32
 * occupancy grid (0..1) through downsample + EMA instead, then `binarize` to a
 * Uint8 mask — temporal smoothing needs fractional values to be meaningful.
 */

/** Low-res occupancy grid: each cell is the foreground fraction (0..1). */
export interface Grid {
  data: Float32Array;
  width: number;
  height: number;
}

/** Binary occupancy mask: each cell is 0 or 1. */
export interface BinaryMask {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Box-downsample a raw float mask (row-major, 0..1) to a `dstW x dstH` grid,
 * where each output cell is the mean of the source pixels that map into it.
 */
export function downsample(
  src: Float32Array | number[],
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Grid {
  const sum = new Float32Array(dstW * dstH);
  const cnt = new Uint32Array(dstW * dstH);
  for (let y = 0; y < srcH; y++) {
    const dy = Math.min(dstH - 1, (y * dstH / srcH) | 0);
    for (let x = 0; x < srcW; x++) {
      const dx = Math.min(dstW - 1, (x * dstW / srcW) | 0);
      const di = dy * dstW + dx;
      sum[di] += src[y * srcW + x];
      cnt[di]++;
    }
  }
  const data = new Float32Array(dstW * dstH);
  for (let i = 0; i < data.length; i++) data[i] = cnt[i] ? sum[i] / cnt[i] : 0;
  return { data, width: dstW, height: dstH };
}

/**
 * Temporal smoothing: `out = alpha*next + (1-alpha)*prev`. A higher alpha
 * tracks motion faster; a lower alpha is steadier but laggier. If `prev` is
 * missing or a different size, returns a copy of `next` (no history yet).
 */
export function smoothEMA(prev: Grid | null, next: Grid, alpha: number): Grid {
  if (!prev || prev.width !== next.width || prev.height !== next.height) {
    return { data: next.data.slice(), width: next.width, height: next.height };
  }
  const a = Math.max(0, Math.min(1, alpha));
  const data = new Float32Array(next.data.length);
  for (let i = 0; i < data.length; i++) {
    data[i] = a * next.data[i] + (1 - a) * prev.data[i];
  }
  return { data, width: next.width, height: next.height };
}

/** Threshold an occupancy grid into a binary mask (cell >= threshold -> 1). */
export function binarize(grid: Grid, threshold: number): BinaryMask {
  const data = new Uint8Array(grid.data.length);
  for (let i = 0; i < data.length; i++) data[i] = grid.data[i] >= threshold ? 1 : 0;
  return { data, width: grid.width, height: grid.height };
}

/**
 * Morphological erosion by `px` cells (Chebyshev / square neighborhood): a cell
 * survives only if every cell within `px` of it is occupied. Out-of-bounds
 * counts as empty, so the silhouette edge shrinks inward — this is the edge
 * tolerance dial for "close enough" fits. `px <= 0` is a no-op copy.
 */
export function erode(mask: BinaryMask, px: number): BinaryMask {
  const { width: w, height: h, data: src } = mask;
  if (px <= 0) return { data: src.slice(), width: w, height: h };
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = 1;
      for (let dy = -px; dy <= px && keep; dy++) {
        for (let dx = -px; dx <= px; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || src[ny * w + nx] === 0) {
            keep = 0;
            break;
          }
        }
      }
      out[y * w + x] = keep;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Overlap of mask `a` against mask `b`. `ratio` is the fraction of `a`'s
 * occupied cells that also fall inside `b` (intersection / area-of-a) — for
 * Hole-in-the-Wall, a=player silhouette, b=solid wall, so ratio is "how much of
 * me is hitting the wall". `hit` is true if there is any overlap at all. An
 * empty `a` yields `{ hit: false, ratio: 0 }`. Masks must share dimensions.
 */
export function maskOverlap(a: BinaryMask, b: BinaryMask): { hit: boolean; ratio: number } {
  const n = Math.min(a.data.length, b.data.length);
  let area = 0;
  let inter = 0;
  for (let i = 0; i < n; i++) {
    if (a.data[i]) {
      area++;
      if (b.data[i]) inter++;
    }
  }
  return { hit: inter > 0, ratio: area === 0 ? 0 : inter / area };
}
