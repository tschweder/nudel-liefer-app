"use client";

import { ClipboardCheckIcon, WarehouseIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { TodayItem } from "@/lib/driver-tour-model";
import { createAppFormatters } from "@/lib/format";
import { isPieceUnit } from "@/lib/units";

type UnitKey = "KG" | "PACK" | "CRATE" | "PIECE";

/**
 * Reload stop (NUD-147): shown between the last stop of one trip and the first stop of the next.
 * The vehicle returns to the depot; the card lists what to load for the next trip ("14 × Nudeln
 * Kiste", "3 × Wantan-Teig"), large and with an icon, so it reads without German.
 */
export function ReloadStop({
  trip,
  items,
  switchTo = null,
  onChecklist,
}: {
  trip: number;
  items: TodayItem[];
  /**
   * NUD-158: the next trip has another vehicle, already loaded at the depot: the driver changes
   * into it instead of reloading. The list then shows what that vehicle should have on board.
   */
  switchTo?: string | null;
  /** Opens the checklist of this trip (NUD-151); without it the card has no button. */
  onChecklist?: () => void;
}) {
  const t = useTranslations("driver");
  const fmt = createAppFormatters(useFormatter());
  return (
    <li
      className="my-1 rounded-lg bg-warning-soft p-3 text-warning-soft-foreground"
      data-testid="reload-stop"
      data-trip={trip}
      data-switch={switchTo ? "true" : undefined}
    >
      <p className="flex items-center gap-2 text-lg font-semibold">
        <WarehouseIcon className="size-6 shrink-0" aria-hidden />
        {switchTo ? t("today.switchTitle") : t("today.reloadTitle")}
      </p>
      <p className="mt-1 text-base">
        {switchTo
          ? t("today.switchHint", { trip, vehicle: switchTo })
          : t("today.reloadHint", { trip })}
      </p>
      <ul className="mt-2 flex flex-col gap-1" data-testid="reload-items">
        {items.map((item) => (
          <li
            key={item.productId}
            className="flex min-w-0 items-baseline gap-1.5"
            data-testid="reload-item"
            data-unit={item.unit}
          >
            <strong className="font-sans text-3xl font-bold tabular-nums">
              {fmt.quantity(item.quantity)}
            </strong>
            <span aria-hidden>×</span>
            <span className="min-w-0 font-medium">{item.name}</span>
            {isPieceUnit(item.unit) ? null : (
              <span className="shrink-0">
                {t(`units.${item.unit as UnitKey}`, { count: item.quantity })}
              </span>
            )}
          </li>
        ))}
      </ul>
      {onChecklist ? (
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="mt-3 w-full"
          onClick={onChecklist}
          data-testid="reload-checklist"
        >
          <ClipboardCheckIcon className="size-5" aria-hidden />
          {t("departure.checklistButton")}
        </Button>
      ) : null}
    </li>
  );
}
