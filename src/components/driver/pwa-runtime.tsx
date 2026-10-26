"use client";

import { useEffect } from "react";

import { withBasePath } from "@/lib/base-path";
import {
  type BeforeInstallPromptEvent,
  markInstalled,
  setDeferredPrompt,
} from "@/lib/install-prompt";
import { SW_URL } from "@/lib/pwa";

/**
 * Mounted once for all /driver pages (incl. login): registers the service worker (production only,
 * the worker file is built by `scripts/build-pwa.ts` after `next build`) and captures the
 * `beforeinstallprompt` event for the install hint.
 */
export function PwaRuntime() {
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault(); // suppress the mini-infobar; our own button calls prompt()
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => markInstalled();
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // The scope must be the app root (`/` or `/delivery-app/`): the worker lives under the base
      // path and may only control it. A scope of `/` under a sub-path is rejected with a
      // SecurityError (the worker file is not at the origin root) and would claim the whole origin.
      navigator.serviceWorker.register(SW_URL, { scope: withBasePath("/") }).catch((error) => {
        console.warn("Service worker registration failed", error);
      });
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
