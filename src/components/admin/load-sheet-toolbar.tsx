"use client";

import { ArrowLeftIcon, PrinterIcon, TriangleAlertIcon } from "lucide-react";
import { useLocale } from "next-intl";

import { Button } from "@/components/ui/button";
import { LOCALE_LABELS } from "@/lib/locale-resolution";
import { type AppLocale, LOCALES } from "@/lib/localized-text";

/**
 * Screen-only controls of the load sheet (hidden when printing): back to the tour, language of the
 * printout (own-script labels, a plain link so the URL is shareable) and the Print button.
 */
export function LoadSheetToolbar({
  tourId,
  date,
  printLocale,
  isOutdated,
  outdatedText,
  backLabel,
  printLabel,
  languageLabel,
}: {
  tourId: string;
  date: string;
  printLocale: AppLocale;
  isOutdated: boolean;
  outdatedText: string;
  backLabel: string;
  printLabel: string;
  languageLabel: string;
}) {
  const uiLocale = useLocale();
  return (
    <div
      className="no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-col gap-3 px-4 print:hidden"
      data-testid="load-sheet-toolbar"
    >
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-3 shadow">
        <Button asChild variant="outline">
          <a href={`/${uiLocale}/admin/tours?date=${date}`} data-testid="load-sheet-back">
            <ArrowLeftIcon aria-hidden />
            {backLabel}
          </a>
        </Button>
        <nav aria-label={languageLabel} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{languageLabel}</span>
          {LOCALES.map((l) => (
            <a
              key={l}
              href={`/${uiLocale}/admin/tours/${encodeURIComponent(tourId)}/print?locale=${l}`}
              lang={l}
              aria-current={l === printLocale ? "true" : undefined}
              data-testid={`load-sheet-locale-${l}`}
              className={
                l === printLocale
                  ? "inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                  : "inline-flex min-h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent"
              }
            >
              {LOCALE_LABELS[l]}
            </a>
          ))}
        </nav>
        <Button
          type="button"
          className="ms-auto"
          onClick={() => window.print()}
          data-testid="load-sheet-print"
        >
          <PrinterIcon aria-hidden />
          {printLabel}
        </Button>
      </div>
      {isOutdated ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border-2 border-red-700 bg-red-50 p-3 text-base font-medium text-red-900"
          data-testid="load-sheet-outdated-screen"
        >
          <TriangleAlertIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          {outdatedText}
        </p>
      ) : null}
    </div>
  );
}
