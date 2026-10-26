"use client";

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComboboxOption = { value: string; label: string; keywords?: string[] };

type ComboboxProps = {
  options: ComboboxOption[];
  value?: string;
  onChange: (value: string | undefined) => void;
  /** All visible texts are passed in already translated. */
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** `lg` is the 48 px driver height; the default 40 px is the admin height. */
  size?: "sm" | "md" | "lg";
  /** Accessible name when no external `<Label htmlFor>` points at the trigger. */
  "aria-label"?: string;
};

/**
 * Searchable single-select (popover + command) — the native-`<select>` replacement for customer
 * filters and pickers (re-design.md §5). The trigger is a real button (`role="combobox"`); its
 * accessible name comes from `aria-label` or an external label pointing at `id`.
 */
function Combobox({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  className,
  id,
  size = "md",
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          size={size === "lg" ? "lg" : size === "sm" ? "sm" : "default"}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-70" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  keywords={option.keywords}
                  onSelect={() => {
                    onChange(option.value === value ? undefined : option.value);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn("size-4", option.value === value ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
