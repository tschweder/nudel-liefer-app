"use client";

import { Label as LabelPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Form label (redesign RD-2). Clicking it focuses the control it points at (`htmlFor`); the required
 * marker is rendered by `FormField`. Text stays >= 16 px in the driver app (backlog 4.3).
 */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-base leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
