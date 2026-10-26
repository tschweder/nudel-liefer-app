"use client";

import { CheckCircle2Icon, ClockIcon, TriangleAlertIcon, TruckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { LiveRefresh } from "@/components/shared/live-refresh";
import { ProgressBar } from "@/components/shared/progress-bar";
import { tourIcon, tourTone } from "@/components/shared/status";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { showsStopResults } from "@/domain/tour-progress";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import type { TodayProgress } from "@/server/tour-progress";

/** COMPLETED is final: nothing changes any more, so the card stops polling. */
const isDone = (status: string) => status === "COMPLETED";

/** Initials avatar for the driver (re-design.md §8.2: no `Avatar` dependency, no image file). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * Dashboard card "Heute" (NUD-054, redesigned in re-design.md §8.2): today's tour as an operations
 * card — driver avatar, `StatusBadge`, progress bar, next stop with ETA, problems and the late-order
 * warning (NUD-099). Re-reads the server data every `pollIntervalMs` while the tour is live.
 */
export function TodayCard({
  today,
  pollIntervalMs,
}: {
  today: TodayProgress;
  pollIntervalMs: number;
}) {
  const t = useTranslations("admin.dashboard.today");
  const tc = useTranslations("common");
  const format = useFormatter();
  const fmt = createAppFormatters(format, today.timezone);
  const { tour } = today;
  const tourHref = `/admin/tours?date=${today.date}`;
  const date = fmt.dateLong(new Date(`${today.date}T12:00:00Z`));
  const released = tour !== null && showsStopResults(tour.status);

  return (
    <Card
      className="h-full"
      aria-labelledby="today-title"
      data-testid="today-card"
      data-tour-status={tour?.status ?? "NONE"}
    >
      <LiveRefresh intervalMs={pollIntervalMs} enabled={tour === null || !isDone(tour.status)} />

      <CardHeader
        action={
          // A link styled as a ghost button: `Button asChild` cannot slot onto a link in jsdom, and
          // the header action is navigation, not an action.
          <Link
            href={tourHref}
            data-testid="today-link"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {released ? t("openTour") : t("openPlanning")}
          </Link>
        }
      >
        {/* `h2`: card titles sit directly under the page `h1` (re-design.md §9.2 — no skipped levels). */}
        <h2 id="today-title" className="text-lg font-semibold tracking-tight">
          {t("title")}
        </h2>
        <CardDescription data-testid="today-date">{date}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {tour?.driverName ? (
            <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground"
              >
                {initials(tour.driverName)}
              </span>
              <TruckIcon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{t("driver", { name: tour.driverName })}</span>
            </p>
          ) : (
            <span />
          )}
          {tour ? (
            <span data-testid="today-status" data-status={tour.status}>
              <StatusBadge tone={tourTone(tour.status)} icon={tourIcon(tour.status)}>
                {tc(`statuses.tour.${tour.status}`)}
              </StatusBadge>
            </span>
          ) : null}
        </div>

        {!tour ? (
          <p className="text-base" data-testid="today-no-tour">
            {t("noTour")}
          </p>
        ) : !released ? (
          <p className="text-base" data-testid="today-not-released">
            {t("notReleased")}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <ProgressBar
                delivered={tour.progress.delivered}
                problems={tour.progress.problems}
                total={tour.progress.total}
                label={t("progressLabel")}
                valueText={t("progress", {
                  done: tour.progress.done,
                  total: tour.progress.total,
                })}
              />
              <p className="text-base font-semibold" data-testid="today-progress">
                {t("progress", { done: tour.progress.done, total: tour.progress.total })}
                <span className="ms-2 text-sm font-normal text-muted-foreground">
                  {t("percent", { percent: tour.progress.percent })}
                </span>
              </p>
              <p className="text-sm text-muted-foreground" data-testid="today-counts">
                {/* Breakdown of the same 6 stops the line above counts as done: delivered + problems
                    + open = total, so the card can never contradict its own "x von y erledigt"
                    (round-3 review: it read "3 von 6 erledigt (50 %)" next to "2 geliefert · 3 offen"). */}
                {t("countsBreakdown", {
                  delivered: tour.progress.delivered,
                  problems: tour.progress.problems,
                  open: tour.progress.pending,
                })}
              </p>
            </div>

            <div className="flex flex-col gap-1" data-testid="today-next">
              <h3 className="text-sm font-medium text-muted-foreground">{t("next")}</h3>
              {tour.nextStop ? (
                <div className="flex items-start gap-2">
                  <ClockIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-col">
                    <span className="text-base font-medium" data-testid="today-next-name">
                      {tour.nextStop.name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {tour.nextStop.street}, {tour.nextStop.postalCode} {tour.nextStop.city}
                      {tour.nextStop.etaAt
                        ? ` · ${t("eta", { time: fmt.time(new Date(tour.nextStop.etaAt)) })}`
                        : ""}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-base" data-testid="today-all-done">
                  <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
                  {t("allDone")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1" data-testid="today-problems">
              <h3 className="text-sm font-medium text-muted-foreground">{t("problemsHeading")}</h3>
              <p
                className="flex items-center gap-2 text-base font-medium"
                data-testid="today-problem-count"
              >
                {tour.progress.problems > 0 ? (
                  <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                ) : (
                  <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
                )}
                {t("problems", { count: tour.progress.problems })}
              </p>
              {tour.problemStops.length > 0 ? (
                <ul className="ms-6 flex list-disc flex-col text-sm">
                  {tour.problemStops.map((p) => (
                    <li key={p.id} data-testid="today-problem">
                      <Link
                        href={`/admin/tours?date=${today.date}`}
                        className="underline underline-offset-4"
                      >
                        {p.name}
                      </Link>
                      {p.reason ? ` – ${tc(`problemReasons.${p.reason}`)}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        )}

        {today.lateOrderCount > 0 ? (
          <div
            className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-base text-warning-soft-foreground"
            role="status"
            data-testid="today-late-orders"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{t("lateOrders", { count: today.lateOrderCount })}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
