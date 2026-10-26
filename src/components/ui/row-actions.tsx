"use client";

import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Row overflow menu for admin tables (redesign RD-3, re-design.md §5/§8.10).
 *
 * One icon-only trigger per row (36 px) with an `aria-label` and a matching tooltip; the menu opens
 * aligned to the end so it never leaves the viewport. The children are the `DropdownMenuItem`s, so
 * no action is duplicated inside this component. Never more than one visible button plus this menu.
 *
 * The provider is mounted here so a table can use `RowActions` without remembering to wrap the
 * screen; Radix tolerates nested providers.
 */
export function RowActions({
  label,
  children,
  className,
}: {
  /** Accessible name of the trigger, e.g. "Aktionen für Bestellung 4711". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={label}
                className={cn("size-9", className)}
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">{children}</DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
