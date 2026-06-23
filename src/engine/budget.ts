/**
 * The Phase 1 performance budget, in one place so the debug overlay and any
 * later perf checks read the same numbers. Target on the actual laptop:
 * inference < 33 ms and ~30 fps end to end (frame <= ~33 ms). The overlay
 * flashes red the instant either is breached, so a regression announces itself.
 */
export const PERF_BUDGET = {
  /** Per-frame model inference ceiling, ms. */
  inferenceMs: 33,
  /** Whole-frame ceiling (≈30 fps floor), ms. */
  frameMs: 33,
};

export function overBudget(frameMs: number, inferenceMs: number): boolean {
  return frameMs > PERF_BUDGET.frameMs || inferenceMs > PERF_BUDGET.inferenceMs;
}
