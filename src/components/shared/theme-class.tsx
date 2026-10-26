"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { resolveTheme, THEME_COOKIE } from "@/lib/theme";

/**
 * Keeps `<html class="dark">` in sync with the theme cookie (NUD-132).
 *
 * The class is set before the first paint by `public/theme.js`, but that script only runs on a full
 * document load. On a client-side navigation React re-renders the root layout, and the `className` it
 * renders (which cannot contain `dark`, because the server does not read the cookie) overwrites what
 * the script set - measured: after the driver login the cookie was still `NEXT_THEME=dark` while the
 * page rendered light. This component re-applies the class after every navigation.
 *
 * It renders nothing and never touches the cookie, so it cannot fight the toggle (which updates the
 * class immediately and persists the choice through a server action).
 */
export function ThemeClass() {
  const pathname = usePathname();

  useEffect(() => {
    const value = new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`).exec(document.cookie)?.[1];
    document.documentElement.classList.toggle("dark", resolveTheme(value) === "dark");
  }, [pathname]);

  return null;
}
