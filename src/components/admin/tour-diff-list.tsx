"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";

import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { DiffStopView, TourDiffView } from "@/server/tour-rerelease";

function productName(name: unknown, sku: string, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return (parsed.success ? pick(parsed.data, locale) : "") || sku;
}

/**
 * The difference between a released tour and the confirmed orders now (NUD-043): new stops,
 * removed stops, changed quantities (before -> after) and edits to stops that are already done.
 */
export function TourDiffList({
  diff,
  addedHeading,
}: {
  diff: TourDiffView;
  /** Replaces the heading of the "added" section (the late orders list of NUD-099). */
  addedHeading?: string;
}) {
  const t = useTranslations("admin.tours.change");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());

  const sections: Array<{ key: keyof TourDiffView; entries: DiffStopView[] }> = [
    { key: "added", entries: diff.added },
    { key: "removed", entries: diff.removed },
    { key: "changed", entries: diff.changed },
    { key: "completedChanged", entries: diff.completedChanged },
  ];

  return (
    <div className="flex flex-col gap-3" data-testid="tour-diff">
      {sections
        .filter((s) => s.entries.length > 0)
        .map((section) => (
          <section key={section.key} data-testid={`diff-${section.key}`}>
            <h3 className="text-base font-semibold">
              {section.key === "added" && addedHeading
                ? addedHeading
                : t(`sections.${section.key}`, { count: section.entries.length })}
            </h3>
            <ul className="mt-1 flex flex-col gap-2">
              {section.entries.map((entry, index) => (
                <li
                  key={`${entry.customerId}-${index}`}
                  data-testid="diff-stop"
                  data-customer-id={entry.customerId}
                >
                  <span className="font-medium">
                    {entry.name} ({entry.customerNumber})
                  </span>
                  <ul className="ml-4 list-disc">
                    {entry.items.map((item) => (
                      <li
                        key={item.productId}
                        data-testid="diff-item"
                        data-product-id={item.productId}
                      >
                        {productName(item.name, item.sku, locale)}:{" "}
                        <span className="tabular-nums">
                          {section.key === "added"
                            ? fmt.quantity(item.afterCents / 100)
                            : section.key === "removed"
                              ? fmt.quantity(item.beforeCents / 100)
                              : `${fmt.quantity(item.beforeCents / 100)} → ${fmt.quantity(item.afterCents / 100)}`}
                        </span>{" "}
                        {tc(`units.${item.unit}`)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
