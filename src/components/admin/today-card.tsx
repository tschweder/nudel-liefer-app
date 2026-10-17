"use client";

import { CheckCircle2Icon, ClockIcon, TriangleAlertIcon, TruckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { LiveRefresh } from "@/components/shared/live-refresh";
import { ProgressBar } from "@/components/shared/progress-bar";
import { Badge } from "@/components/ui/badge";
import { showsStopResults } from "@/domain/tour-progress";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import type { TodayProgress } from "@/server/tour-progress";

/** COMPLETED is final: nothing changes any more, so the card stops polling. */
const isDone = (status: string) => status === "COMPLETED";

/**
 * Dashboard card "Today" (NUD-054): progress bar, next stop and number of problems of today's
 * tour. Re-reads the server data every `pollIntervalMs` while the tour is live.
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

  return (
    <section
      className="flex max-w-3xl flex-col gap-4 rounded-lg border bg-card p-4"
      aria-labelledby="today-title"
      data-testid="today-card"
      data-tour-status={tour?.status ?? "NONE"}
    >
      <LiveRefresh intervalMs={pollIntervalMs} enabled={tour === null || !isDone(tour.status)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 id="today-title" className="text-xl font-semibold">
            {t("title")}
          </h2>
          <span className="text-sm text-muted-foreground" data-testid="today-date">
            {date}
          </span>
        </div>
        {tour ? (
          <Badge data-testid="today-status" data-status={tour.status}>
            {tc(`statuses.tour.${tour.status}`)}
          </Badge>
        ) : null}
      </div>

      {!tour ? (
        <p className="text-base" data-testid="today-no-tour">
          {t("noTour")}
        </p>
      ) : !showsStopResults(tour.status) ? (
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
            <p className="text-lg font-semibold" data-testid="today-progress">
              {t("progress", { done: tour.progress.done, total: tour.progress.total })}
              <span className="ml-2 text-base font-normal text-muted-foreground">
                {t("percent", { percent: tour.progress.percent })}
              </span>
            </p>
            <p className="text-sm text-muted-foreground" data-testid="today-counts">
              {t("counts", { delivered: tour.progress.delivered, open: tour.progress.pending })}
            </p>
          </div>

          <div className="flex flex-col gap-1" data-testid="today-next">
            <h3 className="text-sm font-medium text-muted-foreground">{t("next")}</h3>
            {tour.nextStop ? (
              <div className="flex items-start gap-2">
                <ClockIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="flex flex-col">
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
              <ul className="ml-6 flex list-disc flex-col text-sm">
                {tour.problemStops.map((p) => (
                  <li key={p.id} data-testid="today-problem">
                    {p.name}
                    {p.reason ? ` – ${tc(`problemReasons.${p.reason}`)}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {tour.driverName ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <TruckIcon className="size-4 shrink-0" aria-hidden />
              {t("driver", { name: tour.driverName })}
            </p>
          ) : null}
        </>
      )}

      <div>
        <Link href={tourHref} className="text-base font-medium underline" data-testid="today-link">
          {tour && showsStopResults(tour.status) ? t("openTour") : t("openPlanning")}
        </Link>
      </div>
    </section>
  );
}
