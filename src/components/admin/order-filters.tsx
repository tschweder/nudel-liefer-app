"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  ORDER_SOURCES,
  ORDER_STATUSES,
  type OrderFilters as Filters,
  orderFiltersToQuery,
  type OrderSourceValue,
  type OrderStatusValue,
} from "@/domain/order-overview";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { FilterCustomer } from "@/server/orders";

const selectClass = "h-10 rounded-md border border-input bg-background px-3 text-base";

/**
 * Filters of the order overview: date range, customer, status, source. The state lives in the
 * URL (so views can be bookmarked); every change replaces it. The controls follow the user at
 * once (local copy) and are re-synced when the URL changes by itself (e.g. "reset", back button).
 */
export function OrderFilters({
  filters: applied,
  customers,
}: {
  filters: Filters;
  customers: FilterCustomer[];
}) {
  const t = useTranslations("admin.orders.filters");
  const tc = useTranslations("common");
  const to = useTranslations("admin.orders");
  const router = useRouter();
  const pathname = usePathname();
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

  return (
    <form
      role="search"
      aria-label={t("heading")}
      aria-busy={pending}
      className="flex flex-wrap items-end gap-x-4 gap-y-3"
      onSubmit={(e) => e.preventDefault()}
      data-testid="order-filters"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-from" className="text-sm font-medium">
          {t("from")}
        </label>
        <Input
          id="filter-from"
          type="date"
          value={filters.from}
          onChange={(e) => {
            const from = e.target.value;
            if (!from) return;
            push({ ...filters, from, to: filters.to < from ? from : filters.to });
          }}
          className="w-44"
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
          className="w-44"
          data-testid="filter-to"
        />
      </div>
      <div className="flex min-w-64 flex-1 flex-col gap-1 sm:max-w-sm">
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
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-status" className="text-sm font-medium">
          {t("status")}
        </label>
        <select
          id="filter-status"
          className={selectClass}
          value={filters.status ?? ""}
          onChange={(e) =>
            push({ ...filters, status: (e.target.value || null) as OrderStatusValue | null })
          }
          data-testid="filter-status"
        >
          <option value="">{t("statusAll")}</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tc(`statuses.order.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-source" className="text-sm font-medium">
          {t("source")}
        </label>
        <select
          id="filter-source"
          className={selectClass}
          value={filters.source ?? ""}
          onChange={(e) =>
            push({ ...filters, source: (e.target.value || null) as OrderSourceValue | null })
          }
          data-testid="filter-source"
        >
          <option value="">{t("sourceAll")}</option>
          {ORDER_SOURCES.map((s) => (
            <option key={s} value={s}>
              {to(`source.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="h-10 text-base text-primary underline-offset-4 hover:underline"
        onClick={() => startTransition(() => router.replace(pathname))}
        data-testid="filter-reset"
      >
        {t("reset")}
      </button>
    </form>
  );
}
