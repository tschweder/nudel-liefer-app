"use client";

import { AlertTriangleIcon, CheckCircle2Icon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { LatLngInputs } from "@/components/maps/lat-lng-inputs";
import { PinPickerMapLazy } from "@/components/maps/lazy";
import { Button, buttonVariants } from "@/components/ui/button";
import { addressQuery } from "@/domain/customer";
import { Link } from "@/i18n/navigation";
import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import type { ParkingQueueItem } from "@/server/customer-pins";
import { geocodeAddressAction } from "@/server/geocode-actions";
import type { GeocodeCandidate } from "@/server/geocoder";
import { createParkingSpotAction } from "@/server/parking-actions";

const LOW_CONFIDENCE = 0.5;

type Search =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "message"; message: "notFound" | "failed" }
  | { state: "results"; candidates: GeocodeCandidate[] };

const pinOf = (item: ParkingQueueItem): LatLng | null =>
  item.lat !== null && item.lng !== null ? { lat: item.lat, lng: item.lng } : null;

/**
 * Parkplatz queue (NUD-141, D22): steps through the customers that have no Parkplatz yet (they are
 * delivered to the address). The map starts at the Adresspunkt; the admin clicks or drags the marker
 * to the parking spot and saves (the new spot becomes the customer's default), or skips the
 * customer (it stays in the queue). Saving goes through `createParkingSpotAction` (audited).
 */
export function ParkingQueue({
  items,
  tiles,
}: {
  items: ParkingQueueItem[];
  tiles: MapTileConfig;
}) {
  const t = useTranslations("admin.customers.parkingQueue");
  const tm = useTranslations("admin.maps");
  const [pending, startTransition] = useTransition();
  // The ids still to look at in this round; "skip" moves on, "review skipped" starts a new round.
  const [round, setRound] = useState<string[]>(() => items.map((i) => i.id));
  const [index, setIndex] = useState(0);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [pins, setPins] = useState<Record<string, LatLng | null>>(() =>
    Object.fromEntries(items.map((i) => [i.id, pinOf(i)])),
  );
  const [focus, setFocus] = useState<{ point: LatLng; nonce: number } | null>(null);
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [error, setError] = useState<"failed" | null>(null);

  const byId = new Map(items.map((i) => [i.id, i]));
  const total = round.length;
  const item = index < total ? byId.get(round[index]!)! : null;

  function go(next: number) {
    setIndex(next);
    setSearch({ state: "idle" });
    setError(null);
    setFocus(null);
  }

  async function findOnMap(it: ParkingQueueItem) {
    setSearch({ state: "busy" });
    try {
      const result = await geocodeAddressAction(addressQuery(it));
      if (!result.ok) return setSearch({ state: "message", message: "failed" });
      if (result.candidates.length === 0)
        return setSearch({ state: "message", message: "notFound" });
      setSearch({ state: "results", candidates: result.candidates });
    } catch {
      setSearch({ state: "message", message: "failed" });
    }
  }

  function choose(it: ParkingQueueItem, candidate: GeocodeCandidate) {
    const point = { lat: candidate.lat, lng: candidate.lng };
    setPins((p) => ({ ...p, [it.id]: point }));
    setFocus({ point, nonce: (focus?.nonce ?? 0) + 1 });
  }

  function save(it: ParkingQueueItem) {
    const pin = pins[it.id];
    if (!pin) return;
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await createParkingSpotAction({ customerId: it.id, lat: pin.lat, lng: pin.lng });
      } catch {
        return setError("failed");
      }
      if (!result.ok) return setError("failed");
      toast.success(t("saved"));
      setSavedIds((ids) => [...ids, it.id]);
      go(index + 1);
    });
  }

  function skip(it: ParkingQueueItem) {
    setSkippedIds((ids) => (ids.includes(it.id) ? ids : [...ids, it.id]));
    go(index + 1);
  }

  const percent = total === 0 ? 100 : Math.round((Math.min(index, total) / total) * 100);

  if (!item) {
    return (
      <section className="flex flex-col gap-4" data-testid="queue-done">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <CheckCircle2Icon className="size-6 text-success" aria-hidden />
          {t("doneTitle")}
        </h2>
        <p data-testid="queue-summary">
          {t("doneSummary", { saved: savedIds.length, skipped: skippedIds.length })}
        </p>
        <div className="flex flex-wrap gap-3">
          {skippedIds.length > 0 ? (
            <Button
              type="button"
              onClick={() => {
                setRound(skippedIds);
                setSkippedIds([]);
                go(0);
              }}
              data-testid="queue-again"
            >
              {t("reviewSkipped")}
            </Button>
          ) : null}
          <Link
            href="/admin/customers"
            className={buttonVariants({ variant: skippedIds.length > 0 ? "outline" : "default" })}
          >
            {t("toList")}
          </Link>
        </div>
      </section>
    );
  }

  const pin = pins[item.id] ?? null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby="rev-heading" data-testid="queue-item">
      <div className="flex flex-col gap-2">
        <p id="rev-heading" className="text-lg font-semibold" data-testid="queue-position">
          {t("position", { current: index + 1, total })}
        </p>
        <div
          role="progressbar"
          aria-label={t("progressLabel")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={index}
          className="h-3 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">{item.customerNumber}</p>
        <p className="text-xl font-semibold" data-testid="queue-name">
          {item.name}
        </p>
        <p className="text-muted-foreground">{t("address")}</p>
        <p data-testid="queue-address">
          {item.street}, {item.postalCode} {item.city}, {item.country}
        </p>
      </div>

      <p className="max-w-prose text-muted-foreground" data-testid="queue-hint">
        {pin ? t("hint") : t("noPoint")}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void findOnMap(item)}
          disabled={search.state === "busy"}
          data-testid="queue-find"
        >
          <SearchIcon aria-hidden />
          {search.state === "busy" ? tm("locating") : t("search")}
        </Button>
        {search.state === "message" ? (
          <p role="status" className="text-muted-foreground">
            {tm(search.message)}
          </p>
        ) : null}
      </div>
      {search.state === "results" ? (
        <div className="flex flex-col gap-2" data-testid="queue-candidates">
          <h3 className="text-base font-medium">{t("candidatesHeading")}</h3>
          <ul className="flex flex-col gap-2">
            {search.candidates.map((c, i) => (
              <li key={`${c.lat},${c.lng},${i}`}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                  onClick={() => choose(item, c)}
                  data-testid="queue-candidate"
                >
                  <span className="flex flex-col items-start">
                    <span>{c.label}</span>
                    {c.confidence < LOW_CONFIDENCE ? (
                      <span className="flex items-center gap-1 text-sm">
                        <AlertTriangleIcon className="size-4" aria-hidden />
                        {tm("lowConfidence")}
                      </span>
                    ) : null}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PinPickerMapLazy
        key={item.id}
        value={pin}
        onChange={(point) => setPins((p) => ({ ...p, [item.id]: point }))}
        tiles={tiles}
        focus={focus}
        address={addressQuery(item)}
        labels={{
          locate: tm("locate"),
          locating: tm("locating"),
          noAddress: tm("noAddress"),
          notFound: tm("notFound"),
          failed: tm("failed"),
          lowConfidence: tm("lowConfidence"),
        }}
      />
      <LatLngInputs
        value={pin}
        onChange={(point) => setPins((p) => ({ ...p, [item.id]: point }))}
        labels={{
          legend: tm("coordinates"),
          latitude: tm("latitude"),
          longitude: tm("longitude"),
          invalid: tm("coordinatesInvalid"),
        }}
      />

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-destructive">
          <AlertTriangleIcon className="size-5 shrink-0" aria-hidden />
          <span data-testid="queue-error">{t(error)}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => skip(item)}
          disabled={pending}
          data-testid="queue-skip"
        >
          {t("skip")}
        </Button>
        <Button
          type="button"
          onClick={() => save(item)}
          disabled={!pin || pending}
          data-testid="queue-confirm"
        >
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </section>
  );
}
