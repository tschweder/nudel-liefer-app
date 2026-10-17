/**
 * Client-side state of the install hint (NUD-080): the deferred `beforeinstallprompt` event
 * (Chromium / Android) and whether the driver dismissed the hint. A tiny external store for
 * `useSyncExternalStore`, so the event captured by the layout reaches the hint in the shell.
 */

export const INSTALL_HINT_DISMISSED_KEY = "nudel.driver.installHint.dismissed";

/** The (non-standard) event Chromium fires when the app is installable. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

type Listener = () => void;
const listeners = new Set<Listener>();
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
// Used when localStorage is blocked/throws, so "dismiss" still works for this page session.
let dismissedInMemory = false;

const notify = () => listeners.forEach((l) => l());

export function subscribeInstallState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

export function setDeferredPrompt(event: BeforeInstallPromptEvent | null): void {
  deferred = event;
  notify();
}

export function markInstalled(): void {
  installed = true;
  deferred = null;
  notify();
}

export function isMarkedInstalled(): boolean {
  return installed;
}

export function readDismissed(): boolean {
  if (dismissedInMemory) return true;
  try {
    return window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDismissed(): void {
  dismissedInMemory = true;
  try {
    window.localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "1");
  } catch {
    // storage unavailable: the hint stays hidden until the page is reloaded
  }
  notify();
}

/** Test helper: back to the initial state. */
export function resetInstallStateForTests(): void {
  deferred = null;
  installed = false;
  dismissedInMemory = false;
  listeners.clear();
}
