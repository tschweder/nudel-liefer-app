"use client";

import { RepeatIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { parseCalendarDate } from "@/domain/order";
import { MAX_EVERY_N_WEEKS } from "@/domain/recurring-order";
import { ISO_WEEKDAYS, isoWeekday } from "@/domain/settings";
import { useRouter } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import type { AppLocale } from "@/lib/localized-text";
import { createRecurringOrderAction } from "@/server/recurring-actions";

/** One product line of the order as the rule takes it over (quantity already parsed). */
export type RecurringDialogLine = {
  productId: string;
  quantity: number;
  /** Catalogue label, e.g. "Nudeln (Kiste)". */
  label: string;
  unit: "KG" | "PACK" | "CRATE" | "PIECE";
};

type FormError = "weekdays" | "every" | "anchor" | "customerInactive" | "generic" | null;

/**
 * Turns the order the office is just taking into a recurring order (NUD-166, D25/NUD-149). The
 * customer, the products and the quantities come from the form and are only shown here; the dialog
 * asks for the schedule alone. The delivery day of the order that is being entered is left out by
 * default: otherwise the manual order and the rule would both produce an order for that day, and
 * the stop would carry the quantities twice (all confirmed orders of a customer are merged).
 */
export function OrderRecurringDialog({
  customerId,
  customerLabel,
  lines,
  startDate,
  skipDate,
  onClose,
}: {
  customerId: string;
  /** Shown so the office sees which customer the rule belongs to. */
  customerLabel: string;
  lines: readonly RecurringDialogLine[];
  /** `YYYY-MM-DD`: default start day of the rule (first day of the requested window). */
  startDate: string;
  /** `YYYY-MM-DD` of the order being entered, or null when the day is not known yet. */
  skipDate: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("admin.orders.form.recurring");
  const tc = useTranslations("common");
  const tu = useTranslations("driver.units");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [weekdays, setWeekdays] = useState<number[]>(() => {
    const start = parseCalendarDate(startDate);
    return [start ? isoWeekday(start) : 1];
  });
  const [everyNWeeks, setEveryNWeeks] = useState("1");
  const [anchorDate, setAnchorDate] = useState(startDate);
  const [skipOrderDay, setSkipOrderDay] = useState(skipDate !== null);
  const [error, setError] = useState<FormError>(null);

  const weekdayName = (day: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 0, 4 + day)), // 2026-01-05 is a Monday
    );
  const skipText = skipDate ? fmt.calendarDate(parseCalendarDate(skipDate) ?? new Date(0)) : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const every = Number(everyNWeeks);
    if (weekdays.length === 0) return setError("weekdays");
    if (!Number.isInteger(every) || every < 1 || every > MAX_EVERY_N_WEEKS)
      return setError("every");
    if (!parseCalendarDate(anchorDate)) return setError("anchor");
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await createRecurringOrderAction({
          customerId,
          weekdays,
          everyNWeeks: every,
          anchorDate,
          seasonFrom: null,
          seasonTo: null,
          exceptions: skipOrderDay && skipDate ? [skipDate] : [],
          lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        });
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        return setError(result.error === "customer_inactive" ? "customerInactive" : "generic");
      }
      toast.success(t("created", { count: result.generated }));
      router.refresh();
      onClose();
    });
  }

  const errorText: Record<Exclude<FormError, null>, string> = {
    weekdays: t("errors.weekdays"),
    every: t("errors.every", { max: MAX_EVERY_N_WEEKS }),
    anchor: t("errors.anchor"),
    customerInactive: t("errors.customerInactive"),
    generic: t("errors.generic"),
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="order-recurring-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RepeatIcon className="size-5" aria-hidden />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("hint", { customer: customerLabel })}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" noValidate onSubmit={submit}>
          <div className="flex flex-col gap-1 rounded-md border border-input p-3">
            <p className="text-base font-medium">{t("products")}</p>
            <ul className="flex flex-col gap-0.5 text-base" data-testid="order-recurring-lines">
              {lines.map((line) => (
                <li key={line.productId} className="tabular-nums">
                  {line.quantity} {tu(line.unit, { count: line.quantity })} {line.label}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">{t("productsHint")}</p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-base font-medium">{t("weekdays")}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2" data-testid="order-recurring-weekdays">
              {ISO_WEEKDAYS.map((day) => (
                <label key={day} className="flex items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                    checked={weekdays.includes(day)}
                    onChange={(e) =>
                      setWeekdays(
                        e.target.checked
                          ? [...weekdays, day].sort((a, b) => a - b)
                          : weekdays.filter((d) => d !== day),
                      )
                    }
                    data-testid={`order-recurring-weekday-${day}`}
                  />
                  {weekdayName(day)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t("every")}
              htmlFor="order-recurring-every"
              description={t("everyHint")}
            >
              <Input
                id="order-recurring-every"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_EVERY_N_WEEKS}
                step={1}
                value={everyNWeeks}
                onChange={(e) => setEveryNWeeks(e.target.value)}
                data-testid="order-recurring-every"
              />
            </FormField>
            <FormField
              label={t("anchor")}
              htmlFor="order-recurring-anchor"
              description={t("anchorHint")}
            >
              <Input
                id="order-recurring-anchor"
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                data-testid="order-recurring-anchor"
              />
            </FormField>
          </div>

          {skipDate ? (
            <div className="flex flex-col gap-1">
              <label className="flex items-start gap-2 text-base">
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 accent-primary"
                  checked={skipOrderDay}
                  onChange={(e) => setSkipOrderDay(e.target.checked)}
                  data-testid="order-recurring-skip-day"
                />
                <span>{t("skipDay", { date: skipText })}</span>
              </label>
              <p className="text-sm text-muted-foreground pl-7">{t("skipDayHint")}</p>
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive" data-testid="order-recurring-error" data-code={error}>
              <AlertDescription>{errorText[error]}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending} data-testid="order-recurring-save">
              {pending ? t("saving") : t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
