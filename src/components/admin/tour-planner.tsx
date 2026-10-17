"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  ImageOffIcon,
  LockIcon,
  LockOpenIcon,
  RefreshCwIcon,
  RocketIcon,
  RouteIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { TourMapLazy } from "@/components/maps/lazy";
import { EmptyState } from "@/components/shared/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { durationParts, isTourEditable, moveItem, releaseBlocker } from "@/domain/tour-plan";
import { Link, useRouter } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import type { MapTileConfig } from "@/lib/map-config";
import { cn } from "@/lib/utils";
import {
  assignDriverAction,
  generateTourAction,
  releaseTourAction,
  reorderStopsAction,
  setTourLockedAction,
} from "@/server/tour-actions";
import type { PlanStop, TourPlan } from "@/server/tour-planning";

const selectClass = "h-10 min-w-56 rounded-md border border-input bg-background px-3 text-base";

/**
 * Planning screen of one delivery day (NUD-042): generate, review on the map and in the ordered
 * list, reorder (drag and drop, or the up / down buttons), re-optimize, lock, assign a driver and
 * release. All state-changing calls are server actions (ADMIN only); the page re-reads the plan
 * after every change, so what is shown is what is stored.
 */
export function TourPlanner({ plan, tiles }: { plan: TourPlan; tiles: MapTileConfig }) {
  const t = useTranslations("admin.tours");
  const ts = useTranslations("admin.settings");
  const tc = useTranslations("common");
  const format = useFormatter();
  const fmt = createAppFormatters(format, plan.timezone);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { tour } = plan;

  // Local, not yet confirmed state; dropped as soon as the server rendered a new tour version.
  const [syncKey, setSyncKey] = useState(tour?.version ?? "");
  const [order, setOrder] = useState<string[] | null>(null);
  const [driverValue, setDriverValue] = useState(tour?.driverId ?? "");
  const [error, setError] = useState<{ code: string; max?: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  if ((tour?.version ?? "") !== syncKey) {
    setSyncKey(tour?.version ?? "");
    setOrder(null);
    setDriverValue(tour?.driverId ?? "");
  }

  const errorText = (code: string, max?: number) => {
    if (code === "depot_not_set") return ts("errors.depotNotSet");
    return t.has(`errors.${code}`) ? t(`errors.${code}`, { max: max ?? 0 }) : t("errors.generic");
  };

  /** Runs one server call; `onOk` runs for `{ok: true}`, anything else is shown as an error. */
  function run<R extends { ok: boolean }>(
    call: () => Promise<R>,
    onOk: (result: Extract<R, { ok: true }>) => void,
    onFail?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      let result: R;
      try {
        result = await call();
      } catch {
        onFail?.();
        return setError({ code: "generic" });
      }
      if (!result.ok) {
        onFail?.();
        const failure = result as unknown as { error: string; maxStops?: number };
        setError({ code: failure.error, max: failure.maxStops });
        if (["stops_changed", "conflict", "tour_not_editable"].includes(failure.error)) {
          router.refresh();
        }
        return;
      }
      onOk(result as Extract<R, { ok: true }>);
    });
  }

  function generate() {
    run(
      () => generateTourAction({ date: plan.date }),
      (result) => {
        const r = result as unknown as {
          mode: string;
          stopCount: number;
          addedCustomerIds: string[];
          removedCustomerIds: string[];
        };
        toast.success(
          r.mode === "locked_extended"
            ? t("toast.generatedLocked", {
                added: r.addedCustomerIds.length,
                removed: r.removedCustomerIds.length,
              })
            : t("toast.generated", { count: r.stopCount }),
        );
        router.refresh();
      },
    );
  }

  if (!tour) {
    return (
      <div className="flex flex-col gap-6">
        <Warnings plan={plan} />
        <ErrorAlert error={error} errorText={errorText} />
        <EmptyState
          title={t("noTourTitle")}
          description={t("noTourBody", { count: plan.confirmedOrderCount })}
        >
          <Button
            type="button"
            onClick={generate}
            disabled={pending || plan.confirmedOrderCount === 0}
            data-testid="tour-generate"
          >
            <RouteIcon aria-hidden />
            {pending ? t("generating") : t("generate")}
          </Button>
        </EmptyState>
      </div>
    );
  }

  const editable = isTourEditable(tour.status);
  const stopById = new Map(tour.stops.map((s) => [s.id, s]));
  const stops: PlanStop[] = order
    ? order.flatMap((id) => (stopById.get(id) ? [stopById.get(id)!] : []))
    : tour.stops;
  const recalculating = order !== null;
  const locked = tour.locked;
  const busy = pending || recalculating;
  const blocker = releaseBlocker({
    status: tour.status,
    stopCount: tour.stops.length,
    driverId: driverValue || null,
    isOutdated: tour.isOutdated,
  });
  const driver = plan.drivers.find((d) => d.id === (driverValue || tour.driverId));
  const duration = durationParts(tour.totalDurationS ?? 0);
  const durationText = t("summary.durationValue", duration);

  function applyOrder(next: string[]) {
    setOrder(next);
    run(
      () => reorderStopsAction({ tourId: tour!.id, orderedStopIds: next }),
      (result) => {
        const r = result as unknown as { changed: boolean };
        if (!r.changed) return setOrder(null);
        toast.success(t("toast.reordered"));
        router.refresh();
      },
      () => setOrder(null),
    );
  }

  function move(id: string, to: number) {
    const ids = stops.map((s) => s.id);
    const from = ids.indexOf(id);
    if (from < 0 || from === to || to < 0 || to >= ids.length) return;
    applyOrder(moveItem(ids, from, to));
  }

  function toggleLock() {
    run(
      () => setTourLockedAction({ tourId: tour!.id, locked: !locked }),
      () => {
        toast.success(locked ? t("toast.unlocked") : t("toast.locked"));
        router.refresh();
      },
    );
  }

  function changeDriver(id: string) {
    setDriverValue(id);
    run(
      () => assignDriverAction({ tourId: tour!.id, driverId: id || null }),
      () => {
        toast.success(id ? t("toast.driverSet") : t("toast.driverCleared"));
        router.refresh();
      },
      () => setDriverValue(tour!.driverId ?? ""),
    );
  }

  function release() {
    run(
      () => releaseTourAction({ tourId: tour!.id, version: tour!.version }),
      () => {
        setReleaseOpen(false);
        toast.success(t("toast.released"));
        router.refresh();
      },
      () => setReleaseOpen(false),
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="tour-planner" data-tour-id={tour.id}>
      <Warnings plan={plan} />
      <ErrorAlert error={error} errorText={errorText} />
      {tour.isOutdated && editable ? (
        <Alert variant="destructive" data-testid="tour-outdated">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{t("outdatedTitle")}</AlertTitle>
          <AlertDescription>{t("outdatedBody")}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4 rounded-lg border p-4" aria-label={t("title")}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge data-testid="tour-status" data-status={tour.status}>
            {tc(`statuses.tour.${tour.status}`)}
          </Badge>
          {locked ? (
            <Badge variant="outline" className="gap-1" data-testid="tour-locked-badge">
              <LockIcon className="size-3.5" aria-hidden />
              {t("lockedBadge")}
            </Badge>
          ) : null}
          {tour.approximate ? (
            <Badge
              variant="outline"
              className="gap-1 border-amber-600 text-amber-800 dark:text-amber-300"
              title={t("approximateHint")}
              data-testid="tour-approximate"
            >
              <TriangleAlertIcon className="size-3.5" aria-hidden />
              {t("approximate")}
            </Badge>
          ) : null}
          {tour.releasedAt ? (
            <span className="text-sm text-muted-foreground" data-testid="tour-released-at">
              {t("releasedAt", { time: fmt.dateTime(new Date(tour.releasedAt)) })}
            </span>
          ) : null}
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-2" data-testid="tour-summary">
          <Summary
            label={t("stopsHeading")}
            value={t("summary.stops", { count: tour.stops.length })}
            id="summary-stops"
          />
          <Summary label={t("summary.duration")} value={durationText} id="summary-duration" />
          {tour.totalDistanceM !== null ? (
            <Summary
              label={t("summary.distance")}
              value={t("summary.distanceValue", {
                km: format.number(tour.totalDistanceM / 1000, { maximumFractionDigits: 1 }),
              })}
              id="summary-distance"
            />
          ) : null}
        </dl>

        {editable ? (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <Button
              type="button"
              variant="outline"
              onClick={generate}
              disabled={busy}
              title={locked ? t("refreshLockedHint") : t("reoptimizeHint")}
              data-testid="tour-reoptimize"
            >
              <RefreshCwIcon aria-hidden />
              {locked ? t("refreshLocked") : t("reoptimize")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={toggleLock}
              disabled={busy}
              aria-pressed={locked}
              data-testid="tour-lock"
            >
              {locked ? <LockOpenIcon aria-hidden /> : <LockIcon aria-hidden />}
              {locked ? t("unlock") : t("lock")}
            </Button>
            <div className="flex flex-col gap-1">
              <label htmlFor="tour-driver" className="text-sm font-medium">
                {t("driver")}
              </label>
              <select
                id="tour-driver"
                className={selectClass}
                value={driverValue}
                disabled={busy}
                onChange={(e) => changeDriver(e.target.value)}
                data-testid="tour-driver"
              >
                <option value="">{t("driverNone")}</option>
                {plan.drivers.map((d) => (
                  <option key={d.id} value={d.id} disabled={!d.active}>
                    {d.active ? d.displayName : t("driverInactive", { name: d.displayName })}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              onClick={() => setReleaseOpen(true)}
              disabled={busy || blocker !== null}
              data-testid="tour-release"
            >
              <RocketIcon aria-hidden />
              {t("release")}
            </Button>
            {blocker === "driver_required" ? (
              <p className="basis-full text-sm text-muted-foreground" data-testid="release-hint">
                {t("errors.driver_required")}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-base" data-testid="tour-readonly">
            <p>{t("releasedNotice")}</p>
            {driver ? (
              <p className="text-muted-foreground">
                {t("driver")}: {driver.displayName}
              </p>
            ) : null}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:sticky lg:top-4 lg:self-start" aria-label={t("mapLabel")}>
          <TourMapLazy
            stops={stops.map((s, index) => ({
              id: s.id,
              sequence: index + 1,
              lat: s.lat,
              lng: s.lng,
              label: s.name,
            }))}
            depot={
              tour.depot
                ? { lat: tour.depot.lat, lng: tour.depot.lng, label: tour.depot.name }
                : null
            }
            geometry={recalculating ? null : tour.geometry}
            tiles={tiles}
          />
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{t("stopsHeading")}</h2>
          <ol className="flex flex-col gap-2" data-testid="stop-list" aria-busy={recalculating}>
            {stops.map((stop, index) => (
              <li
                key={stop.id}
                draggable={editable && !busy}
                onDragStart={(e) => {
                  setDragId(stop.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", stop.id);
                }}
                onDragOver={(e) => {
                  if (dragId) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== stop.id) move(dragId, index);
                  setDragId(null);
                }}
                onDragEnd={() => setDragId(null)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-card p-3",
                  dragId === stop.id && "opacity-50",
                )}
                data-testid="stop-row"
                data-stop-id={stop.id}
                data-customer-id={stop.customerId}
                data-sequence={index + 1}
              >
                {editable ? (
                  <GripVerticalIcon
                    className="size-5 shrink-0 cursor-grab text-muted-foreground"
                    aria-label={t("stop.drag", { name: stop.name })}
                    role="img"
                    data-testid="stop-handle"
                  />
                ) : null}
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  data-testid="stop-number"
                >
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium" data-testid="stop-name">
                    {stop.name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {stop.customerNumber} · {stop.street}, {stop.postalCode} {stop.city}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" data-testid="stop-items">
                      {t("stop.items", { count: stop.itemCount })}
                    </Badge>
                    {!stop.hasStorePhoto ? (
                      <Badge variant="outline" className="gap-1" data-testid="stop-missing-store">
                        <ImageOffIcon className="size-3.5" aria-hidden />
                        {t("stop.missingStore")}
                      </Badge>
                    ) : null}
                    {!stop.hasParkingPhoto ? (
                      <Badge variant="outline" className="gap-1" data-testid="stop-missing-parking">
                        <ImageOffIcon className="size-3.5" aria-hidden />
                        {t("stop.missingParking")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end text-right">
                  <span className="text-xs text-muted-foreground">{t("stop.eta")}</span>
                  <span className="text-lg font-semibold tabular-nums" data-testid="stop-eta">
                    {recalculating
                      ? t("stop.recalculating")
                      : stop.etaAt
                        ? fmt.time(new Date(stop.etaAt))
                        : "–"}
                  </span>
                </div>
                {editable ? (
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={busy || index === 0}
                      aria-label={t("stop.moveUp", { name: stop.name })}
                      onClick={() => move(stop.id, index - 1)}
                      data-testid="stop-up"
                    >
                      <ArrowUpIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={busy || index === stops.length - 1}
                      aria-label={t("stop.moveDown", { name: stop.name })}
                      onClick={() => move(stop.id, index + 1)}
                      data-testid="stop-down"
                    >
                      <ArrowDownIcon aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
        <DialogContent data-testid="release-dialog">
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base">
            <dt className="text-muted-foreground">{t("dialog.stops")}</dt>
            <dd className="font-medium" data-testid="release-stops">
              {t("summary.stops", { count: tour.stops.length })}
            </dd>
            <dt className="text-muted-foreground">{t("dialog.duration")}</dt>
            <dd className="font-medium" data-testid="release-duration">
              {durationText}
            </dd>
            <dt className="text-muted-foreground">{t("dialog.driver")}</dt>
            <dd className="font-medium" data-testid="release-driver">
              {driver?.displayName ?? "–"}
            </dd>
          </dl>
          <ErrorAlert error={error} errorText={errorText} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReleaseOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={release}
              disabled={pending}
              data-testid="release-confirm"
            >
              {t("dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Summary({ label, value, id }: { label: string; value: string; id: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold" data-testid={id}>
        {value}
      </dd>
    </div>
  );
}

function ErrorAlert({
  error,
  errorText,
}: {
  error: { code: string; max?: number } | null;
  errorText: (code: string, max?: number) => string;
}) {
  const t = useTranslations("admin.tours");
  if (!error) return null;
  return (
    <Alert variant="destructive" data-testid="tour-error" data-code={error.code}>
      <TriangleAlertIcon aria-hidden />
      <AlertDescription>
        <p>{errorText(error.code, error.max)}</p>
        {error.code === "depot_not_set" ? (
          <Link href="/admin/settings" className="underline">
            {t("errors.settingsLink")}
          </Link>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function Warnings({ plan }: { plan: TourPlan }) {
  const t = useTranslations("admin.tours");
  if (plan.warnings.length === 0) return null;
  return (
    <Alert data-testid="tour-warnings">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{t("warningsTitle")}</AlertTitle>
      <AlertDescription>
        <p>{t("warningsBody")}</p>
        <ul className="mt-2 flex flex-col gap-1">
          {plan.warnings.map((w) => (
            <li key={w.customerId} data-testid="tour-warning" data-customer-id={w.customerId}>
              <Link href={`/admin/customers/${w.customerId}`} className="font-medium underline">
                {w.name} ({w.customerNumber})
              </Link>{" "}
              – {t("warningLink")}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
