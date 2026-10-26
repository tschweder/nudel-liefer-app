"use client";

import type { LucideIcon } from "lucide-react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SegmentedControlOption = {
  value: string;
  label: ReactNode;
  icon?: LucideIcon;
  /** Forwarded to the option element so specs can target one segment. */
  testId?: string;
};

// Driver sizes (re-design.md §7.2): lg = 48 px high, md = 40 px (admin), sm = 32 px.
// The *items* are the touch targets, so `lg` items must reach 48 px (backlog 4.3) — a 48 px track
// with 44 px items fails the driver layoutAudit. Track 52 px, item 48 px.
const listSizes = { sm: "h-8", md: "h-10", lg: "h-13" } as const;
const itemSizes = { sm: "min-h-7", md: "min-h-9", lg: "min-h-12" } as const;
const iconSizes = { sm: "size-4", md: "size-5", lg: "size-6" } as const;

/**
 * Segmented control for mutually exclusive view switches (Liste/Karte, Heute/Morgen/Woche).
 * Radix `ToggleGroup` provides roving focus and arrow-key navigation; the selection is exposed as
 * `data-state` and the segment label carries the meaning, never the fill colour alone.
 */
export function SegmentedControl({
  value,
  onValueChange,
  options,
  ariaLabel,
  size = "md",
  className,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedControlOption[];
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  id?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      id={id}
      type="single"
      value={value}
      // Radix reports "" when the active item is pressed again; keep the current value so the
      // control always has exactly one selection.
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
      aria-label={ariaLabel}
      role="group"
      data-slot="segmented-control"
      className={cn(
        "inline-flex w-full items-center gap-1 rounded-md bg-muted p-0.5",
        listSizes[size],
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            data-testid={option.testId}
            // No `aria-pressed` here: Radix renders each item with `role="radio"` and its own
            // `aria-checked`, and `aria-pressed` is not allowed on `radio` (axe `aria-allowed-attr`,
            // critical — it failed the driver login/picker screens). `aria-checked` carries the state.
            className={cn(
              "inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 self-stretch rounded-sm px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-sm data-[state=off]:text-muted-foreground",
              size === "sm" ? "text-sm" : "text-base",
              itemSizes[size],
            )}
          >
            {Icon ? <Icon className={cn(iconSizes[size], "shrink-0")} aria-hidden /> : null}
            <span className="truncate">{option.label}</span>
          </ToggleGroupPrimitive.Item>
        );
      })}
    </ToggleGroupPrimitive.Root>
  );
}
