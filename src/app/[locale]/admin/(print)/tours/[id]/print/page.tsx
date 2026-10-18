import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { LoadSheet } from "@/components/admin/load-sheet";
import { LoadSheetToolbar } from "@/components/admin/load-sheet-toolbar";
import { LoadingSkeleton } from "@/components/shared/states";
import { type AppLocale, LOCALES } from "@/lib/localized-text";
import { requirePageActor } from "@/server/auth/page-guards";
import { parsePrintLocale } from "@/server/tour-print";
import { tourPrintQuery } from "@/server/tour-queries";

/**
 * Packing list / load sheet (NUD-091): `/admin/tours/[id]/print?locale=…`. `locale` is the language
 * of the printout (product names, labels), independent of the language of the admin UI; anything
 * that is not one of the four app locales falls back to the UI locale.
 */
async function Guarded({
  locale,
  params,
  searchParams,
}: {
  locale: AppLocale;
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageActor("admin", locale);
  const { id } = await params;
  const printLocale = parsePrintLocale((await searchParams).locale, locale);
  const tour = await tourPrintQuery(id);
  if (!tour) notFound();
  const t = await getTranslations({ locale, namespace: "admin.tours.print" });
  return (
    <div className="load-sheet-page min-h-dvh bg-neutral-200 py-4 text-black print:bg-white print:py-0">
      <style>{"@page { size: A4; margin: 12mm; }"}</style>
      <LoadSheetToolbar
        tourId={tour.id}
        date={tour.date}
        printLocale={printLocale}
        isOutdated={tour.isOutdated}
        outdatedText={t("outdatedScreen")}
        backLabel={t("back")}
        printLabel={t("printButton")}
        languageLabel={t("languageLabel")}
      />
      <LoadSheet tour={tour} locale={printLocale} />
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/tours/[id]/print">) {
  const { locale: rawLocale, id } = await params;
  const locale = (LOCALES as readonly string[]).includes(rawLocale)
    ? (rawLocale as AppLocale)
    : "de";
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} params={Promise.resolve({ id })} searchParams={searchParams} />
    </Suspense>
  );
}
