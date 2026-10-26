"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Switch (redesign RD-2, re-design.md §5/§8.6): used inline in tables (Aktiv/Inaktiv) and for
 * "Pin geprüft". Radix provides `role="switch"`, the keyboard toggle, `aria-checked` and the thumb
 * transform; the label or `aria-label` always carries the meaning, never the colour alone.
 *
 * `size="lg"` is the 48 px driver target; `md` is the admin table size.
 */
function Switch({
  className,
  size = "md",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "md" | "lg" }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors duration-150 ease-out outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        size === "lg" ? "h-8 w-14" : "h-6 w-11",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none",
          size === "lg" ? "size-6" : "size-5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
