"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import { usePathname, useRouter } from "@/i18n/navigation";

/** The calendar day `delta` days away from the `YYYY-MM-DD` value (unchanged for invalid input). */
function shiftDay(value: string, delta: number): string {
  const date = parseCalendarDate(value);
  if (!date) return value;
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + delta);
  return formatCalendarDate(next);
}

/**
 * Delivery date of the planning page (re-design.md §8.4) as a **date stepper**: ‹ date › plus the
 * native calendar of the date field. The office steps through days one at a time; the date itself
 * stays in the URL (`?date=YYYY-MM-DD`) and every step is a plain navigation — no fetching changes.
 */
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

  function go(next: string) {
    if (!parseCalendarDate(next) || next === value) return;
    setLocal(next);
    startTransition(() => router.replace({ pathname, query: { date: next } }));
  }

  return (
    <TooltipProvider>
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label={t("date")}
        data-testid="tour-date-stepper"
        aria-busy={pending}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("datePrev")}
              disabled={pending}
              data-testid="tour-date-prev"
              onClick={() => go(shiftDay(local, -1))}
            >
              <ChevronLeftIcon aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("datePrev")}</TooltipContent>
        </Tooltip>

        <label htmlFor="tour-date" className="sr-only">
          {t("date")}
        </label>
        <Input
          id="tour-date"
          type="date"
          value={local}
          disabled={pending}
          className="w-44"
          data-testid="tour-date"
          onChange={(e) => go(e.target.value)}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("dateNext")}
              disabled={pending}
              data-testid="tour-date-next"
              onClick={() => go(shiftDay(local, 1))}
            >
              <ChevronRightIcon aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("dateNext")}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
