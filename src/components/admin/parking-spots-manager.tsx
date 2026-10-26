"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CarFrontIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { LatLngInputs } from "@/components/maps/lat-lng-inputs";
import { PinPickerMapLazy } from "@/components/maps/lazy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PARKING_LABEL_MAX, PARKING_MAX_ACTIVE, PARKING_NOTE_MAX } from "@/domain/parking";
import { useRouter } from "@/i18n/navigation";
import type { LatLng } from "@/lib/coords";
import type { MapTileConfig } from "@/lib/map-config";
import {
  createParkingSpotAction,
  deactivateParkingSpotAction,
  reorderParkingSpotsAction,
  updateParkingSpotAction,
} from "@/server/parking-actions";
import type { ParkingSpotView } from "@/server/parking-spots";

type Props = {
  customerId: string;
  /** Active spots in display order; the first one is the default. */
  spots: ParkingSpotView[];
  tiles: MapTileConfig;
  /** The geocoded delivery address, used as the map's starting view. */
  addressPoint: LatLng | null;
};

type Editing = { mode: "create" } | { mode: "edit"; spot: ParkingSpotView } | null;

/**
 * "Parkplätze" on the customer detail page (NUD-125, D22): add, edit, reorder and remove (soft
 * delete) a customer's parking spots. The first spot is the default (the routing point).
 */
export function ParkingSpotsManager({ customerId, spots, tiles, addressPoint }: Props) {
  const t = useTranslations("admin.customers.parking");
  const tc = useTranslations("common");
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<ParkingSpotView | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = (spot: ParkingSpotView, index: number) =>
    spot.label || t("fallbackName", { n: index + 1 });

  function fail(error: string) {
    toast.error(
      error === "limit"
        ? t("errors.limit", { max: PARKING_MAX_ACTIVE })
        : error === "conflict"
          ? t("errors.conflict")
          : tc("errors.generic"),
    );
    if (error === "conflict" || error === "not_found") router.refresh();
  }

  function move(from: number, to: number) {
    const ids = spots.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved as string);
    startTransition(async () => {
      let result;
      try {
        result = await reorderParkingSpotsAction({ customerId, ids });
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      if (!result.ok) return fail(result.error);
      toast.success(t("reordered"));
      router.refresh();
    });
  }

  function remove(spot: ParkingSpotView) {
    startTransition(async () => {
      let result;
      try {
        result = await deactivateParkingSpotAction({ id: spot.id });
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      setRemoving(null);
      if (!result.ok) return fail(result.error);
      toast.success(t("removed"));
      router.refresh();
    });
  }

  return (
    <Card data-testid="parking-spots">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="d-parking" className="text-lg font-semibold">
              {t("heading")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("hint")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing({ mode: "create" })}
            disabled={spots.length >= PARKING_MAX_ACTIVE}
            data-testid="parking-add"
          >
            <PlusIcon aria-hidden />
            {t("add")}
          </Button>
        </div>
        {spots.length === 0 ? (
          <p className="text-base text-muted-foreground" data-testid="parking-empty">
            {t("empty")}
          </p>
        ) : (
          <ol className="flex flex-col" aria-labelledby="d-parking" data-testid="parking-list">
            {spots.map((spot, index) => {
              const name = nameOf(spot, index);
              return (
                <li
                  key={spot.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b py-3 first:pt-0 last:border-0 last:pb-0"
                  data-testid="parking-row"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <CarFrontIcon className="size-4 text-muted-foreground" aria-hidden />
                      <span data-testid="parking-name">{name}</span>
                      {spot.isDefault ? (
                        <Badge variant="success" data-testid="parking-default">
                          {t("default")}
                        </Badge>
                      ) : null}
                    </span>
                    {spot.note ? (
                      <span className="text-base whitespace-pre-line" data-testid="parking-note">
                        {spot.note}
                      </span>
                    ) : null}
                    <span className="font-mono text-sm text-muted-foreground">
                      {spot.lat}, {spot.lng}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("moveUp", { name })}
                      disabled={pending || index === 0}
                      onClick={() => move(index, index - 1)}
                      data-testid="parking-up"
                    >
                      <ArrowUpIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("moveDown", { name })}
                      disabled={pending || index === spots.length - 1}
                      onClick={() => move(index, index + 1)}
                      data-testid="parking-down"
                    >
                      <ArrowDownIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("editSpot", { name })}
                      onClick={() => setEditing({ mode: "edit", spot })}
                      data-testid="parking-edit"
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("removeSpot", { name })}
                      onClick={() => setRemoving(spot)}
                      data-testid="parking-remove"
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl" data-testid="parking-dialog">
          {editing ? (
            <ParkingSpotForm
              key={editing.mode === "edit" ? editing.spot.id : "new"}
              customerId={customerId}
              spot={editing.mode === "edit" ? editing.spot : null}
              tiles={tiles}
              addressPoint={addressPoint}
              onDone={() => {
                setEditing(null);
                router.refresh();
              }}
              onFail={fail}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeTitle")}</DialogTitle>
            <DialogDescription>{t("removeDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoving(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => removing && remove(removing)}
              data-testid="parking-remove-confirm"
            >
              {tc("actions.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ParkingSpotForm({
  customerId,
  spot,
  tiles,
  addressPoint,
  onDone,
  onFail,
}: {
  customerId: string;
  spot: ParkingSpotView | null;
  tiles: MapTileConfig;
  addressPoint: LatLng | null;
  onDone: () => void;
  onFail: (error: string) => void;
}) {
  const t = useTranslations("admin.customers.parking");
  const tm = useTranslations("admin.maps");
  const tc = useTranslations("common");
  const [label, setLabel] = useState(spot?.label ?? "");
  const [note, setNote] = useState(spot?.note ?? "");
  const [point, setPoint] = useState<LatLng | null>(spot ? { lat: spot.lat, lng: spot.lng } : null);
  const [missingPoint, setMissingPoint] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!point) return setMissingPoint(true);
    startTransition(async () => {
      let result;
      try {
        result = spot
          ? await updateParkingSpotAction({ id: spot.id, label, note, ...point })
          : await createParkingSpotAction({ customerId, label, note, ...point });
      } catch {
        return onFail("generic");
      }
      if (!result.ok) return onFail(result.error);
      toast.success(t("saved"));
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="parking-form">
      <DialogHeader>
        <DialogTitle>{spot ? t("editTitle") : t("addTitle")}</DialogTitle>
        <DialogDescription>{t("mapHint")}</DialogDescription>
      </DialogHeader>
      <FormField label={t("labelField")}>
        <Input
          value={label}
          maxLength={PARKING_LABEL_MAX}
          placeholder={t("labelPlaceholder")}
          autoComplete="off"
          onChange={(e) => setLabel(e.target.value)}
          data-testid="parking-label"
        />
      </FormField>
      <FormField label={t("noteField")}>
        <Textarea
          value={note}
          maxLength={PARKING_NOTE_MAX}
          placeholder={t("notePlaceholder")}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          data-testid="parking-note-input"
        />
      </FormField>
      <div className="relative isolate w-full overflow-hidden rounded-lg border [&_.leaflet-container]:h-[300px]!">
        <PinPickerMapLazy
          value={point}
          onChange={(next) => {
            setPoint(next);
            setMissingPoint(false);
          }}
          tiles={tiles}
          fallbackCenter={addressPoint ?? undefined}
          markerKind="parking"
          labels={{
            locate: tm("locate"),
            locating: tm("locating"),
            noAddress: tm("noAddress"),
            notFound: tm("notFound"),
            failed: tm("failed"),
            lowConfidence: tm("lowConfidence"),
          }}
        />
      </div>
      <LatLngInputs
        value={point}
        onChange={(next) => {
          setPoint(next);
          setMissingPoint(false);
        }}
        labels={{
          legend: tm("coordinates"),
          latitude: tm("latitude"),
          longitude: tm("longitude"),
          invalid: tm("coordinatesInvalid"),
        }}
      />
      {missingPoint ? (
        <p className="text-sm text-destructive" role="alert" data-testid="parking-point-missing">
          {t("pointRequired")}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="submit" disabled={pending} data-testid="parking-save">
          {tc("actions.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
