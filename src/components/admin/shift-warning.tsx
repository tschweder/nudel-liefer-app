"use client";

import { ClockIcon, TriangleAlertIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createAppFormatters } from "@/lib/format";
import type { PlanShiftWarning } from "@/server/tour-planning";

/** Monday 5 January 2026, used only to format an ISO weekday number as a weekday name. */
const WEEKDAY_REFERENCE = (weekday: number) => new Date(Date.UTC(2026, 0, 4 + weekday));

/**
 * Planning warning of the tour page (NUD-152, D28): the assigned driver does not work that weekday,
 * or the planned return is after his shift end. Shown before the tour is released so the office can
 * reassign the driver or shorten the tour. Nothing is blocked — the warning never prevents releasing.
 */
export function ShiftWarning({
  warning,
  driverName,
  timezone,
}: {
  warning: PlanShiftWarning | null;
  driverName: string | null;
  /** Factory time zone for the times in the text. */
  timezone: string;
}) {
  const t = useTranslations("admin.tours.shift");
  const locale = useLocale();
  const format = useFormatter();
  if (!warning) return null;
  const fmt = createAppFormatters(format, timezone);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    WEEKDAY_REFERENCE(warning.weekday),
  );
  const name = driverName ?? "";
  if (warning.kind === "non_working_day") {
    return (
      <Alert variant="warning" data-testid="tour-shift-warning">
        <TriangleAlertIcon aria-hidden />
        <AlertTitle>{t("nonWorkingTitle")}</AlertTitle>
        <AlertDescription>{t("nonWorkingBody", { name, weekday })}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="warning" data-testid="tour-shift-warning">
      <ClockIcon aria-hidden />
      <AlertTitle>{t("shiftEndTitle")}</AlertTitle>
      <AlertDescription>
        {t("shiftEndBody", {
          name,
          weekday,
          planned: fmt.time(new Date(warning.plannedReturnAt)),
          end: fmt.time(new Date(warning.shiftEnd)),
          minutes: warning.overrunMinutes,
        })}
      </AlertDescription>
    </Alert>
  );
}
