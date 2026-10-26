"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import {
  ORDER_SOURCES,
  ORDER_STATUSES,
  type OrderFilters as Filters,
  orderFiltersToQuery,
  type OrderSourceValue,
  type OrderStatusValue,
} from "@/domain/order-overview";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { FilterCustomer } from "@/server/orders";

const DAY_MS = 86_400_000;
/** Value of the "all" chip; `SegmentedControl` never reports an empty value. */
const ALL = "ALL";

type QuickPick = "next" | "today" | "week" | "custom";

/** Monday–Sunday of the calendar week that contains `day` (`YYYY-MM-DD`, UTC midnight). */
function weekRange(day: string): { from: string; to: string } {
  const date = parseCalendarDate(day) ?? new Date();
  const offset = (date.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(date.getTime() - offset * DAY_MS);
  return {
    from: formatCalendarDate(start),
    to: formatCalendarDate(new Date(start.getTime() + 6 * DAY_MS)),
  };
}

/**
 * Toolbar of the order overview (re-design.md §8.3/§14.3). The state lives in the URL (so views can
 * be bookmarked); every change replaces it. The controls follow the user at once (local copy) and
 * are re-synced when the URL changes by itself (e.g. "reset", back button).
 *
 * Date quick picks are a `SegmentedControl` (next delivery day / today / this week / custom); the
 * Von/Bis inputs only appear for "Benutzerdefiniert" (re-design.md §8.3: "reveals Von/Bis") — they
 * stay mounted otherwise, so a hidden input still carries the range the URL and the specs read.
 * Status and Quelle are single-select chip groups — `OrderFilters` only knows one value each, so the
 * semantics stay exactly as before (`from`, `to`, `customer`, `status`, `source`).
 */
export function OrderFilters({
  filters: applied,
  customers,
  defaultDate,
  today,
}: {
  filters: Filters;
  customers: FilterCustomer[];
  /** Next delivery day (`YYYY-MM-DD`) — the range the page shows without any URL parameters. */
  defaultDate: string;
  /** Today in the factory time zone (`YYYY-MM-DD`), used by the "Heute" quick pick. */
  today: string;
}) {
  const t = useTranslations("admin.orders.filters");
  const tc = useTranslations("common");
  const to = useTranslations("admin.orders");
  const router = useRouter();
  const pathname = usePathname();
  const fromInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState(applied);
  const [seen, setSeen] = useState(applied);
  if (JSON.stringify(seen) !== JSON.stringify(applied)) {
    setSeen(applied);
    setFilters(applied);
  }

  const push = (next: Filters) => {
    setFilters(next);
    startTransition(() => {
      router.replace({ pathname, query: orderFiltersToQuery(next) });
    });
  };

  const week = weekRange(today);
  const singleDay = filters.from === filters.to;
  const urlQuick: QuickPick =
    singleDay && filters.from === defaultDate
      ? "next"
      : singleDay && filters.from === today
        ? "today"
        : filters.from === week.from && filters.to === week.to
          ? "week"
          : "custom";
  // "Benutzerdefiniert" is a mode, not a range: the URL cannot express "custom but unchanged", so
  // it lives next to the URL state and is re-synced when the URL changes by itself (reset, back).
  const [customOpen, setCustomOpen] = useState(urlQuick === "custom");
  const [seenQuick, setSeenQuick] = useState(urlQuick);
  if (seenQuick !== urlQuick) {
    setSeenQuick(urlQuick);
    setCustomOpen(urlQuick === "custom");
  }
  const quick: QuickPick = customOpen || urlQuick === "custom" ? "custom" : urlQuick;

  const setQuick = (next: string) => {
    if (next === "next") push({ ...filters, from: defaultDate, to: defaultDate });
    else if (next === "today") push({ ...filters, from: today, to: today });
    else if (next === "week") push({ ...filters, from: week.from, to: week.to });
    // "Benutzerdefiniert" does not change the range, it reveals the range inputs and points at them.
    else {
      setCustomOpen(true);
      fromInput.current?.focus();
    }
  };

  return (
    <form
      role="search"
      aria-label={t("heading")}
      aria-busy={pending}
      className="flex w-full flex-col gap-3"
      onSubmit={(e) => e.preventDefault()}
      data-testid="order-filters"
    >
      {/* Two rows: range + customer, then the status/source chips. Labels stay visible because the
          toolbar sticks and the chips alone do not say what they filter. */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex min-w-0 max-w-full flex-col gap-1">
          <span className="text-sm font-medium">{t("rangeLabel")}</span>
          <SegmentedControl
            value={quick}
            onValueChange={setQuick}
            ariaLabel={t("rangeLabel")}
            size="md"
            className="w-auto max-w-full shrink-0 overflow-x-auto [&_button]:flex-none"
            options={[
              { value: "next", label: t("quick.next"), testId: "quick-next" },
              { value: "today", label: t("quick.today"), testId: "quick-today" },
              { value: "week", label: t("quick.week"), testId: "quick-week" },
              { value: "custom", label: t("quick.custom"), testId: "quick-custom" },
            ]}
          />
        </div>

        {/* Von/Bis belong to "Benutzerdefiniert" (§8.3). They stay in the DOM while hidden so the
            range the URL carries is still readable (and the specs keep their `filter-from`/`to`). */}
        <div
          className={cn("flex flex-wrap items-end gap-x-4 gap-y-3", quick !== "custom" && "hidden")}
          data-testid="filter-range"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-from" className="text-sm font-medium">
              {t("from")}
            </label>
            <Input
              ref={fromInput}
              id="filter-from"
              type="date"
              value={filters.from}
              onChange={(e) => {
                const from = e.target.value;
                if (!from) return;
                push({ ...filters, from, to: filters.to < from ? from : filters.to });
              }}
              className="w-40"
              data-testid="filter-from"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-to" className="text-sm font-medium">
              {t("to")}
            </label>
            <Input
              id="filter-to"
              type="date"
              value={filters.to}
              onChange={(e) => {
                const to = e.target.value;
                if (!to) return;
                push({ ...filters, to, from: filters.from > to ? to : filters.from });
              }}
              className="w-40"
              data-testid="filter-to"
            />
          </div>
        </div>

        <div className="flex min-w-56 flex-1 flex-col gap-1 sm:max-w-sm">
          <label htmlFor="filter-customer" className="text-sm font-medium">
            {t("customer")}
          </label>
          <Combobox
            id="filter-customer"
            options={customers.map((c) => ({
              value: c.id,
              label: `${c.customerNumber} · ${c.name}, ${c.city}`,
              keywords: [c.customerNumber, c.name, c.city],
            }))}
            value={filters.customerId ?? undefined}
            onChange={(customerId) => push({ ...filters, customerId: customerId ?? null })}
            placeholder={t("customerAll")}
            searchPlaceholder={t("customerSearch")}
            emptyText={t("customerEmpty")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1" data-testid="filter-status">
          <span className="text-sm font-medium">{t("status")}</span>
          <SegmentedControl
            value={filters.status ?? ALL}
            onValueChange={(next) =>
              push({ ...filters, status: (next === ALL ? null : next) as OrderStatusValue | null })
            }
            ariaLabel={t("statusLabel")}
            size="md"
            className="w-auto shrink-0 [&_button]:flex-none"
            options={[
              { value: ALL, label: t("all"), testId: "filter-status-ALL" },
              ...ORDER_STATUSES.map((status) => ({
                value: status,
                label: tc(`statuses.order.${status}`),
                testId: `filter-status-${status}`,
              })),
            ]}
          />
        </div>

        <div className="flex flex-col gap-1" data-testid="filter-source">
          <span className="text-sm font-medium">{t("source")}</span>
          <SegmentedControl
            value={filters.source ?? ALL}
            onValueChange={(next) =>
              push({ ...filters, source: (next === ALL ? null : next) as OrderSourceValue | null })
            }
            ariaLabel={t("sourceLabel")}
            size="md"
            className="w-auto shrink-0 [&_button]:flex-none"
            options={[
              { value: ALL, label: t("all"), testId: "filter-source-ALL" },
              ...ORDER_SOURCES.map((source) => ({
                value: source,
                label: to(`source.${source}`),
                testId: `filter-source-${source}`,
              })),
            ]}
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          className="mb-0.5"
          onClick={() => startTransition(() => router.replace(pathname))}
          data-testid="filter-reset"
        >
          {t("reset")}
        </Button>
      </div>
    </form>
  );
}
