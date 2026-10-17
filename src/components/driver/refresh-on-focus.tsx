"use client";

import { useEffect } from "react";

import { useRouter } from "@/i18n/navigation";

/** Reloads the server data when the driver returns to the app, so a re-released tour shows up. */
export function RefreshOnFocus() {
  const router = useRouter();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);
  return null;
}
