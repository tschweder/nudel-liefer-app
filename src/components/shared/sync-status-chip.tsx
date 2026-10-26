"use client";

import { CloudOffIcon, CloudUploadIcon, Loader2Icon, WifiIcon, WifiOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SyncState = "online" | "preparing" | "offline" | "pending" | "error";

const shell =
  "inline-flex max-w-40 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const stateClasses: Record<SyncState, string> = {
  online: "bg-info-soft text-info-soft-foreground",
  preparing: "bg-muted text-muted-foreground",
  offline: "bg-warning-soft text-warning-soft-foreground",
  pending: "bg-warning-soft text-warning-soft-foreground",
  error: "bg-destructive-soft text-destructive-soft-foreground",
};

/**
 * Presentational sync indicator for the 56 px driver top bar. All five states come from props; the
 * logic that derives them stays outside (see re-design.md §7.6). The state is carried by an icon,
 * a colour *and* the text, never by colour alone. With `onClick` it becomes the Outbox trigger.
 */
export function SyncStatusChip({
  state,
  pendingCount = 0,
  className,
  onClick,
}: {
  state: SyncState;
  pendingCount?: number;
  className?: string;
  onClick?: () => void;
}) {
  const t = useTranslations("driver.sync");
  const count = Math.max(pendingCount, 0);

  let icon: ReactNode;
  let text: string;
  switch (state) {
    case "preparing":
      icon = <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden />;
      text = t("preparing");
      break;
    case "offline":
      icon = <WifiOffIcon className="size-4" aria-hidden />;
      text = t("offline");
      break;
    case "pending":
      icon = <CloudUploadIcon className="size-4" aria-hidden />;
      text = t("pendingChip", { count });
      break;
    case "error":
      icon = <CloudOffIcon className="size-4" aria-hidden />;
      text = t("error");
      break;
    default:
      icon = <WifiIcon className="size-4" aria-hidden />;
      text = t("online");
  }

  const content = (
    <>
      {state === "online" ? (
        <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
      ) : null}
      {icon}
      <span className="truncate">{text}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid="sync-chip"
        data-state={state}
        aria-label={text}
        className={cn(shell, stateClasses[state], className)}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      data-testid="sync-chip"
      data-state={state}
      className={cn(shell, stateClasses[state], className)}
    >
      {content}
    </span>
  );
}
