import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Inline notice (redesign RD-2, re-design.md §5/§8.4). The variants read the same status tokens as
 * `StatusBadge`: soft background + matching dark text, never colour alone (the title and the icon
 * carry the meaning). `default` and `destructive` keep their old names so existing callers compile.
 */
const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-base has-[>svg]:grid-cols-[1.5rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        info: "border-info/40 bg-info-soft text-info-soft-foreground",
        success: "border-success/40 bg-success-soft text-success-soft-foreground",
        warning: "border-warning/50 bg-warning-soft text-warning-soft-foreground",
        destructive: "border-destructive/40 bg-destructive-soft text-destructive-soft-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-title" className={cn("col-start-2 font-medium tracking-tight", className)} {...props} />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("col-start-2 text-base opacity-90", className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
