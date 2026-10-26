"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Sheet / Drawer (redesign RD-2, re-design.md §5/§7.3).
 *
 * Radix `Dialog` under the hood, so the focus trap, `Esc` to close and returning focus to the
 * trigger are handled for us; a `SheetTitle` is still required for the accessible name. `side`
 * keeps the driver's bottom sheet (drag handle, 20 px top radius, safe-area padding) and the admin
 * right drawer apart.
 */
function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
}) {
  const t = useTranslations("common.actions");
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-card text-card-foreground shadow-lg transition ease-out data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:duration-220",
          side === "right" &&
            "inset-y-0 end-0 h-full w-3/4 rounded-s-xl border-s data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-md",
          side === "left" &&
            "inset-y-0 start-0 h-full w-3/4 rounded-e-xl border-e data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-md",
          side === "top" &&
            "inset-x-0 top-0 h-auto rounded-b-xl border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto max-h-[92dvh] rounded-t-xl border-t pb-[max(1rem,env(safe-area-inset-bottom))] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className,
        )}
        {...props}
      >
        {side === "bottom" ? (
          // Drag handle: decorative, the sheet itself is still closed with Esc or the close button.
          <div
            data-slot="sheet-drag-handle"
            aria-hidden
            className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/40"
          />
        ) : null}
        {children}
        <SheetPrimitive.Close className="absolute end-2 top-2 flex size-12 items-center justify-center rounded-md outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
          <XIcon className="size-5" aria-hidden />
          <span className="sr-only">{t("close")}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-1.5 p-4", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-base text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
