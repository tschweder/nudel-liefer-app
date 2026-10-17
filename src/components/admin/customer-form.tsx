"use client";

import { AlertTriangleIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { LatLngInputs } from "@/components/maps/lat-lng-inputs";
import { PinPickerMapLazy } from "@/components/maps/lazy";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canConfirmPin, type CustomerAddress } from "@/domain/customer";
import { Link, useRouter } from "@/i18n/navigation";
import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { createCustomerAction, updateCustomerAction } from "@/server/customer-actions";
import { geocodeAddressAction } from "@/server/geocode-actions";
import type { GeocodeCandidate } from "@/server/geocoder";

export type CustomerFormValues = {
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  pin: LatLng | null;
  pinConfirmed: boolean;
  deliveryHoursInfo: string;
  notes: string;
};

type Props = {
  /** `null` creates a customer; an id edits that customer. */
  customerId: string | null;
  initial: CustomerFormValues;
  tiles: MapTileConfig;
};

const LOW_CONFIDENCE = 0.5;
const textareaClass =
  "flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

type Search =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "message"; message: "noAddress" | "notFound" | "failed" }
  | { state: "results"; candidates: GeocodeCandidate[] };

export function CustomerForm({ customerId, initial, tiles }: Props) {
  const t = useTranslations("admin.customers.form");
  const tm = useTranslations("admin.maps");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [number, setNumber] = useState(initial.customerNumber);
  const [name, setName] = useState(initial.name);
  const [street, setStreet] = useState(initial.street);
  const [postalCode, setPostalCode] = useState(initial.postalCode);
  const [city, setCity] = useState(initial.city);
  const [country, setCountry] = useState(initial.country);
  const [hours, setHours] = useState(initial.deliveryHoursInfo);
  const [notes, setNotes] = useState(initial.notes);
  const [pin, setPin] = useState(initial.pin);
  const [confirmed, setConfirmed] = useState(initial.pinConfirmed);
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [focus, setFocus] = useState<{ point: LatLng; nonce: number } | null>(null);
  const [error, setError] = useState<"invalid" | "generic" | null>(null);
  const [numberTaken, setNumberTaken] = useState(false);

  const address: CustomerAddress = { street, postalCode, city, country };
  const before = customerId
    ? {
        address: {
          street: initial.street,
          postalCode: initial.postalCode,
          city: initial.city,
          country: initial.country,
        },
        pin: initial.pin,
      }
    : null;
  const confirmable = canConfirmPin(before, { address, pin });
  const needsNewPin = Boolean(pin) && !confirmable;

  // Any change of the address or the pin withdraws an earlier confirmation (D9).
  function editAddress(set: (value: string) => void) {
    return (value: string) => {
      set(value);
      setConfirmed(false);
      setSearch({ state: "idle" });
    };
  }

  function changePin(next: LatLng) {
    setPin(next);
    setConfirmed(false);
  }

  async function findOnMap() {
    const query = [street, [postalCode, city].filter(Boolean).join(" "), country]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ");
    if (!street.trim() || !city.trim())
      return setSearch({ state: "message", message: "noAddress" });
    setSearch({ state: "busy" });
    try {
      const result = await geocodeAddressAction(query);
      if (!result.ok) return setSearch({ state: "message", message: "failed" });
      if (result.candidates.length === 0) {
        return setSearch({ state: "message", message: "notFound" });
      }
      setSearch({ state: "results", candidates: result.candidates });
    } catch {
      setSearch({ state: "message", message: "failed" });
    }
  }

  function choose(candidate: GeocodeCandidate) {
    const point = { lat: candidate.lat, lng: candidate.lng };
    changePin(point);
    setFocus({ point, nonce: (focus?.nonce ?? 0) + 1 });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNumberTaken(false);
    const input = {
      customerNumber: number,
      name,
      street,
      postalCode,
      city,
      country,
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
      pinConfirmed: confirmed && confirmable,
      deliveryHoursInfo: hours,
      notes,
    };
    startTransition(async () => {
      let result;
      try {
        result = customerId
          ? await updateCustomerAction(customerId, input)
          : await createCustomerAction(input);
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        if (result.error === "number_taken") return setNumberTaken(true);
        return setError(result.error === "not_found" ? "generic" : "invalid");
      }
      toast.success(t(customerId ? "savedEdit" : "savedNew"));
      router.push(`/admin/customers/${result.id}`);
      router.refresh();
    });
  }

  const searchMessage =
    search.state === "message"
      ? search.message === "noAddress"
        ? t("needAddress")
        : tm(search.message)
      : null;

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-10" noValidate>
      <section className="flex flex-col gap-4" aria-labelledby="cust-data">
        <h2 id="cust-data" className="text-xl font-semibold">
          {t("dataHeading")}
        </h2>
        <div className="flex max-w-xs flex-col gap-2">
          <Label htmlFor="cust-number">{t("number")}</Label>
          <Input
            id="cust-number"
            value={number}
            maxLength={32}
            onChange={(e) => {
              setNumber(e.target.value);
              setNumberTaken(false);
            }}
            aria-invalid={numberTaken || undefined}
            aria-describedby={numberTaken ? "cust-number-error" : "cust-number-hint"}
            required
            data-testid="customer-number"
          />
          {numberTaken ? (
            <p
              id="cust-number-error"
              className="text-sm text-destructive"
              role="alert"
              data-testid="number-taken"
            >
              {t("numberTaken")}
            </p>
          ) : (
            <p id="cust-number-hint" className="text-sm text-muted-foreground">
              {customerId ? t("numberHintEdit") : t("numberHintNew")}
            </p>
          )}
        </div>
        <div className="flex max-w-xl flex-col gap-2">
          <Label htmlFor="cust-name">{t("name")}</Label>
          <Input
            id="cust-name"
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
            required
            data-testid="customer-name"
          />
          <p className="text-sm text-muted-foreground">{t("nameHint")}</p>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="cust-address">
        <h2 id="cust-address" className="text-xl font-semibold">
          {t("addressHeading")}
        </h2>
        <div className="flex max-w-xl flex-col gap-2">
          <Label htmlFor="cust-street">{t("street")}</Label>
          <Input
            id="cust-street"
            value={street}
            maxLength={160}
            onChange={(e) => editAddress(setStreet)(e.target.value)}
            required
            data-testid="customer-street"
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex w-32 flex-col gap-2">
            <Label htmlFor="cust-zip">{t("postalCode")}</Label>
            <Input
              id="cust-zip"
              value={postalCode}
              maxLength={16}
              onChange={(e) => editAddress(setPostalCode)(e.target.value)}
              required
              data-testid="customer-postal"
            />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-2 sm:max-w-sm">
            <Label htmlFor="cust-city">{t("city")}</Label>
            <Input
              id="cust-city"
              value={city}
              maxLength={100}
              onChange={(e) => editAddress(setCity)(e.target.value)}
              required
              data-testid="customer-city"
            />
          </div>
          <div className="flex w-24 flex-col gap-2">
            <Label htmlFor="cust-country">{t("country")}</Label>
            <Input
              id="cust-country"
              value={country}
              maxLength={2}
              onChange={(e) => editAddress(setCountry)(e.target.value)}
              aria-describedby="cust-country-hint"
              required
              data-testid="customer-country"
            />
          </div>
        </div>
        <p id="cust-country-hint" className="-mt-2 text-sm text-muted-foreground">
          {t("countryHint")}
        </p>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="cust-pin">
        <h2 id="cust-pin" className="text-xl font-semibold">
          {t("pinHeading")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("pinHint")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={findOnMap}
            disabled={search.state === "busy"}
            data-testid="customer-find"
          >
            <SearchIcon aria-hidden="true" />
            {search.state === "busy" ? tm("locating") : t("find")}
          </Button>
          <p className="text-sm text-muted-foreground" role="status" data-testid="find-message">
            {searchMessage}
          </p>
        </div>
        {search.state === "results" ? (
          <div className="flex flex-col gap-2" data-testid="candidates">
            <h3 className="text-base font-medium">{t("candidatesHeading")}</h3>
            <ul className="flex flex-col gap-2">
              {search.candidates.map((c, index) => {
                const selected =
                  pin?.lat === Math.round(c.lat * 1e6) / 1e6 &&
                  pin?.lng === Math.round(c.lng * 1e6) / 1e6;
                return (
                  <li key={`${c.lat},${c.lng},${index}`}>
                    <Button
                      type="button"
                      variant={selected ? "default" : "outline"}
                      className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                      onClick={() => choose(c)}
                      aria-pressed={selected}
                      data-testid="candidate"
                    >
                      <span className="flex flex-col items-start">
                        <span>{c.label}</span>
                        {c.confidence < LOW_CONFIDENCE ? (
                          <span className="flex items-center gap-1 text-sm">
                            <AlertTriangleIcon className="size-4" aria-hidden="true" />
                            {tm("lowConfidence")}
                          </span>
                        ) : null}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <PinPickerMapLazy
          value={pin}
          onChange={changePin}
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
          onChange={changePin}
          labels={{
            legend: tm("coordinates"),
            latitude: tm("latitude"),
            longitude: tm("longitude"),
            invalid: tm("coordinatesInvalid"),
          }}
        />
        <label className="flex items-start gap-3 text-base">
          <input
            type="checkbox"
            className="mt-1 size-5 accent-primary"
            checked={confirmed && confirmable}
            disabled={!confirmable}
            onChange={(e) => setConfirmed(e.target.checked)}
            data-testid="pin-confirm"
          />
          <span>{t("confirm")}</span>
        </label>
        {!pin ? (
          <p className="text-sm text-muted-foreground" data-testid="pin-hint">
            {t("confirmNeedsPin")}
          </p>
        ) : needsNewPin ? (
          <p className="text-sm text-muted-foreground" data-testid="pin-hint">
            {t("confirmNeedsMove")}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="cust-extra">
        <h2 id="cust-extra" className="text-xl font-semibold">
          {t("extraHeading")}
        </h2>
        <div className="flex max-w-xl flex-col gap-2">
          <Label htmlFor="cust-hours">{t("hours")}</Label>
          <Input
            id="cust-hours"
            value={hours}
            maxLength={300}
            onChange={(e) => setHours(e.target.value)}
            aria-describedby="cust-hours-hint"
            data-testid="customer-hours"
          />
          <p id="cust-hours-hint" className="text-sm text-muted-foreground">
            {t("hoursHint")}
          </p>
        </div>
        <div className="flex max-w-xl flex-col gap-2">
          <Label htmlFor="cust-notes">{t("notes")}</Label>
          <textarea
            id="cust-notes"
            className={textareaClass}
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            aria-describedby="cust-notes-hint"
            data-testid="customer-notes"
          />
          <p id="cust-notes-hint" className="text-sm text-muted-foreground">
            {t("notesHint")}
          </p>
        </div>
      </section>

      {error ? (
        <p className="text-base text-destructive" role="alert" data-testid="customer-error">
          {error === "invalid" ? t("errors.invalid") : tc("errors.generic")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending} data-testid="customer-save">
          {pending ? t("saving") : customerId ? tc("actions.save") : t("create")}
        </Button>
        <Link
          href={customerId ? `/admin/customers/${customerId}` : "/admin/customers"}
          className={buttonVariants({ variant: "outline" })}
        >
          {tc("actions.cancel")}
        </Link>
      </div>
    </form>
  );
}
