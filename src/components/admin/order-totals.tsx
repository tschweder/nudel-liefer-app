import { useFormatter, useLocale, useTranslations } from "next-intl";

import { parseCalendarDate } from "@/domain/order";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { DateTotalsView } from "@/server/orders";

function productName(name: unknown, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return parsed.success ? pick(parsed.data, locale) : "";
}

/** Sum per product for each delivery date of the selected range (production / loading). */
export function OrderTotals({ totals }: { totals: DateTotalsView[] }) {
  const t = useTranslations("admin.orders.totals");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());

  return (
    <section className="flex flex-col gap-3" aria-labelledby="totals-heading" data-testid="totals">
      <div className="flex flex-col gap-1">
        <h2 id="totals-heading" className="text-xl font-semibold">
          {t("heading")}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {totals.length === 0 ? (
        <p className="text-base text-muted-foreground" data-testid="totals-empty">
          {t("empty")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {totals.map((day) => {
            const date = parseCalendarDate(day.date);
            return (
              <div
                key={day.date}
                className="rounded-lg border bg-card p-4"
                data-testid="totals-day"
                data-date={day.date}
              >
                <h3 className="mb-2 text-base font-semibold">
                  {t("dateHeading", {
                    date: date ? fmt.calendarDate(date) : day.date,
                    count: day.orderCount,
                  })}
                </h3>
                <table className="w-full text-base">
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">{t("product")}</th>
                      <th scope="col">{t("quantity")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.products.map((p) => (
                      <tr key={p.productId} data-testid="totals-product">
                        <td className="py-0.5 pr-3">{productName(p.productName, locale)}</td>
                        <td className="py-0.5 text-right font-semibold whitespace-nowrap">
                          {fmt.quantity(p.quantity)}{" "}
                          {tc(`units.${p.unit as "KG" | "PACK" | "CRATE" | "PIECE"}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
