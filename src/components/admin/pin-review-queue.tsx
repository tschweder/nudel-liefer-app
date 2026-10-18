"use client";

import { AlertTriangleIcon, CheckCircle2Icon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { LatLngInputs } from "@/components/maps/lat-lng-inputs";
import { PinPickerMapLazy } from "@/components/maps/lazy";
import { Button, buttonVariants } from "@/components/ui/button";
import { addressQuery } from "@/domain/customer";
import { Link, useRouter } from "@/i18n/navigation";
import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { confirmCustomerPinAction } from "@/server/customer-import-actions";
import type { PinReviewItem } from "@/server/customer-pins";
import { geocodeAddressAction } from "@/server/geocode-actions";
import type { GeocodeCandidate } from "@/server/geocoder";

const LOW_CONFIDENCE = 0.5;

type Search =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "message"; message: "notFound" | "failed" }
  | { state: "results"; candidates: GeocodeCandidate[] };

const pinOf = (item: PinReviewItem): LatLng | null =>
  item.lat !== null && item.lng !== null ? { lat: item.lat, lng: item.lng } : null;

/**
 * Pin review queue (NUD-090): steps through the customers whose pin is not confirmed. The map shows
 * the stored candidate; the admin confirms it, drags it first, or skips the customer (it stays in
 * the queue). Confirming goes through a version-checked server action, so a pin is never confirmed
 * for an address that changed in the meantime.
 */
export function PinReviewQueue({ items, tiles }: { items: PinReviewItem[]; tiles: MapTileConfig }) {
  const t = useTranslations("admin.customers.review");
  const tm = useTranslations("admin.maps");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The ids still to look at in this round; "skip" moves on, "review skipped" starts a new round.
  const [round, setRound] = useState<string[]>(() => items.map((i) => i.id));
  const [index, setIndex] = useState(0);
  const [confirmedIds, setConfirmedIds] = useState<string[]>([]);
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [pins, setPins] = useState<Record<string, LatLng | null>>(() =>
    Object.fromEntries(items.map((i) => [i.id, pinOf(i)])),
  );
  const [focus, setFocus] = useState<{ point: LatLng; nonce: number } | null>(null);
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [error, setError] = useState<"conflict" | "failed" | null>(null);

  const byId = new Map(items.map((i) => [i.id, i]));
  const total = round.length;
  const item = index < total ? byId.get(round[index]!)! : null;

  function go(next: number) {
    setIndex(next);
    setSearch({ state: "idle" });
    setError(null);
    setFocus(null);
  }

  async function findOnMap(it: PinReviewItem) {
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

  function choose(it: PinReviewItem, candidate: GeocodeCandidate) {
    const point = { lat: candidate.lat, lng: candidate.lng };
    setPins((p) => ({ ...p, [it.id]: point }));
    setFocus({ point, nonce: (focus?.nonce ?? 0) + 1 });
  }

  function confirm(it: PinReviewItem) {
    const pin = pins[it.id];
    if (!pin) return;
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await confirmCustomerPinAction({
          id: it.id,
          lat: pin.lat,
          lng: pin.lng,
          baseUpdatedAt: it.updatedAt,
        });
      } catch {
        return setError("failed");
      }
      if (!result.ok) return setError(result.error === "conflict" ? "conflict" : "failed");
      toast.success(t("confirmed"));
      setConfirmedIds((ids) => [...ids, it.id]);
      go(index + 1);
    });
  }

  function skip(it: PinReviewItem) {
    setSkippedIds((ids) => (ids.includes(it.id) ? ids : [...ids, it.id]));
    go(index + 1);
  }

  const percent = total === 0 ? 100 : Math.round((Math.min(index, total) / total) * 100);

  if (!item) {
    return (
      <section className="flex flex-col gap-4" data-testid="review-done">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <CheckCircle2Icon className="size-6 text-success" aria-hidden />
          {t("doneTitle")}
        </h2>
        <p data-testid="review-summary">
          {t("doneSummary", { confirmed: confirmedIds.length, skipped: skippedIds.length })}
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
              data-testid="review-again"
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
    <section
      className="flex flex-col gap-5"
      aria-labelledby="rev-heading"
      data-testid="review-item"
    >
      <div className="flex flex-col gap-2">
        <p id="rev-heading" className="text-lg font-semibold" data-testid="review-position">
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
        <p className="text-xl font-semibold" data-testid="review-name">
          {item.name}
        </p>
        <p className="text-muted-foreground">{t("address")}</p>
        <p data-testid="review-address">
          {item.street}, {item.postalCode} {item.city}, {item.country}
        </p>
      </div>

      <p className="max-w-prose text-muted-foreground" data-testid="review-hint">
        {pin ? t("candidate") : t("noPin")}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void findOnMap(item)}
          disabled={search.state === "busy"}
          data-testid="review-find"
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
        <div className="flex flex-col gap-2" data-testid="review-candidates">
          <h3 className="text-base font-medium">{t("candidatesHeading")}</h3>
          <ul className="flex flex-col gap-2">
            {search.candidates.map((c, i) => (
              <li key={`${c.lat},${c.lng},${i}`}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                  onClick={() => choose(item, c)}
                  data-testid="review-candidate"
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
          <span data-testid="review-error">{t(error)}</span>
          {error === "conflict" ? (
            <Button type="button" variant="outline" onClick={() => router.refresh()}>
              {t("reload")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => skip(item)}
          disabled={pending}
          data-testid="review-skip"
        >
          {t("skip")}
        </Button>
        <Button
          type="button"
          onClick={() => confirm(item)}
          disabled={!pin || pending}
          data-testid="review-confirm"
        >
          {pending ? t("saving") : t("confirm")}
        </Button>
      </div>
    </section>
  );
}
