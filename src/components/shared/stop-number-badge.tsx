import { CheckIcon } from "lucide-react";

import { type Tone, toneClasses } from "@/components/shared/status";
import { cn } from "@/lib/utils";

/**
 * Circular number badge for stops in the driver list, in tour tables and inside map markers
 * (redesign RD-3/RD-4, re-design.md §5/§6/§7.2).
 *
 * The colour comes from the shared status map and the number (or check icon) is always visible, so
 * status is never carried by colour alone. The accessible name comes from `label` — e.g.
 * `t("map.stopMarker", { n, name })` = "Stopp 13: Cucina Bella Napoli" — never from the bare digit:
 * screen readers must not announce markers as "13" (fixes F4).
 */
export function StopNumberBadge({
  number,
  tone = "neutral",
  size = 40,
  isNext = false,
  done = false,
  label,
  className,
  "data-testid": testId,
}: {
  number: number;
  tone?: Tone;
  size?: 40 | 48;
  /** The stop the driver is heading to; gets the stronger brand ring. */
  isNext?: boolean;
  /** Delivered: the number is replaced by a check icon (only meaningful with `tone="success"`). */
  done?: boolean;
  /** Accessible name, e.g. from `map.stopMarker`. Without it the badge is decorative. */
  label?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const showCheck = done && tone === "success";
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      data-next={isNext ? "true" : undefined}
      // `role="img"` is what makes the `aria-label` legal: on a bare `span` (role "generic") every
      // naming attribute is prohibited (axe `aria-prohibited-attr`, serious, WCAG 4.1.2), so the
      // badge was announced as an unlabelled graphic instead of "Stopp n". The badge shows one
      // glyph (the number or the check), which is exactly what `role="img"` describes.
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-2 border-current font-bold tabular-nums",
        size === 48 ? "size-12 text-lg" : "size-10 text-base",
        toneClasses[tone],
        isNext ? "ring-4 ring-primary/30" : "shadow-sm",
        className,
      )}
    >
      {showCheck ? (
        <CheckIcon className="size-5" aria-hidden />
      ) : (
        // The number stays visible; with a `label` it is hidden from the a11y tree so the badge is
        // never announced as a bare digit (F4). Without a label the badge is decorative anyway.
        <span aria-hidden={label ? true : undefined}>{number}</span>
      )}
    </span>
  );
}
