"use client";

import {
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { parseCalendarDate, parseQuantity } from "@/domain/order";
import { MAX_EVERY_N_WEEKS, type RuleState } from "@/domain/recurring-order";
import { ISO_WEEKDAYS } from "@/domain/settings";
import { useRouter } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import {
  createRecurringOrderAction,
  setRecurringOrderActiveAction,
  updateRecurringOrderAction,
} from "@/server/recurring-actions";
import type { RecurringRuleView } from "@/server/recurring-orders";

export type RecurringProductChoice = {
  id: string;
  label: string;
  unit: "KG" | "PACK" | "CRATE" | "PIECE";
};

type FormLine = { key: number; productId: string; quantity: string };
type FormState = {
  id: string | null;
  weekdays: number[];
  everyNWeeks: string;
  anchorDate: string;
  season: boolean;
  from: { month: string; day: string };
  to: { month: string; day: string };
  exceptions: string[];
  exceptionDraft: string;
  lines: FormLine[];
};
type FormError = "weekdays" | "every" | "anchor" | "lines" | "customerInactive" | "generic" | null;

const selectClass =
  "h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const pad = (n: number | string) => String(n).padStart(2, "0");

function splitMonthDay(value: string | null, fallback: { month: string; day: string }) {
  if (!value) return fallback;
  return { month: String(Number(value.slice(0, 2))), day: String(Number(value.slice(3, 5))) };
}

function productName(name: unknown, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return parsed.success ? pick(parsed.data, locale) : "";
}

/**
 * Recurring orders of a customer (NUD-149, D25): the office confirms a rule once ("every Monday
 * and Thursday", "every second week from September to May"), the daily job then creates the
 * orders. Rules are paused, never deleted. Orders created earlier are not touched by an edit.
 */
export function RecurringOrdersCard({
  customerId,
  customerActive,
  rules,
  products,
  today,
}: {
  customerId: string;
  customerActive: boolean;
  rules: RecurringRuleView[];
  products: RecurringProductChoice[];
  /** `YYYY-MM-DD` in the factory time zone: default start of a new rule. */
  today: string;
}) {
  const t = useTranslations("admin.customers.recurring");
  const tc = useTranslations("common");
  const tu = useTranslations("driver.units");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<FormError>(null);
  const nextLineKey = useRef(2);

  const weekdayName = (day: number, style: "long" | "short" = "long") =>
    new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 0, 4 + day)), // 2026-01-05 is a Monday
    );
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2001, month - 1, 1)),
    );
  const monthDayText = (value: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(2001, Number(value.slice(0, 2)) - 1, Number(value.slice(3, 5)))),
    );
  const dayText = (value: string) => fmt.calendarDate(parseCalendarDate(value) ?? new Date(0));

  function open(rule: RecurringRuleView | null) {
    setError(null);
    nextLineKey.current = (rule?.lines.length ?? 1) + 1;
    setForm({
      id: rule?.id ?? null,
      weekdays: rule?.weekdays ?? [],
      everyNWeeks: String(rule?.everyNWeeks ?? 1),
      anchorDate: rule?.anchorDate ?? today,
      season: Boolean(rule?.seasonFrom),
      from: splitMonthDay(rule?.seasonFrom ?? null, { month: "9", day: "1" }),
      to: splitMonthDay(rule?.seasonTo ?? null, { month: "5", day: "31" }),
      exceptions: rule?.exceptions ?? [],
      exceptionDraft: "",
      lines: rule
        ? rule.lines.map((l, i) => ({
            key: i + 1,
            productId: l.productId,
            quantity: String(l.quantity),
          }))
        : [{ key: 1, productId: products[0]?.id ?? "", quantity: "" }],
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const every = Number(form.everyNWeeks);
    if (form.weekdays.length === 0) return setError("weekdays");
    if (!Number.isInteger(every) || every < 1 || every > MAX_EVERY_N_WEEKS)
      return setError("every");
    if (!parseCalendarDate(form.anchorDate)) return setError("anchor");
    const lines = form.lines.map((l) => ({
      productId: l.productId,
      quantity: parseQuantity(l.quantity),
    }));
    if (lines.length === 0 || lines.some((l) => !l.productId || l.quantity === null)) {
      return setError("lines");
    }
    const monthDay = (v: { month: string; day: string }) => `${pad(v.month)}-${pad(v.day)}`;
    const input = {
      customerId,
      weekdays: form.weekdays,
      everyNWeeks: every,
      anchorDate: form.anchorDate,
      seasonFrom: form.season ? monthDay(form.from) : null,
      seasonTo: form.season ? monthDay(form.to) : null,
      exceptions: form.exceptions,
      lines,
    };
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = form.id
          ? await updateRecurringOrderAction(form.id, input)
          : await createRecurringOrderAction(input);
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        return setError(result.error === "customer_inactive" ? "customerInactive" : "generic");
      }
      toast.success(t("saved", { count: result.generated }));
      setForm(null);
      router.refresh();
    });
  }

  function setActive(rule: RecurringRuleView, next: boolean) {
    startTransition(async () => {
      try {
        const result = await setRecurringOrderActiveAction(rule.id, next);
        if (!result.ok) return void toast.error(tc("errors.generic"));
        toast.success(next ? t("resumed", { count: result.generated }) : t("paused"));
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      router.refresh();
    });
  }

  const stateBadge = (state: RuleState) => (
    <Badge
      variant={state === "active" ? "success" : "secondary"}
      data-testid="recurring-state"
      data-state={state}
    >
      {t(`state.${state}`)}
    </Badge>
  );

  const scheduleText = (rule: RecurringRuleView) =>
    t(rule.everyNWeeks === 1 ? "schedule.weekly" : "schedule.everyN", {
      n: rule.everyNWeeks,
      days: rule.weekdays.map((d) => weekdayName(d)).join(", "),
    });

  const errorText: Record<Exclude<FormError, null>, string> = {
    weekdays: t("errors.weekdays"),
    every: t("errors.every", { max: MAX_EVERY_N_WEEKS }),
    anchor: t("errors.anchor"),
    lines: t("errors.lines"),
    customerInactive: t("errors.customerInactive"),
    generic: t("errors.generic"),
  };

  const update = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const updateLine = (key: number, patch: Partial<FormLine>) =>
    setForm((f) =>
      f ? { ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) } : f,
    );

  const monthDayFields = (
    id: string,
    value: { month: string; day: string },
    onChange: (v: { month: string; day: string }) => void,
  ) => (
    <div className="flex gap-2">
      <select
        id={`${id}-month`}
        aria-label={`${t("form.season")} · ${t("form.month")}`}
        value={value.month}
        onChange={(e) => onChange({ ...value, month: e.target.value })}
        className={selectClass}
        data-testid={`${id}-month`}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i + 1} value={String(i + 1)}>
            {monthName(i + 1)}
          </option>
        ))}
      </select>
      <select
        id={`${id}-day`}
        aria-label={`${t("form.season")} · ${t("form.day")}`}
        value={value.day}
        onChange={(e) => onChange({ ...value, day: e.target.value })}
        className={selectClass}
        data-testid={`${id}-day`}
      >
        {Array.from({ length: 31 }, (_, i) => (
          <option key={i + 1} value={String(i + 1)}>
            {i + 1}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Card data-testid="recurring-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <h2 id="d-recurring" className="flex items-center gap-2 text-lg font-semibold">
          <RepeatIcon className="size-5" aria-hidden />
          {t("heading")}
        </h2>
        <Button
          type="button"
          variant="outline"
          disabled={!customerActive || products.length === 0}
          onClick={() => open(null)}
          data-testid="recurring-new"
        >
          <PlusIcon aria-hidden />
          {t("new")}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!customerActive ? (
          <p className="text-base text-muted-foreground" data-testid="recurring-customer-inactive">
            {t("customerInactive")}
          </p>
        ) : null}
        {rules.length === 0 ? (
          <p className="text-base text-muted-foreground" data-testid="recurring-empty">
            {t("empty")}
          </p>
        ) : (
          <ul className="flex flex-col" aria-labelledby="d-recurring">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-col gap-2 border-b py-3 first:pt-0 last:border-0 last:pb-0"
                data-testid="recurring-rule"
                data-rule-id={rule.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" data-testid="recurring-schedule">
                    {scheduleText(rule)}
                  </span>
                  {stateBadge(rule.state)}
                </div>
                <ul className="flex flex-col gap-0.5 text-base" data-testid="recurring-lines">
                  {rule.lines.map((l) => (
                    <li key={l.id} className="tabular-nums">
                      {fmt.quantity(l.quantity)}{" "}
                      {tu(l.unit as "KG" | "PACK" | "CRATE" | "PIECE", { count: l.quantity })}{" "}
                      {productName(l.productName, locale)}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground">
                  {t("from", { date: dayText(rule.anchorDate) })}
                  {rule.seasonFrom && rule.seasonTo
                    ? ` · ${t("seasonText", {
                        from: monthDayText(rule.seasonFrom),
                        to: monthDayText(rule.seasonTo),
                      })}`
                    : ""}
                  {rule.exceptions.length > 0
                    ? ` · ${t("exceptionsCount", { count: rule.exceptions.length })}`
                    : ""}
                </p>
                {rule.nextDates.length > 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="recurring-next">
                    {t("next", { dates: rule.nextDates.map(dayText).join(", ") })}
                  </p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {t("confirmedBy", {
                    name: rule.confirmedBy ?? "",
                    date: fmt.dateTime(rule.confirmedAt),
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => open(rule)}
                    data-testid="recurring-edit"
                  >
                    <PencilIcon aria-hidden />
                    {tc("actions.edit")}
                  </Button>
                  {rule.state === "active" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => setActive(rule, false)}
                      data-testid="recurring-pause"
                    >
                      <PauseIcon aria-hidden />
                      {t("pause")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending || !customerActive}
                      onClick={() => setActive(rule, true)}
                      data-testid="recurring-resume"
                    >
                      <PlayIcon aria-hidden />
                      {t("resume")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={form !== null} onOpenChange={(isOpen) => !isOpen && setForm(null)}>
        <DialogContent className="sm:max-w-2xl" data-testid="recurring-dialog">
          <DialogHeader>
            <DialogTitle>{form?.id ? t("form.editTitle") : t("form.newTitle")}</DialogTitle>
            <DialogDescription>{t("form.hint")}</DialogDescription>
          </DialogHeader>
          {form ? (
            <form className="flex flex-col gap-5" noValidate onSubmit={submit}>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-base font-medium">{t("form.weekdays")}</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2" data-testid="recurring-weekdays">
                  {ISO_WEEKDAYS.map((day) => (
                    <label key={day} className="flex items-center gap-2 text-base">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                        checked={form.weekdays.includes(day)}
                        onChange={(e) =>
                          update({
                            weekdays: e.target.checked
                              ? [...form.weekdays, day]
                              : form.weekdays.filter((d) => d !== day),
                          })
                        }
                        data-testid={`recurring-weekday-${day}`}
                      />
                      {weekdayName(day)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label={t("form.every")}
                  htmlFor="recurring-every"
                  description={t("form.everyHint")}
                >
                  <Input
                    id="recurring-every"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_EVERY_N_WEEKS}
                    step={1}
                    value={form.everyNWeeks}
                    onChange={(e) => update({ everyNWeeks: e.target.value })}
                    data-testid="recurring-every"
                  />
                </FormField>
                <FormField
                  label={t("form.anchor")}
                  htmlFor="recurring-anchor"
                  description={t("form.anchorHint")}
                >
                  <Input
                    id="recurring-anchor"
                    type="date"
                    value={form.anchorDate}
                    onChange={(e) => update({ anchorDate: e.target.value })}
                    data-testid="recurring-anchor"
                  />
                </FormField>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-base font-medium">{t("form.season")}</legend>
                <label className="flex items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={form.season}
                    onChange={(e) => update({ season: e.target.checked })}
                    data-testid="recurring-season"
                  />
                  {t("form.seasonOnly")}
                </label>
                {form.season ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {monthDayFields("recurring-season-from", form.from, (from) => update({ from }))}
                    <span className="text-base">{t("form.seasonTo")}</span>
                    {monthDayFields("recurring-season-to", form.to, (to) => update({ to }))}
                  </div>
                ) : null}
                <p className="text-sm text-muted-foreground">{t("form.seasonHint")}</p>
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-base font-medium">{t("form.exceptions")}</legend>
                <p className="text-sm text-muted-foreground">{t("form.exceptionsHint")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    aria-label={t("form.exceptions")}
                    value={form.exceptionDraft}
                    onChange={(e) => update({ exceptionDraft: e.target.value })}
                    className="w-auto"
                    data-testid="recurring-exception-input"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!parseCalendarDate(form.exceptionDraft)}
                    onClick={() =>
                      update({
                        exceptions: [...new Set([...form.exceptions, form.exceptionDraft])].sort(),
                        exceptionDraft: "",
                      })
                    }
                    data-testid="recurring-exception-add"
                  >
                    <PlusIcon aria-hidden />
                    {tc("actions.add")}
                  </Button>
                </div>
                {form.exceptions.length > 0 ? (
                  <ul className="flex flex-wrap gap-2" data-testid="recurring-exceptions">
                    {form.exceptions.map((day) => (
                      <li key={day}>
                        <Badge variant="secondary" className="gap-1">
                          {dayText(day)}
                          <button
                            type="button"
                            className="inline-flex size-6 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`${tc("actions.remove")}: ${dayText(day)}`}
                            onClick={() =>
                              update({ exceptions: form.exceptions.filter((d) => d !== day) })
                            }
                          >
                            <XIcon className="size-3.5" aria-hidden />
                          </button>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-base font-medium">{t("form.products")}</legend>
                {form.lines.map((line, index) => (
                  <div
                    key={line.key}
                    className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2"
                    data-testid="recurring-line"
                  >
                    <select
                      aria-label={`${t("form.product")} · ${index + 1}`}
                      value={line.productId}
                      onChange={(e) => updateLine(line.key, { productId: e.target.value })}
                      className={`${selectClass} min-w-0`}
                      data-testid="recurring-line-product"
                    >
                      <option value="">{t("form.productPlaceholder")}</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={`${t("form.quantity")} · ${index + 1}`}
                      placeholder={t("form.quantity")}
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      data-testid="recurring-line-quantity"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={form.lines.length === 1}
                      aria-label={`${tc("actions.remove")}: ${t("form.product")} ${index + 1}`}
                      onClick={() =>
                        update({ lines: form.lines.filter((l) => l.key !== line.key) })
                      }
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      update({
                        lines: [
                          ...form.lines,
                          {
                            key: nextLineKey.current++,
                            productId: "",
                            quantity: "",
                          },
                        ],
                      })
                    }
                    data-testid="recurring-line-add"
                  >
                    <PlusIcon aria-hidden />
                    {t("form.addProduct")}
                  </Button>
                </div>
              </fieldset>

              {form.id ? (
                <p className="text-sm text-muted-foreground">{t("form.editNote")}</p>
              ) : null}
              {error ? (
                <Alert variant="destructive" data-testid="recurring-error" data-code={error}>
                  <AlertDescription>{errorText[error]}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  {tc("actions.cancel")}
                </Button>
                <Button type="submit" disabled={pending} data-testid="recurring-save">
                  {pending ? t("form.saving") : t("form.confirm")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
