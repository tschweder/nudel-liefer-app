"use client";

import { CalendarIcon } from "lucide-react";
import { useLocale } from "next-intl";
import * as React from "react";
import type { Locale as DayPickerLocale } from "react-day-picker";
import { cs, de, enGB, srLatn, zhCN } from "react-day-picker/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** react-day-picker locale per UI locale (shared with other calendars, e.g. the rule form). */
export const DAY_PICKER_LOCALES: Record<string, DayPickerLocale> = {
  de,
  en: enGB,
  "sr-Latn": srLatn,
  cs,
  "zh-Hans": zhCN,
};

type DatePickerProps = {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  /** Text shown when no date is selected (pass a translated string). */
  placeholder: string;
  /** Formats the selected date for the button label (use the next-intl formatter). */
  formatDate: (date: Date) => string;
  disabled?: boolean;
  className?: string;
  id?: string;
};

/** Date picker = popover + calendar. Dates are plain calendar days (local noon-free `Date`). */
function DatePicker({
  value,
  onChange,
  placeholder,
  formatDate,
  disabled,
  className,
  id,
}: DatePickerProps) {
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start font-normal data-[empty=true]:text-muted-foreground",
            className,
          )}
          data-empty={!value}
        >
          <CalendarIcon aria-hidden />
          {value ? formatDate(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          defaultMonth={value}
          locale={DAY_PICKER_LOCALES[locale] ?? de}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
