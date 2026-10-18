"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleIcon,
  ClockIcon,
  ListIcon,
  MapIcon,
  MapPinIcon,
  NavigationIcon,
  PackageIcon,
  PartyPopperIcon,
  PencilLineIcon,
  PlusCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useState } from "react";

import { TourMapLazy } from "@/components/maps/lazy";
import { Button } from "@/components/ui/button";
import {
  isUnseenChange,
  nextPendingStop,
  progressOf,
  remainingSeconds,
  roundedMinutes,
  summarizeItems,
} from "@/domain/driver-today";
import { Link } from "@/i18n/navigation";
import type { DriverToday, TodayItem, TodayStop } from "@/lib/driver-tour-model";
import { createAppFormatters } from "@/lib/format";
import type { MapTileConfig } from "@/lib/map-config";
import { googleMapsNavigationUrl } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { RefreshOnFocus } from "./refresh-on-focus";
import { useSeenRevision } from "./seen-revision";

type UnitKey = "KG" | "PACK" | "CRATE" | "PIECE";

const cents = (value: number) => value / 100;

/** "3 varieties · 27 kg · 4 packs": one total per unit, units are never added together. */
function ItemSummary({ items }: { items: TodayItem[] }) {
  const t = useTranslations("driver");
  const fmt = createAppFormatters(useFormatter());
  const { kinds, totals } = summarizeItems(items);
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="item-summary">
      <PackageIcon className="size-5 self-center" aria-hidden />
      <span className="text-lg" data-testid="summary-kinds">
        {t("today.kinds", { count: kinds })}
      </span>
      {totals.map((total) => (
        <Fragment key={total.unit}>
          <span aria-hidden>·</span>
          <span data-testid="summary-total" data-unit={total.unit}>
            <strong className="text-3xl font-bold tabular-nums">
              {fmt.quantity(cents(total.quantityCents))}
            </strong>{" "}
            <span className="text-lg">
              {t(`units.${total.unit as UnitKey}`, { count: cents(total.quantityCents) })}
            </span>
          </span>
        </Fragment>
      ))}
    </p>
  );
}

function StatusLabel({ status }: { status: TodayStop["status"] }) {
  const t = useTranslations("driver.today");
  const Icon =
    status === "DELIVERED"
      ? CheckCircle2Icon
      : status === "PROBLEM"
        ? AlertTriangleIcon
        : CircleIcon;
  const label =
    status === "DELIVERED"
      ? t("statusDelivered")
      : status === "PROBLEM"
        ? t("statusProblem")
        : t("statusPending");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-base font-medium",
        status === "DELIVERED" && "text-green-700 dark:text-green-400",
        status === "PROBLEM" && "text-destructive",
      )}
      data-testid="stop-status"
      data-status={status}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </span>
  );
}

/** Marker + changed quantities of a stop the driver has not seen in its new state yet. */
function ChangeHighlight({ stop }: { stop: TodayStop }) {
  const t = useTranslations("driver");
  const fmt = createAppFormatters(useFormatter());
  const added = stop.change === "ADDED";
  const changedItems = stop.items.filter(
    (i) => i.previousQuantityCents !== null && i.previousQuantityCents !== i.quantityCents,
  );
  return (
    <div
      className="rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
      data-testid="stop-change"
      data-change={stop.change}
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        {added ? (
          <PlusCircleIcon className="size-5" aria-hidden />
        ) : (
          <PencilLineIcon className="size-5" aria-hidden />
        )}
        {added ? t("today.changeAdded") : t("today.changeChanged")}
      </p>
      {!added && changedItems.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {changedItems.map((item) => (
            <li key={item.productId} data-testid="change-item">
              <span className="block text-base">{item.name}</span>
              <span className="text-2xl font-bold tabular-nums">
                <span className="text-muted-foreground line-through decoration-2">
                  {fmt.quantity(cents(item.previousQuantityCents ?? 0))}
                </span>{" "}
                <span aria-hidden>→</span> {fmt.quantity(cents(item.quantityCents))}{" "}
                <span className="text-base font-medium">
                  {t(`units.${item.unit as UnitKey}`, { count: cents(item.quantityCents) })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SequenceBadge({ number, current }: { number: number; current?: boolean }) {
  const t = useTranslations("driver.today");
  return (
    <span
      aria-label={t("stopLabel", { number })}
      className={cn(
        "inline-flex size-12 shrink-0 items-center justify-center rounded-full border-2 text-2xl font-bold",
        current ? "border-primary bg-primary text-primary-foreground" : "border-foreground",
      )}
      data-testid="stop-number"
    >
      {number}
    </span>
  );
}

function NextStopCard({
  stop,
  timezone,
  unseen,
}: {
  stop: TodayStop;
  timezone: string;
  unseen: boolean;
}) {
  const t = useTranslations("driver.today");
  const fmt = createAppFormatters(useFormatter(), timezone);
  return (
    <section
      className="space-y-4 rounded-xl border-2 border-primary bg-card p-4 shadow-sm"
      aria-labelledby="next-stop-heading"
      data-testid="next-stop"
      data-stop-id={stop.id}
    >
      <h2
        id="next-stop-heading"
        className="text-base font-semibold uppercase text-muted-foreground"
      >
        {t("nextStop")}
      </h2>
      <div className="flex items-start gap-3">
        <SequenceBadge number={stop.sequence} current />
        <div className="min-w-0 space-y-1">
          <p className="text-2xl leading-tight font-bold break-words" data-testid="next-stop-name">
            {stop.customerName}
          </p>
          <p className="flex items-start gap-1 text-lg" data-testid="next-stop-address">
            <MapPinIcon className="mt-1 size-5 shrink-0" aria-hidden />
            <span>
              {stop.street}, {stop.postalCode} {stop.city}
            </span>
          </p>
          {stop.etaAt ? (
            <p className="flex items-center gap-1 text-lg" data-testid="next-stop-eta">
              <ClockIcon className="size-5 shrink-0" aria-hidden />
              {t("eta", { time: fmt.time(new Date(stop.etaAt)) })}
            </p>
          ) : null}
        </div>
      </div>
      <ItemSummary items={stop.items} />
      {unseen ? <ChangeHighlight stop={stop} /> : null}
      <div className="grid gap-3">
        {stop.lat !== null && stop.lng !== null ? (
          <Button asChild size="lg" className="h-14 text-lg">
            <a
              href={googleMapsNavigationUrl(stop.lat, stop.lng)}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="navigate"
            >
              <NavigationIcon className="size-6" aria-hidden />
              {t("navigate")}
            </a>
          </Button>
        ) : (
          <p className="flex items-center gap-2 text-base" data-testid="no-pin">
            <AlertTriangleIcon className="size-5 shrink-0" aria-hidden />
            {t("noPin")}
          </p>
        )}
        <Button asChild size="lg" variant="outline" className="h-14 text-lg">
          <Link href={`/driver/stops/${stop.id}`} data-testid="details">
            <ListIcon className="size-6" aria-hidden />
            {t("details")}
          </Link>
        </Button>
      </div>
    </section>
  );
}

function StopRow({
  stop,
  timezone,
  isNext,
  unseen,
}: {
  stop: TodayStop;
  timezone: string;
  isNext: boolean;
  unseen: boolean;
}) {
  const fmt = createAppFormatters(useFormatter(), timezone);
  return (
    <li
      className={cn(
        "rounded-lg border bg-card",
        isNext && "border-2 border-primary",
        stop.status !== "PENDING" && "bg-muted/50",
      )}
      data-testid="stop-row"
      data-stop-id={stop.id}
      data-status={stop.status}
    >
      <Link
        href={`/driver/stops/${stop.id}`}
        className="flex min-h-16 items-start gap-3 rounded-lg p-3 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SequenceBadge number={stop.sequence} current={isNext} />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block text-lg leading-tight font-semibold break-words">
            {stop.customerName}
          </span>
          <span className="block text-base text-muted-foreground">
            {stop.street}, {stop.postalCode} {stop.city}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusLabel status={stop.status} />
            {stop.etaAt ? (
              <span className="inline-flex items-center gap-1 text-base">
                <ClockIcon className="size-5" aria-hidden />
                {fmt.time(new Date(stop.etaAt))}
              </span>
            ) : null}
          </span>
          <ItemSummary items={stop.items} />
        </span>
      </Link>
      {unseen ? (
        <div className="px-3 pb-3">
          <ChangeHighlight stop={stop} />
        </div>
      ) : null}
    </li>
  );
}

function formatDuration(
  t: ReturnType<typeof useTranslations<"driver.today">>,
  minutes: number,
): string {
  return minutes >= 60
    ? t("durationHours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t("durationMinutes", { minutes });
}

/** The driver's tour for today: progress, next stop, list / map, updated-tour notice. */
export function TodayTour({
  today,
  tiles,
  offline = false,
}: {
  today: DriverToday;
  tiles: MapTileConfig;
  /** Rendered from the offline copy (NUD-081): nothing here asks the server. */
  offline?: boolean;
}) {
  const t = useTranslations("driver.today");
  const [view, setView] = useState<"list" | "map">("list");
  const [seen, markSeen] = useSeenRevision(today.tourId, today.revision, today.updated);

  const next = nextPendingStop(today.stops);
  const { done, total } = progressOf(today.stops);
  const remaining = roundedMinutes(remainingSeconds(today.stops, today.serviceSecondsPerStop));
  const showBanner = today.updated && seen < today.revision;
  const unseen = (stop: TodayStop) => showBanner && isUnseenChange(stop, seen);

  return (
    <div className="flex flex-col gap-4" data-testid="today-tour">
      {offline ? null : <RefreshOnFocus />}

      {showBanner ? (
        <div
          role="status"
          className="space-y-3 rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
          data-testid="updated-banner"
        >
          <p className="flex items-center gap-2 text-xl font-bold">
            <RefreshCwIcon className="size-6 shrink-0" aria-hidden />
            {t("updatedTitle")}
          </p>
          <p className="text-base">{t("updatedDescription")}</p>
          {today.removedCustomers.length > 0 ? (
            <div data-testid="removed-stops">
              <p className="text-base font-semibold">{t("removedStops")}</p>
              <ul className="list-disc ps-6 text-base">
                {today.removedCustomers.map((customer) => (
                  <li key={customer.customerId}>{customer.name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <Button
            size="lg"
            className="h-12 w-full text-base"
            onClick={markSeen}
            data-testid="updated-ack"
          >
            <CheckCircle2Icon className="size-5" aria-hidden />
            {t("updatedConfirm")}
          </Button>
        </div>
      ) : null}

      <section aria-label={t("progressLabel")} className="space-y-2" data-testid="progress">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-3xl font-bold tabular-nums" data-testid="progress-count">
            {t("progress", { done, total })}
          </p>
          {remaining > 0 ? (
            <p className="flex items-center gap-1 text-lg" data-testid="remaining">
              <ClockIcon className="size-5" aria-hidden />
              {t("remaining", { duration: formatDuration(t, remaining) })}
            </p>
          ) : null}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={t("progressAria", { done, total })}
          className="h-3 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
          />
        </div>
      </section>

      {next ? (
        <NextStopCard stop={next} timezone={today.timezone} unseen={unseen(next)} />
      ) : (
        <div
          className="space-y-3 rounded-xl border-2 border-green-600 bg-green-50 p-5 text-green-950 dark:bg-green-950/40 dark:text-green-50"
          data-testid="all-done"
        >
          <div className="flex items-center gap-3">
            <PartyPopperIcon className="size-12 shrink-0" aria-hidden />
            <div>
              <p className="text-2xl font-bold">{t("allDoneTitle")}</p>
              <p className="text-base">{t("allDoneDescription")}</p>
            </div>
          </div>
          <p className="text-lg font-semibold" data-testid="finished-summary">
            {t("finishedSummary", {
              delivered: today.stops.filter((s) => s.status === "DELIVERED").length,
              problems: today.stops.filter((s) => s.status === "PROBLEM").length,
            })}
          </p>
        </div>
      )}

      <div role="group" aria-label={t("viewLabel")} className="grid grid-cols-2 gap-2">
        {(
          [
            ["list", ListIcon, t("viewList")],
            ["map", MapIcon, t("viewMap")],
          ] as const
        ).map(([key, Icon, label]) => (
          <Button
            key={key}
            type="button"
            size="lg"
            variant={view === key ? "default" : "outline"}
            aria-pressed={view === key}
            onClick={() => setView(key)}
            data-testid={`view-${key}`}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Button>
        ))}
      </div>

      {view === "list" ? (
        <section aria-labelledby="stops-heading" className="space-y-3">
          <h2 id="stops-heading" className="text-xl font-semibold">
            {t("listTitle")}
          </h2>
          <ol className="space-y-3" data-testid="stop-list">
            {today.stops.map((stop) => (
              <StopRow
                key={stop.id}
                stop={stop}
                timezone={today.timezone}
                isNext={stop.id === next?.id}
                unseen={unseen(stop)}
              />
            ))}
          </ol>
        </section>
      ) : (
        <section aria-label={t("mapLabel")} data-testid="map-view">
          <TourMapLazy
            stops={today.stops.flatMap((stop) =>
              stop.lat !== null && stop.lng !== null
                ? [
                    {
                      id: stop.id,
                      sequence: stop.sequence,
                      lat: stop.lat,
                      lng: stop.lng,
                      label: stop.customerName,
                    },
                  ]
                : [],
            )}
            depot={
              today.depot
                ? { lat: today.depot.lat, lng: today.depot.lng, label: today.depot.name }
                : null
            }
            geometry={today.geometry}
            tiles={tiles}
          />
        </section>
      )}
    </div>
  );
}
