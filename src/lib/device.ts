/** Browser-side device checks (call only in the browser, e.g. inside `useSyncExternalStore`). */

/** iPhone / iPad (iPadOS reports itself as a Mac with a touch screen). */
export const isIosDevice = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** True when the page runs as an installed app (home-screen launch) rather than in a browser tab. */
export function isStandaloneDisplay(): boolean {
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    // ignore: treat as a normal browser tab
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
