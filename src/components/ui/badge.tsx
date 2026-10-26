import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Pill badge (redesign RD-2, re-design.md §5). All variants are **soft**: tinted background with the
 * matching dark foreground, so contrast stays >= 4.5:1 and the text always carries the meaning.
 * Domain statuses use `StatusBadge`, which picks the right tone from the shared status map.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary-soft text-primary-soft-foreground",
        primary: "bg-primary-soft text-primary-soft-foreground",
        secondary: "bg-muted text-foreground",
        neutral: "bg-muted text-foreground",
        outline: "border border-border text-foreground",
        success: "bg-success-soft text-success-soft-foreground",
        warning: "bg-warning-soft text-warning-soft-foreground",
        info: "bg-info-soft text-info-soft-foreground",
        destructive: "bg-destructive-soft text-destructive-soft-foreground",
      },
      size: {
        sm: "px-2 py-0 text-xs",
        default: "px-2.5 py-0.5 text-sm",
        lg: "px-3 py-1 text-base",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Badge({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
