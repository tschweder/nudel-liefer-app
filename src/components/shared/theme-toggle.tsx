"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { otherTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { setThemeAction } from "@/server/theme-actions";

type Variant = "icon" | "row" | "labeled";

/**
 * Light/dark switch (NUD-132).
 *
 * The button does not know the theme as a prop: the server renders `class="dark"` on `<html>` and CSS
 * picks the icon (`dark:hidden` / `hidden dark:block`), so there is no hydration mismatch and no
 * inline script (the production CSP forbids inline scripts). Clicking flips the class immediately and
 * then persists the choice through a server action, so the next page load is already correct - the
 * class is the source of truth for what is on screen right now.
 *
 * `icon`: admin header (40 px). `row`: driver overflow sheet (48 px, the driver touch floor).
 * `labeled`: login screens, where the theme should be reachable before signing in.
 */
export function ThemeToggle({ variant = "icon", className }: { variant?: Variant; className?: string }) {
  const t = useTranslations("common.theme");
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const current: Theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    const next = otherTheme(current);
    document.documentElement.classList.toggle("dark", next === "dark");
    startTransition(async () => {
      await setThemeAction(next);
    });
  };

  const icons = (
    <>
      <MoonIcon className="size-5 shrink-0 dark:hidden" aria-hidden />
      <SunIcon className="hidden size-5 shrink-0 dark:block" aria-hidden />
    </>
  );

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        data-testid="theme-toggle"
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-md border border-input px-4 text-base font-medium hover:bg-muted",
          className,
        )}
      >
        {icons}
        <span className="flex-1 text-start">{t("label")}</span>
        <span className="text-sm text-muted-foreground">
          <span className="dark:hidden">{t("light")}</span>
          <span className="hidden dark:inline">{t("dark")}</span>
        </span>
      </button>
    );
  }

  if (variant === "labeled") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        data-testid="theme-toggle"
        className={cn(
          "inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-base hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {icons}
        <span>
          <span className="dark:hidden">{t("day")}</span>
          <span className="hidden dark:inline">{t("night")}</span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      data-testid="theme-toggle"
      aria-label={t("toggle")}
      title={t("toggle")}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {icons}
    </button>
  );
}
