"use client";

import { PauseIcon, PencilIcon, PlayIcon, PlusIcon, RepeatIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  newRuleDraft,
  type RecurringRuleDraft,
  RecurringRuleForm,
  ruleDraftFromView,
  type RuleFormError,
  ruleInputFromDraft,
  useRuleErrorText,
} from "@/components/admin/recurring-rule-form";
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
import { parseCalendarDate } from "@/domain/order";
import { type RuleState } from "@/domain/recurring-order";
import { useRouter } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import {
  createRecurringOrderAction,
  setRecurringOrderActiveAction,
  updateRecurringOrderAction,
} from "@/server/recurring-actions";
import type { RecurringRuleView } from "@/server/recurring-orders";

import { monthlyRuleText } from "./recurring-rule-form";

export type RecurringProductChoice = {
  id: string;
  label: string;
  unit: "KG" | "PACK" | "CRATE" | "PIECE";
};

type FormError = RuleFormError | "customerInactive" | "generic" | null;

function productName(name: unknown, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return parsed.success ? pick(parsed.data, locale) : "";
}

/**
 * Recurring orders of a customer (NUD-149, D25): the office confirms a rule once ("every Monday
 * and Thursday", "every second week from September to May"), the daily job then creates the
 * orders. Rules are paused, never deleted. Orders created earlier are not touched by an edit.
 *
 * The rule form is the shared `RecurringRuleForm` (NUD-171), the same component the order form's
 * dialog uses; here the office edits the base product list of the rule as well.
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
  const tr = useTranslations("admin.recurringRule");
  const tc = useTranslations("common");
  const tu = useTranslations("driver.units");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());
  const errorText = useRuleErrorText();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<RecurringRuleDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<FormError>(null);

  const weekdayName = (day: number, style: "long" | "short" = "long") =>
    new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 0, 4 + day)), // 2026-01-05 is a Monday
    );
  const monthDayText = (value: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(2001, Number(value.slice(0, 2)) - 1, Number(value.slice(3, 5)))),
    );
  const dayText = (value: string) => fmt.calendarDate(parseCalendarDate(value) ?? new Date(0));

  function open(rule: RecurringRuleView | null) {
    setError(null);
    setEditingId(rule?.id ?? null);
    setDraft(
      rule
        ? ruleDraftFromView(rule)
        : newRuleDraft({
            startDate: today,
            lines: [{ productId: products[0]?.id ?? "", quantity: "" }],
          }),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const built = ruleInputFromDraft(draft, { customerId });
    if (!built.ok) return setError(built.error);
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = editingId
          ? await updateRecurringOrderAction(editingId, built.input)
          : await createRecurringOrderAction(built.input);
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        return setError(result.error === "customer_inactive" ? "customerInactive" : "generic");
      }
      toast.success(t("saved", { count: result.generated }));
      setDraft(null);
      setEditingId(null);
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

  /** The monthly building blocks of a stored rule, localized (e.g. "jeder 1. Montag"). */
  const monthlyText = (rule: RecurringRuleView) =>
    rule.monthlyRules
      .map((monthly) =>
        monthlyRuleText(
          monthly,
          (key, values) => tr(`monthly.${key}`, values),
          (day) => weekdayName(day),
        ),
      )
      .join(", ");

  /** Weekdays that have their own product rows (NUD-171). */
  const ownDayText = (rule: RecurringRuleView) =>
    [...new Set(rule.dayItems.map((item) => item.weekday))]
      .sort((a, b) => a - b)
      .map((day) => weekdayName(day))
      .join(", ");

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
                    {rule.weekdays.length > 0 ? scheduleText(rule) : monthlyText(rule)}
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
                {rule.monthlyRules.length > 0 && rule.weekdays.length > 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="recurring-monthly">
                    {t("summary.monthly", { rules: monthlyText(rule) })}
                  </p>
                ) : null}
                {rule.windowFromTime && rule.windowToTime ? (
                  <p className="text-sm text-muted-foreground" data-testid="recurring-window">
                    {t("summary.window", {
                      from: rule.windowFromTime,
                      to: rule.windowToTime,
                    })}
                  </p>
                ) : null}
                {rule.endsOn || rule.maxDeliveries !== null ? (
                  <p className="text-sm text-muted-foreground" data-testid="recurring-end">
                    {[
                      rule.endsOn ? t("summary.endDate", { date: dayText(rule.endsOn) }) : null,
                      rule.maxDeliveries !== null
                        ? t("summary.endCount", { count: rule.maxDeliveries })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {rule.skipFrom && rule.skipTo ? (
                  <p className="text-sm text-muted-foreground" data-testid="recurring-skip">
                    {t("summary.skip", {
                      from: dayText(rule.skipFrom),
                      to: dayText(rule.skipTo),
                    })}
                  </p>
                ) : null}
                {rule.dayItems.length > 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="recurring-day-items">
                    {t("summary.dayItems", { days: ownDayText(rule) })}
                  </p>
                ) : null}
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

      <Dialog
        open={draft !== null}
        onOpenChange={(isOpen) => {
          if (isOpen) return;
          setDraft(null);
          setEditingId(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl" data-testid="recurring-dialog">
          <DialogHeader>
            <DialogTitle>{editingId ? t("form.editTitle") : t("form.newTitle")}</DialogTitle>
            <DialogDescription>{t("form.hint")}</DialogDescription>
          </DialogHeader>
          {draft ? (
            <form className="flex flex-col gap-5" noValidate onSubmit={submit}>
              <RecurringRuleForm
                key={editingId ?? "new"}
                draft={draft}
                onChange={(patch) =>
                  setDraft((current) => (current ? { ...current, ...patch } : current))
                }
                products={products}
                prefix="recurring"
                startOn={today}
              />

              {editingId ? (
                <p className="text-sm text-muted-foreground">{t("form.editNote")}</p>
              ) : null}
              {error ? (
                <Alert variant="destructive" data-testid="recurring-error" data-code={error}>
                  <AlertDescription>{errorText(error)}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
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
