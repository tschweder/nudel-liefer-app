"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { parseCalendarDate } from "@/domain/order";
import { usePathname, useRouter } from "@/i18n/navigation";

/** Delivery date of the planning page; the date lives in the URL (`?date=YYYY-MM-DD`). */
export function TourDateField({ value }: { value: string }) {
  const t = useTranslations("admin.tours");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setLocal(value);
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="tour-date" className="text-sm font-medium">
        {t("date")}
      </label>
      <Input
        id="tour-date"
        type="date"
        value={local}
        aria-busy={pending}
        className="w-44"
        data-testid="tour-date"
        onChange={(e) => {
          const next = e.target.value;
          setLocal(next);
          if (!parseCalendarDate(next)) return;
          startTransition(() => router.replace({ pathname, query: { date: next } }));
        }}
      />
    </div>
  );
}
