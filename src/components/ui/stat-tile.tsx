import { ArrowUpRightIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { type Tone, toneClasses } from "@/components/shared/status";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * KPI tile for the admin dashboard and the tour header (redesign RD-3, re-design.md §5/§8.2;
 * colour refresh 2026-10).
 *
 * Pure presentation: label with an optional icon in a soft circle, big tabular value, optional sub
 * line. With `href` the whole tile is a link — an arrow circle in the corner shows it, hover lifts
 * the tile, and the label text carries the accessible name, so the link is never an unlabelled box.
 * Below `sm` the tiles sit two per row, too narrow for icon, label and arrow side by side: the
 * label then drops onto its own line under the icon/arrow row instead of running into the arrow.
 *
 * `variant="hero"`: the one tile the dashboard leads with, filled with the brand colour (at most one
 * per row — a second hero tile would make neither stand out).
 */
export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  variant = "default",
  href,
  className,
  "data-testid": testId,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  variant?: "default" | "hero";
  href?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const hero = variant === "hero";
  const content = (
    <div className="flex flex-col gap-3 px-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        {Icon ? (
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              hero ? "bg-hero-foreground/15 text-hero-foreground" : toneClasses[tone],
            )}
          >
            <Icon className="size-[18px]" aria-hidden />
          </span>
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 text-sm font-medium max-sm:order-last max-sm:basis-full",
            hero ? "text-hero-foreground/90" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {href ? (
          <span
            aria-hidden
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors max-sm:ms-auto",
              hero
                ? "border-hero-foreground/30 bg-hero-foreground/10"
                : "border-border group-hover:bg-muted",
            )}
          >
            <ArrowUpRightIcon className="size-4" />
          </span>
        ) : null}
      </div>
      <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums sm:text-4xl">
        {value}
      </span>
      {sub ? (
        <span className={cn("text-sm", hero ? "text-hero-foreground/85" : "text-muted-foreground")}>
          {sub}
        </span>
      ) : null}
    </div>
  );

  const surface = hero ? "bg-hero text-hero-foreground" : undefined;

  if (href) {
    return (
      <Link
        href={href}
        data-testid={testId}
        data-variant={variant}
        className={cn(
          "group flex rounded-xl outline-none transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          className,
        )}
      >
        <Card interactive className={cn("w-full py-5", surface)}>
          {content}
        </Card>
      </Link>
    );
  }

  return (
    <Card className={cn("py-5", surface, className)} data-testid={testId} data-variant={variant}>
      {content}
    </Card>
  );
}
