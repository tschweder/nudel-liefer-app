"use client";

import { LanguagesIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { LOCALE_LABELS } from "@/lib/locale-resolution";
import { LOCALES } from "@/lib/localized-text";
import { chooseDriverLocaleAction } from "@/server/driver-locale-actions";

/** Full-screen first-start picker: four big buttons, each in its own script, no other text. */
export function DriverLanguagePicker() {
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-4"
      data-testid="language-picker"
    >
      <LanguagesIcon className="mx-auto mb-2 size-14" aria-hidden />
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          disabled={pending}
          aria-busy={pending && chosen === code}
          data-testid={`pick-${code}`}
          className="min-h-24 rounded-xl border-2 border-foreground bg-background px-4 text-3xl font-semibold hover:bg-muted focus-visible:ring-4 focus-visible:ring-ring disabled:opacity-60"
          onClick={() => {
            setChosen(code);
            startTransition(async () => {
              await chooseDriverLocaleAction(code);
            });
          }}
        >
          {LOCALE_LABELS[code]}
        </button>
      ))}
    </main>
  );
}
