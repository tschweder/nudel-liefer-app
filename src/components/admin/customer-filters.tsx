"use client";

import { SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { usePathname, useRouter } from "@/i18n/navigation";
import { customerListQuery } from "@/lib/customer-list-params";

export type CustomerFilterValues = {
  q: string;
  status: "active" | "archived" | "all";
  photosMissing: boolean;
  pinUnconfirmed: boolean;
};

const DEBOUNCE_MS = 200;

/** Search box + filters. The state lives in the URL; typing updates it after a short pause. */
export function CustomerFilters({ values }: { values: CustomerFilterValues }) {
  const t = useTranslations("admin.customers");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // The URL (props) is the source of truth, but the controls follow the user at once instead of
  // waiting for the server round trip: local copy, re-synced when the URL changes by itself
  // (e.g. "reset filters"). While typing, `q` is only taken from the URL when it was cleared.
  const [local, setLocal] = useState(values);
  const [seen, setSeen] = useState(values);
  if (
    seen.status !== values.status ||
    seen.photosMissing !== values.photosMissing ||
    seen.pinUnconfirmed !== values.pinUnconfirmed ||
    seen.q !== values.q
  ) {
    setSeen(values);
    setLocal({ ...values, q: values.q === "" ? "" : local.q });
  }
  const q = local.q;
  const setQ = (next: string) => setLocal((l) => ({ ...l, q: next }));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const push = (next: CustomerFilterValues) => {
    clearTimeout(timer.current);
    setLocal(next);
    startTransition(() => {
      router.replace({ pathname, query: customerListQuery({ ...next, page: 1 }) });
    });
  };

  return (
    <form
      role="search"
      className="flex flex-wrap items-end gap-x-6 gap-y-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        push({ ...local, q });
      }}
    >
      <div className="flex min-w-64 flex-1 flex-col gap-1">
        <label htmlFor="customer-search" className="text-sm font-medium">
          {t("search.label")}
        </label>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="customer-search"
            type="search"
            className="pl-9"
            value={q}
            placeholder={t("search.placeholder")}
            autoComplete="off"
            data-testid="customer-search"
            onChange={(e) => {
              const next = e.target.value;
              setQ(next);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => push({ ...local, q: next }), DEBOUNCE_MS);
            }}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 pb-2 text-base">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={local.photosMissing}
          onChange={(e) => push({ ...local, photosMissing: e.target.checked })}
          data-testid="filter-photos-missing"
        />
        {t("filters.photosMissing")}
      </label>
      <label className="flex items-center gap-2 pb-2 text-base">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={local.pinUnconfirmed}
          onChange={(e) => push({ ...local, pinUnconfirmed: e.target.checked })}
          data-testid="filter-pin-unconfirmed"
        />
        {t("filters.pinUnconfirmed")}
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="customer-status" className="text-sm font-medium">
          {t("filters.status")}
        </label>
        <select
          id="customer-status"
          className="h-10 rounded-md border border-input bg-background px-3 text-base"
          value={local.status}
          onChange={(e) =>
            push({ ...local, status: e.target.value as CustomerFilterValues["status"] })
          }
          data-testid="filter-status"
        >
          <option value="active">{t("filters.statusActive")}</option>
          <option value="archived">{t("filters.statusArchived")}</option>
          <option value="all">{t("filters.statusAll")}</option>
        </select>
      </div>
    </form>
  );
}
