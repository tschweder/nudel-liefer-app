import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { type Tone, toneClasses } from "@/components/shared/status";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * KPI tile for the admin dashboard and the tour header (redesign RD-3, re-design.md §5/§8.2).
 *
 * Pure presentation: label (muted), big tabular value, optional sub line, optional icon in a soft
 * circle. With `href` the whole tile is a link — hover raises the shadow and the label text carries
 * the accessible name, so the link is never an unlabelled box.
 */
export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  href,
  className,
  "data-testid": testId,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  href?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const content = (
    <div className="flex items-start gap-3 px-5">
      {Icon ? (
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            toneClasses[tone],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
      ) : null}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        {sub ? <span className="text-sm text-muted-foreground">{sub}</span> : null}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        data-testid={testId}
        className={cn(
          "flex rounded-lg outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
          className,
        )}
      >
        <Card interactive className="w-full py-4 shadow-sm hover:shadow-md">
          {content}
        </Card>
      </Link>
    );
  }

  return (
    <Card className={cn("py-4", className)} data-testid={testId}>
      {content}
    </Card>
  );
}
