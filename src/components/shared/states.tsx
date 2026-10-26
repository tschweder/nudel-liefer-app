import { AlertTriangleIcon, InboxIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type StateProps = {
  /** Optional leading icon; defaults to an inbox (empty) or a warning triangle (error). */
  icon?: LucideIcon;
  title?: string;
  description?: string;
  /** Optional action(s): buttons or links. `children` keeps working for existing callers. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Soft circle around the state icon (re-design.md §5, "illustration slot"). */
function StateIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: "neutral" | "destructive" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-14 shrink-0 items-center justify-center rounded-full",
        tone === "destructive"
          ? "bg-destructive-soft text-destructive-soft-foreground"
          : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-7" />
    </span>
  );
}

/** Nothing to show yet (empty list, no tour today, ...). Icon + text, never colour alone. */
export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  children,
  className,
}: StateProps) {
  const t = useTranslations("common.states");
  return (
    <div
      data-testid="empty-state"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center shadow-none",
        className,
      )}
    >
      <StateIcon icon={Icon} tone="neutral" />
      <p className="text-xl font-semibold text-balance">{title ?? t("emptyTitle")}</p>
      {description ? (
        <p className="max-w-prose text-base text-muted-foreground">{description}</p>
      ) : null}
      {action}
      {children}
    </div>
  );
}

/** Something failed. Pass the retry button as `action` (or as `children`). */
export function ErrorState({
  icon: Icon = AlertTriangleIcon,
  title,
  description,
  action,
  children,
  className,
}: StateProps) {
  const t = useTranslations("common");
  return (
    <div
      role="alert"
      data-testid="error-state"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center shadow-none",
        className,
      )}
    >
      <StateIcon icon={Icon} tone="destructive" />
      <p className="text-xl font-semibold text-balance">{title ?? t("states.errorTitle")}</p>
      <p className="max-w-prose text-base text-muted-foreground">
        {description ?? t("errors.generic")}
      </p>
      {action}
      {children}
    </div>
  );
}

type SkeletonVariant = "list" | "table" | "cards";

/**
 * Loading placeholder. The variants mirror the shape of the content they replace so the layout does
 * not shift: `list` = the original header + 56 px rows, `table` = a header plus 48 px rows, `cards`
 * = a two-column card grid.
 */
export function LoadingSkeleton({
  rows = 3,
  className,
  variant = "list",
}: {
  rows?: number;
  className?: string;
  variant?: SkeletonVariant;
}) {
  const t = useTranslations("common.states");
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid="loading-skeleton"
      data-variant={variant}
      className={cn("flex w-full flex-col gap-3", className)}
    >
      <span className="sr-only">{t("loading")}</span>
      {variant === "table" ? (
        <>
          <Skeleton className="h-11 w-full" />
          {Array.from({ length: rows }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </>
      ) : variant === "cards" ? (
        <div className="grid w-full gap-3 sm:grid-cols-2">
          {Array.from({ length: rows }, (_, index) => (
            <Skeleton key={index} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <>
          <Skeleton className="h-8 w-1/3" />
          {Array.from({ length: rows }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </>
      )}
    </div>
  );
}
