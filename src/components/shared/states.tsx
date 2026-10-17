import { AlertTriangleIcon, InboxIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type StateProps = {
  title?: string;
  description?: string;
  /** Optional action (button/link). */
  children?: ReactNode;
  className?: string;
};

/** Nothing to show yet (empty list, no tour today, ...). Icon + text, never colour alone. */
export function EmptyState({ title, description, children, className }: StateProps) {
  const t = useTranslations("common.states");
  return (
    <div
      data-testid="empty-state"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center",
        className,
      )}
    >
      <InboxIcon className="size-10 text-muted-foreground" aria-hidden />
      <p className="text-xl font-semibold">{title ?? t("emptyTitle")}</p>
      {description ? (
        <p className="max-w-prose text-base text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </div>
  );
}

/** Something failed. Pass the retry button as children. */
export function ErrorState({ title, description, children, className }: StateProps) {
  const t = useTranslations("common");
  return (
    <div
      role="alert"
      data-testid="error-state"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border p-8 text-center",
        className,
      )}
    >
      <AlertTriangleIcon className="size-10 text-destructive" aria-hidden />
      <p className="text-xl font-semibold">{title ?? t("states.errorTitle")}</p>
      <p className="max-w-prose text-base text-muted-foreground">
        {description ?? t("errors.generic")}
      </p>
      {children}
    </div>
  );
}

/** Generic page-level loading placeholder (header + a few rows). */
export function LoadingSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  const t = useTranslations("common.states");
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid="loading-skeleton"
      className={cn("flex w-full flex-col gap-3", className)}
    >
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-8 w-1/3" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}
