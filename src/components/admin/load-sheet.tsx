import { getFormatter, getTranslations } from "next-intl/server";

import { loadOrder, loadSheetTotals } from "@/domain/load-sheet";
import { type AppLocale } from "@/lib/localized-text";
import { productLabel } from "@/lib/product-label";
import type { TourPrint } from "@/server/tour-print";

const UNITS = ["KG", "PACK", "CRATE", "PIECE"] as const;
type UnitKey = (typeof UNITS)[number];
const isUnit = (u: string): u is UnitKey => (UNITS as readonly string[]).includes(u);

/**
 * The printable packing list / load sheet (NUD-091), rendered in the language of the printout
 * (`locale`). Section 1: total per product (and unit, never mixed). Section 2: per stop in load
 * order (last stop first). The quantities are the tour's own (`Stop.items`).
 */
export async function LoadSheet({ tour, locale }: { tour: TourPrint; locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.tours.print" });
  // Plural unit labels ("15 Packungen", "12 Kisten") live once, under `driver.units` (§9.3) —
  // a printed load sheet must not say "15 Packung".
  const tu = await getTranslations({ locale, namespace: "driver.units" });
  const format = await getFormatter({ locale });

  const quantity = (value: number) => format.number(value, { maximumFractionDigits: 0 });
  const unitText = (unit: string, count: number) =>
    isUnit(unit) ? tu(unit as "KG" | "PACK" | "CRATE" | "PIECE", { count }) : "";
  const products = new Map(tour.products.map((p) => [p.id, p]));
  const label = (productId: string) => {
    const p = products.get(productId);
    return productLabel(p?.name ?? null, p?.sku ?? "?", locale);
  };

  const totals = loadSheetTotals(tour.stops, tour.products);
  const stops = loadOrder(tour.stops);
  const dateText = format.dateTime(new Date(`${tour.date}T00:00:00Z`), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const released = tour.status !== "DRAFT" && tour.status !== "OPTIMIZED";

  const renderName = (productId: string) => {
    const l = label(productId);
    return (
      <>
        <span className="font-semibold">{l.primary}</span>
        {l.german ? <span className="block text-[0.85em] text-neutral-700">{l.german}</span> : null}
      </>
    );
  };

  return (
    <article
      lang={locale}
      className="load-sheet mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-[10.5pt] leading-snug text-black shadow print:max-w-none print:p-0 print:shadow-none"
      data-testid="load-sheet"
      data-locale={locale}
    >
      <header className="mb-4 border-b-2 border-black pb-3">
        <h1 className="text-2xl font-bold" data-testid="load-sheet-title">
          {t("title")}
        </h1>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          <dt className="font-semibold">{t("date")}</dt>
          <dd data-testid="load-sheet-date">{dateText}</dd>
          <dt className="font-semibold">{t("driver")}</dt>
          <dd data-testid="load-sheet-driver">{tour.driverName ?? t("driverNone")}</dd>
          <dt className="font-semibold">{t("depot")}</dt>
          <dd data-testid="load-sheet-depot">
            {tour.depot ? `${tour.depot.name}, ${tour.depot.address}` : "–"}
          </dd>
          <dt className="font-semibold">{t("stops")}</dt>
          <dd data-testid="load-sheet-stop-count">
            {tour.stops.length}
            {released
              ? ` · ${t("version", { revision: tour.releaseRevision })}`
              : ` · ${t("notReleased")}`}
          </dd>
        </dl>
        {tour.isOutdated ? (
          <p
            role="alert"
            className="mt-3 border-4 border-black bg-white p-2 text-base font-bold"
            data-testid="load-sheet-outdated"
          >
            {t("outdated")}
          </p>
        ) : null}
      </header>

      {tour.stops.length === 0 ? (
        <p className="py-6 text-center" data-testid="load-sheet-empty">
          {t("empty")}
        </p>
      ) : (
        <>
          <section className="mb-6" data-testid="load-sheet-totals">
            <h2 className="mb-1 text-lg font-bold">{t("totalsHeading")}</h2>
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr className="border-y-2 border-black text-start">
                  <th scope="col" className="w-[70%] py-1 pe-2 text-start">
                    {t("product")}
                  </th>
                  <th scope="col" className="w-[30%] py-1 text-end">
                    {t("quantity")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {totals.map((row) => (
                  <tr
                    key={`${row.productId}-${row.unit}`}
                    className="border-b border-neutral-400"
                    data-testid="load-sheet-total-row"
                    data-product-id={row.productId}
                  >
                    <td className="break-words py-1 pe-2">{renderName(row.productId)}</td>
                    <td className="py-1 text-end text-lg font-bold whitespace-nowrap">
                      <span data-testid="load-sheet-total-qty">{quantity(row.quantity)}</span>{" "}
                      <span className="text-[0.85em] font-semibold">
                        {unitText(row.unit, row.quantity)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section data-testid="load-sheet-stops">
            <h2 className="text-lg font-bold">{t("stopsHeading")}</h2>
            <p className="mb-1 text-[0.9em] text-neutral-700">{t("stopsHint")}</p>
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr className="border-y-2 border-black">
                  <th scope="col" className="w-[9%] py-1 pe-1 text-start">
                    {t("loadPosition")}
                  </th>
                  <th scope="col" className="w-[9%] py-1 pe-1 text-start">
                    {t("stop")}
                  </th>
                  <th scope="col" className="w-[34%] py-1 pe-2 text-start">
                    {t("customer")}
                  </th>
                  <th scope="col" className="w-[48%] py-1 text-start">
                    {t("items")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stops.map((stop) => (
                  <tr
                    key={stop.id}
                    className="border-b border-neutral-500 align-top"
                    data-testid="load-sheet-stop-row"
                    data-sequence={stop.sequence}
                  >
                    <td className="py-1.5 pe-1 text-lg font-bold">{stop.loadPosition}</td>
                    <td className="py-1.5 pe-1 text-lg font-bold" data-testid="load-sheet-stop-seq">
                      {stop.sequence}
                    </td>
                    <td className="break-words py-1.5 pe-2">
                      <span className="font-semibold">{stop.name}</span>
                      <span className="block text-[0.85em] text-neutral-700">
                        {stop.customerNumber} · {stop.street}, {stop.postalCode} {stop.city}
                      </span>
                    </td>
                    <td className="py-1.5">
                      {stop.items.length === 0 ? (
                        <span className="text-neutral-700">{t("noItems")}</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {stop.items.map((item) => {
                            const unit = products.get(item.productId)?.unit ?? "";
                            return (
                              <li
                                key={item.productId}
                                className="flex items-baseline justify-between gap-2"
                                data-testid="load-sheet-item"
                              >
                                <span className="min-w-0 break-words">
                                  {renderName(item.productId)}
                                </span>
                                <span className="shrink-0 font-bold whitespace-nowrap">
                                  {quantity(item.quantity)}{" "}
                                  <span className="text-[0.85em] font-semibold">
                                    {unitText(unit, item.quantity)}
                                  </span>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </article>
  );
}
