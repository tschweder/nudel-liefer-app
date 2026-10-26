import { cn } from "@/lib/utils";

/**
 * Loading placeholder (redesign RD-2, re-design.md §5). Skeletons mirror the real layout: pick the
 * height/shape that matches the content so nothing shifts when the data arrives.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("shrink-0 animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
