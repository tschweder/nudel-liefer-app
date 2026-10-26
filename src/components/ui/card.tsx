import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Card (redesign RD-2, re-design.md §3 principle 3 / §5).
 *
 * Hierarchy comes from spacing and type, not from boxes inside boxes: **cards are never nested.**
 * A card may contain lists, rows or tables separated by hairlines, never another `Card`.
 *
 * Surface rules (§4.1): default cards use a hairline border *only*; raised/interactive cards use
 * `shadow-sm` with a transparent border — never a heavy border *and* a heavy shadow.
 */
function Card({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Raised, clickable card: soft shadow + pointer cursor + a slightly stronger shadow on hover. */
  interactive?: boolean;
}) {
  return (
    <div
      data-slot="card"
      data-interactive={interactive ? "" : undefined}
      className={cn(
        "flex flex-col gap-4 rounded-lg bg-card py-5 text-card-foreground",
        interactive
          ? "cursor-pointer border border-transparent shadow-sm transition-shadow duration-150 ease-out hover:shadow-md motion-reduce:transition-none"
          : "border",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({
  className,
  action,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Optional node rendered right-aligned in the header row (e.g. a ghost button or a menu). */
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 px-5",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
      {action ? (
        <div data-slot="card-action" className="flex shrink-0 items-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-lg font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex flex-wrap items-center gap-2 px-5", className)}
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
