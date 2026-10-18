"use client";

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  ImageOffIcon,
  MapPinIcon,
  NavigationIcon,
  PackageIcon,
  StickyNoteIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ImagePreview } from "@/components/shared/image-preview";
import { Button } from "@/components/ui/button";
import { formatAddress } from "@/domain/driver-stop";
import type { PhotoKind } from "@/domain/photos";
import { Link } from "@/i18n/navigation";
import { isIosDevice } from "@/lib/device";
import type { DriverStopDetail, StopPhoto } from "@/lib/driver-tour-model";
import { createAppFormatters } from "@/lib/format";
import { appleMapsNavigationUrl, googleMapsNavigationUrl } from "@/lib/navigation";
import { useOverlaidStop, useOverlaidStops } from "@/lib/offline/use-overlay";
import { cn } from "@/lib/utils";

import { RefreshOnFocus } from "./refresh-on-focus";
import { StopStatusActions } from "./stop-status-actions";

type UnitKey = "KG" | "PACK" | "CRATE" | "PIECE";

const cents = (value: number) => value / 100;

const subscribeNothing = () => () => {};
/** True on iPhone / iPad (detected in the browser; false during server rendering). */
function useIsIos(): boolean {
  return useSyncExternalStore(subscribeNothing, isIosDevice, () => false);
}

/** Address line; tapping copies it to the clipboard (e.g. to paste it into another app). */
function CopyAddress({ address }: { address: string }) {
  const t = useTranslations("driver.stop");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      return; // clipboard not available (insecure context, denied): nothing was copied
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <button
        type="button"
        onClick={copy}
        className="flex min-h-12 w-full items-start gap-2 rounded-md text-start text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${t("copyAddress")}: ${address}`}
        data-testid="stop-address"
      >
        <MapPinIcon className="mt-1 size-5 shrink-0" aria-hidden />
        <span className="flex-1">{address}</span>
        {copied ? (
          <CheckIcon className="mt-1 size-5 shrink-0 text-green-700" aria-hidden />
        ) : (
          <CopyIcon className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      <p className="ps-7 text-base text-green-700 dark:text-green-400" role="status">
        {copied ? <span data-testid="address-copied">{t("copied")}</span> : null}
      </p>
    </div>
  );
}

/** Large photo with fullscreen pinch-zoom, or a placeholder of the same size when missing. */
function PhotoSlot({
  kind,
  photo,
  alt,
}: {
  kind: PhotoKind;
  photo: StopPhoto | null;
  alt: string;
}) {
  const t = useTranslations("driver.stop");
  const label = kind === "STORE" ? t("photoStore") : t("photoParking");
  return (
    <section className="space-y-2" data-testid={`photo-${kind.toLowerCase()}`}>
      <h2 className="text-lg font-semibold">{label}</h2>
      {/* Fixed 4:3 box: a missing, slow or broken photo never changes the layout. */}
      <div className="aspect-[4/3] w-full overflow-hidden rounded-lg border bg-muted">
        {photo ? (
          <ImagePreview
            src={photo.url}
            alt={alt}
            fit="contain"
            className="size-full rounded-none"
          />
        ) : (
          <div
            className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground"
            data-testid="photo-missing"
          >
            <ImageOffIcon className="size-12" aria-hidden />
            <span className="text-base font-medium">{t("noPhoto")}</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function StopDetail({
  detail,
  offline = false,
}: {
  detail: DriverStopDetail;
  /** Rendered from the offline copy (NUD-081): taps are queued on the device (NUD-082). */
  offline?: boolean;
}) {
  const t = useTranslations("driver");
  const fmt = createAppFormatters(useFormatter(), detail.timezone);
  const ios = useIsIos();
  // Queued taps the server has not confirmed yet count as done on this screen (NUD-082).
  const stop = useOverlaidStop(detail.stop);
  const tourStops = useOverlaidStops(detail.tourStops);
  const hasPin = stop.lat !== null && stop.lng !== null;
  const address = formatAddress(stop);

  return (
    <div className="space-y-5" data-testid="stop-detail" data-stop-id={stop.id}>
      {offline ? null : <RefreshOnFocus />}
      <Button asChild variant="outline" size="lg">
        <Link href="/driver" data-testid="back">
          <ArrowLeftIcon className="size-5" aria-hidden />
          {t("stop.back")}
        </Link>
      </Button>

      <header className="space-y-2" data-testid="stop-header">
        <p className="text-base text-muted-foreground" data-testid="stop-position">
          {t("stop.position", { position: detail.position, total: detail.total })}
        </p>
        <div className="flex items-start gap-3">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground"
            data-testid="stop-number"
            aria-label={t("today.stopLabel", { number: stop.sequence })}
          >
            {stop.sequence}
          </span>
          <h1 className="min-w-0 text-2xl font-bold break-words" data-testid="stop-name">
            {stop.customerName}
          </h1>
        </div>
        <CopyAddress address={address} />
        {stop.etaAt ? (
          <p className="flex items-center gap-2 text-lg" data-testid="stop-eta">
            <ClockIcon className="size-5 shrink-0" aria-hidden />
            {t("today.eta", { time: fmt.time(new Date(stop.etaAt)) })}
          </p>
        ) : null}
      </header>

      <div className="grid gap-3" data-testid="navigation">
        {hasPin ? (
          <>
            <Button asChild size="lg" className="h-14 text-lg">
              <a
                href={googleMapsNavigationUrl(stop.lat!, stop.lng!)}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="navigate"
              >
                <NavigationIcon className="size-6" aria-hidden />
                {t("today.navigate")}
              </a>
            </Button>
            {ios ? (
              <Button asChild size="lg" variant="outline" className="h-14 text-lg">
                <a
                  href={appleMapsNavigationUrl(stop.lat!, stop.lng!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="navigate-apple"
                >
                  <NavigationIcon className="size-6" aria-hidden />
                  {t("stop.appleMaps")}
                </a>
              </Button>
            ) : null}
          </>
        ) : (
          <p className="flex items-center gap-2 text-base" data-testid="no-pin">
            <AlertTriangleIcon className="size-5 shrink-0" aria-hidden />
            {t("today.noPin")}
          </p>
        )}
      </div>

      <PhotoSlot
        kind="STORE"
        photo={detail.photos.STORE}
        alt={`${t("stop.photoStore")}: ${stop.customerName}`}
      />
      <PhotoSlot
        kind="PARKING"
        photo={detail.photos.PARKING}
        alt={`${t("stop.photoParking")}: ${stop.customerName}`}
      />

      <section className="space-y-3" data-testid="stop-items">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <PackageIcon className="size-5" aria-hidden />
          {t("stop.items")}
        </h2>
        <ul className="divide-y rounded-lg border bg-card">
          {stop.items.map((item) => (
            <li
              key={item.productId}
              className="flex items-center justify-between gap-3 p-3"
              data-testid="stop-item"
            >
              <div className="min-w-0">
                <p className="text-xl font-semibold break-words" data-testid="item-name">
                  {item.name}
                </p>
                {item.germanName && item.germanName !== item.name ? (
                  <p
                    className="text-sm text-muted-foreground break-words"
                    data-testid="item-name-de"
                  >
                    <span lang="de">{item.germanName}</span>
                  </p>
                ) : null}
              </div>
              <p className="shrink-0 text-end" data-testid="item-quantity">
                <strong className="text-3xl font-bold tabular-nums">
                  {fmt.quantity(cents(item.quantityCents))}
                </strong>{" "}
                <span className="text-lg">
                  {t(`units.${item.unit as UnitKey}`, { count: cents(item.quantityCents) })}
                </span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {detail.notes || detail.deliveryHoursInfo ? (
        <section className="space-y-3" data-testid="stop-info">
          {detail.notes ? (
            <div className="space-y-1 rounded-lg border bg-card p-3" data-testid="stop-notes">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <StickyNoteIcon className="size-5" aria-hidden />
                {t("stop.notes")}
                {detail.notes.lang === "de" && detail.locale !== "de" ? (
                  <span
                    className="rounded border px-1.5 text-sm font-medium text-muted-foreground"
                    data-testid="notes-lang"
                    title={t("stop.notesGerman")}
                  >
                    DE
                  </span>
                ) : null}
              </h2>
              <p className="text-lg whitespace-pre-wrap break-words" lang={detail.notes.lang}>
                {detail.notes.text}
              </p>
            </div>
          ) : null}
          {detail.deliveryHoursInfo ? (
            <div className="space-y-1 rounded-lg border bg-card p-3" data-testid="stop-hours">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <ClockIcon className="size-5" aria-hidden />
                {t("stop.hours")}
              </h2>
              <p className="text-lg whitespace-pre-wrap break-words">{detail.deliveryHoursInfo}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <div data-testid="status-actions-slot">
        <StopStatusActions
          key={`${stop.id}:${stop.status}`}
          stop={stop}
          tourStops={tourStops}
          tourStatus={detail.tourStatus}
          timezone={detail.timezone}
          offline={offline}
        />
      </div>

      <nav className="grid grid-cols-2 gap-3" aria-label={t("stop.stopNavigation")}>
        <StopLink
          id={detail.prevStopId}
          direction="prev"
          label={t("stop.previous")}
          testId="prev-stop"
        />
        <StopLink
          id={detail.nextStopId}
          direction="next"
          label={t("stop.next")}
          testId="next-stop"
        />
      </nav>
    </div>
  );
}

function StopLink({
  id,
  direction,
  label,
  testId,
}: {
  id: string | null;
  direction: "prev" | "next";
  label: string;
  testId: string;
}) {
  const Icon = direction === "prev" ? ChevronLeftIcon : ChevronRightIcon;
  const content = (
    <>
      {direction === "prev" ? <Icon className="size-6 rtl:rotate-180" aria-hidden /> : null}
      <span>{label}</span>
      {direction === "next" ? <Icon className="size-6 rtl:rotate-180" aria-hidden /> : null}
    </>
  );
  const className = cn("h-14 text-lg", direction === "next" && "col-start-2");
  if (!id) {
    return (
      <Button variant="outline" size="lg" className={className} disabled data-testid={testId}>
        {content}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="lg" className={className}>
      <Link href={`/driver/stops/${id}`} data-testid={testId}>
        {content}
      </Link>
    </Button>
  );
}
