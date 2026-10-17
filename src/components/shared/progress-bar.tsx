import { cn } from "@/lib/utils";

/**
 * Segmented progress bar: delivered (green) and problem (red) stops. The colours are redundant on
 * purpose: the caller always prints the numbers next to the bar, and `aria-valuetext` carries them
 * for screen readers.
 */
export function ProgressBar({
  delivered,
  problems,
  total,
  label,
  valueText,
  className,
}: {
  delivered: number;
  problems: number;
  total: number;
  label: string;
  valueText: string;
  className?: string;
}) {
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={delivered + problems}
      aria-valuetext={valueText}
      className={cn("flex h-4 w-full overflow-hidden rounded-full bg-muted", className)}
      data-testid="progress-bar"
    >
      <div className="h-full bg-emerald-700" style={{ width: `${pct(delivered)}%` }} />
      <div className="h-full bg-red-700" style={{ width: `${pct(problems)}%` }} />
    </div>
  );
}
