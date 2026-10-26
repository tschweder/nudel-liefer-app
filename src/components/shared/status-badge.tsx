import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { type Tone,toneClasses, toneDot } from "@/components/shared/status";
import { cn } from "@/lib/utils";

/**
 * Soft status chip (redesign RD-2, re-design.md §5/§9.2).
 *
 * Reads its colour from the shared status map, never from a local literal. **Status is never
 * colour alone**: the children are the localized label and either the status icon or a leading dot
 * always accompanies it. The soft background plus the matching `*-soft-foreground` text keep the
 * contrast >= 4.5:1 (ratios documented in `globals.css`).
 */
export function StatusBadge({
  tone,
  children,
  icon: Icon,
  size = "md",
  className,
}: {
  tone: Tone;
  children: ReactNode;
  /** Optional leading icon; when omitted a small tone dot is shown instead. */
  icon?: LucideIcon;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-2.5 py-1 text-sm",
        size === "lg" && "px-3 py-1.5 text-base",
        toneClasses[tone],
        className,
      )}
    >
      {Icon ? (
        <Icon
          className={cn("shrink-0", size === "sm" ? "size-3" : size === "lg" ? "size-5" : "size-4")}
          aria-hidden
        />
      ) : (
        <span
          className={cn(
            "shrink-0 rounded-full",
            size === "sm" ? "size-1.5" : size === "lg" ? "size-2.5" : "size-2",
            toneDot[tone],
          )}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
