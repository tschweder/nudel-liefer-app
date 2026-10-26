import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Text input (redesign RD-2, re-design.md §5). `size` picks the 40 px admin or 48 px driver height;
 * the ring offset keeps the focus ring visible on tinted card backgrounds. Validation styling comes
 * from `aria-invalid`; the localized error text lives in `FormField`.
 */
const inputVariants = cva(
  "flex w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base transition-colors duration-150 ease-out outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none aria-invalid:border-destructive aria-invalid:ring-destructive",
  {
    variants: {
      size: {
        default: "h-10",
        sm: "h-9 text-sm",
        lg: "min-h-12",
      },
    },
    defaultVariants: { size: "default" },
  },
);

function Input({
  className,
  type,
  size,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  );
}

export { Input, inputVariants };
