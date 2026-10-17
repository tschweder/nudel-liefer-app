export type ViewState = { scale: number; x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zooms by `factor` keeping the point under `focus` (relative to the transform origin, i.e. the
 * centre of the frame) fixed. Returns the identity view when zoomed back to 1.
 */
export function zoomAt(
  view: ViewState,
  factor: number,
  focus: { x: number; y: number },
): ViewState {
  const scale = clampScale(view.scale * factor);
  if (scale === MIN_SCALE) return { scale: 1, x: 0, y: 0 };
  const ratio = scale / view.scale;
  return {
    scale,
    x: focus.x - (focus.x - view.x) * ratio,
    y: focus.y - (focus.y - view.y) * ratio,
  };
}
