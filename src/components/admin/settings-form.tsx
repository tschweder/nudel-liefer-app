"use client";

import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { LatLngInputs } from "@/components/maps/lat-lng-inputs";
import { PinPickerMapLazy } from "@/components/maps/lazy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ISO_WEEKDAYS } from "@/domain/settings";
import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import { geocodeAddressAction } from "@/server/geocode-actions";
import { saveSettingsAction } from "@/server/settings-actions";

export type SettingsFormValues = {
  depotName: string;
  depotAddress: string;
  /** `null` while no depot exists yet. */
  depotPin: LatLng | null;
  depotPinConfirmed: boolean;
  timezone: string;
  departureTime: string;
  serviceMinutesPerStop: number;
  deliveryWeekdays: number[];
};

const selectClass =
  "flex h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export function SettingsForm({
  initial,
  timezones,
  tiles,
}: {
  initial: SettingsFormValues;
  timezones: string[];
  tiles: MapTileConfig;
}) {
  const t = useTranslations("admin.settings");
  const tm = useTranslations("admin.maps");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.depotName);
  const [address, setAddress] = useState(initial.depotAddress);
  const [pin, setPin] = useState(initial.depotPin);
  const [confirmed, setConfirmed] = useState(initial.depotPinConfirmed);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [departure, setDeparture] = useState(initial.departureTime);
  const [minutes, setMinutes] = useState(String(initial.serviceMinutesPerStop));
  const [weekdays, setWeekdays] = useState(initial.deliveryWeekdays);
  const [error, setError] = useState<string | null>(null);

  const weekdayName = (day: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 0, 4 + day)), // 2026-01-05 is a Monday
    );

  // Moving the pin or changing the address invalidates an earlier confirmation (D9).
  function changePin(next: LatLng) {
    setPin(next);
    setConfirmed(false);
  }

  function toggleDay(day: number, on: boolean) {
    setWeekdays((days) => (on ? [...days, day] : days.filter((d) => d !== day)));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!pin) return setError(t("errors.needPin"));
    if (!confirmed) return setError(t("errors.needConfirm"));
    if (weekdays.length === 0) return setError(t("errors.needWeekday"));
    const input = {
      depotName: name,
      depotAddress: address,
      depotLat: pin.lat,
      depotLng: pin.lng,
      depotPinConfirmed: confirmed,
      timezone,
      departureTime: departure,
      serviceMinutesPerStop: minutes.trim() === "" ? Number.NaN : Number(minutes),
      deliveryWeekdays: weekdays,
    };
    startTransition(async () => {
      let result;
      try {
        result = await saveSettingsAction(input);
      } catch {
        return setError(t("errors.generic"));
      }
      if (!result.ok) return setError(t("errors.invalid"));
      toast.success(t("saved"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-10" noValidate>
      <div>
        <h1 className="text-3xl font-semibold" data-testid="section-title">
          {t("title")}
        </h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="depot-heading">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="depot-heading" className="text-xl font-semibold">
            {t("depot.heading")}
          </h2>
          {initial.depotPinConfirmed ? (
            <Badge variant="success" data-testid="depot-status">
              <CheckCircle2Icon aria-hidden="true" />
              {t("depot.status.confirmed")}
            </Badge>
          ) : (
            <Badge variant="warning" data-testid="depot-status">
              <AlertTriangleIcon aria-hidden="true" />
              {t("depot.status.unconfirmed")}
            </Badge>
          )}
        </div>
        {initial.depotPinConfirmed ? null : (
          <p className="text-base" data-testid="depot-unconfirmed-notice">
            {t("depot.unconfirmedNotice")}
          </p>
        )}
        <div className="flex max-w-xl flex-col gap-2">
          <Label htmlFor="depot-name">{t("depot.name")}</Label>
          <Input
            id="depot-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="flex max-w-xl flex-col gap-2">
          <Label htmlFor="depot-address">{t("depot.address")}</Label>
          <Input
            id="depot-address"
            value={address}
            maxLength={300}
            placeholder={t("depot.addressPlaceholder")}
            onChange={(e) => {
              setAddress(e.target.value);
              setConfirmed(false);
            }}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-medium">{t("depot.pinHeading")}</h3>
          <p className="text-sm text-muted-foreground">{t("depot.pinHint")}</p>
        </div>
        <PinPickerMapLazy
          value={pin}
          onChange={changePin}
          tiles={tiles}
          address={address}
          onLocate={geocodeAddressAction}
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
            checked={confirmed}
            disabled={!pin}
            onChange={(e) => setConfirmed(e.target.checked)}
            data-testid="depot-confirm"
          />
          <span>{t("depot.confirm")}</span>
        </label>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="planning-heading">
        <h2 id="planning-heading" className="text-xl font-semibold">
          {t("planning.heading")}
        </h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="timezone">{t("planning.timezone")}</Label>
          <select
            id="timezone"
            className={selectClass}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="flex w-44 flex-col gap-2">
            <Label htmlFor="departure">{t("planning.departureTime")}</Label>
            <Input
              id="departure"
              type="time"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
              required
            />
          </div>
          <div className="flex w-44 flex-col gap-2">
            <Label htmlFor="service-minutes">{t("planning.serviceMinutes")}</Label>
            <Input
              id="service-minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={180}
              step={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-describedby="service-minutes-hint"
              required
            />
          </div>
        </div>
        <p id="service-minutes-hint" className="-mt-2 text-sm text-muted-foreground">
          {t("planning.serviceMinutesHint")}
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("planning.weekdays")}</legend>
          <p className="text-sm text-muted-foreground">{t("planning.weekdaysHint")}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2" data-testid="weekdays">
            {ISO_WEEKDAYS.map((day) => (
              <label key={day} className="flex items-center gap-2 text-base">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={weekdays.includes(day)}
                  onChange={(e) => toggleDay(day, e.target.checked)}
                  data-testid={`weekday-${day}`}
                />
                {weekdayName(day)}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {error ? (
        <p className="text-base text-destructive" role="alert" data-testid="settings-error">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending} data-testid="settings-save">
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
