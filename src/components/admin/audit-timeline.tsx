import { useFormatter, useLocale, useTranslations } from "next-intl";

import type { AuditAction } from "@/domain/audit";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { AuditDetail, AuditEntryView, AuditProductLine } from "@/server/audit-history";

/** Message keys cannot contain dots: `order.update` is stored as `order_update`. */
type ActionKey = ReplaceDot<AuditAction>;
type ReplaceDot<S extends string> = S extends `${infer A}.${infer B}` ? `${A}_${B}` : S;
type Translate = ReturnType<typeof useTranslations<"admin.history">>;

function productName(line: AuditProductLine, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(line.productName);
  return (parsed.success ? pick(parsed.data, locale) : "") || line.sku;
}

/**
 * Compact history of an order or a tour (NUD-092): newest entry first, each with what happened,
 * who did it (office or driver), when, and the details that changed. Quantities show
 * before -> after with the product name in the viewer's language.
 */
export function AuditTimeline({ entries }: { entries: AuditEntryView[] }) {
  const t = useTranslations("admin.history");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());

  const qty = (cents: number) => fmt.quantity(cents / 100);

  const lineText = (line: AuditProductLine) => {
    const unit = tc(`units.${line.unit as "KG" | "PACK" | "CRATE" | "PIECE"}`);
    const change =
      line.before === null && line.after !== null
        ? `${qty(line.after)} ${unit} (${t("line.added")})`
        : line.after === null && line.before !== null
          ? `${qty(line.before)} ${unit} → ${t("line.removed")}`
          : `${qty(line.before ?? 0)} → ${qty(line.after ?? 0)} ${unit}`;
    return `${productName(line, locale)}: ${change}`;
  };

  const value = (detail: Extract<AuditDetail, { kind: "field" }>, v: string | null): string => {
    if (v === null || v === "") return t("values.none");
    switch (detail.type) {
      case "orderStatus":
        return tc(`statuses.order.${v as "DRAFT" | "CONFIRMED" | "CANCELLED"}`);
      case "tourStatus":
        return tc(
          `statuses.tour.${v as "DRAFT" | "OPTIMIZED" | "RELEASED" | "IN_PROGRESS" | "COMPLETED"}`,
        );
      case "stopStatus":
        return tc(`statuses.stop.${v as "PENDING" | "DELIVERED" | "PROBLEM"}`);
      case "date":
        return fmt.calendarDate(new Date(`${v}T00:00:00Z`));
      case "bool":
        return t(`values.${v === "true" ? "true" : "false"}`);
      case "text":
        return `„${v}“`;
      case "person":
        return v;
    }
  };

  const detailText = (d: AuditDetail): string => {
    switch (d.kind) {
      case "line":
        return lineText(d);
      case "field":
        return `${t(`fields.${d.field}`)}: ${
          d.before === null && d.type !== "bool"
            ? value(d, d.after)
            : t("change", { before: value(d, d.before), after: value(d, d.after) })
        }`;
      case "customer":
        return t("customer", { name: d.name, number: d.number });
      case "fact":
        return t(`facts.${d.key as "stopCount"}`, { value: d.value });
      case "sequence":
        return t("sequence", { names: d.names.join(" → ") });
      case "reason":
        return t("reason", {
          reason: tc(
            `problemReasons.${d.reason as "CLOSED" | "NOBODY_THERE" | "NO_PARKING" | "WRONG_QUANTITY" | "REFUSED" | "ADDRESS_NOT_FOUND" | "OTHER"}`,
          ),
        });
      case "note":
        return t("note", { text: d.text });
      case "tapped":
        return t("tapped", { time: fmt.dateTime(new Date(d.at)) });
      case "photo":
        return `${t(`photo.${d.photoKind as "STORE" | "PARKING"}`)}, ${t(`photo.via.${d.via}`)}`;
      case "stopGroup":
        return "";
    }
  };

  return (
    <section
      className="flex max-w-3xl flex-col gap-3"
      aria-labelledby="audit-history"
      data-testid="audit-timeline"
    >
      <div className="flex flex-col gap-1">
        <h2 id="audit-history" className="text-xl font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-base text-muted-foreground" data-testid="audit-empty">
          {t("empty")}
        </p>
      ) : (
        <ol className="flex flex-col gap-4 border-l-2 pl-4">
          {entries.map((entry) => (
            <Entry
              key={entry.id}
              entry={entry}
              t={t}
              dateTime={fmt.dateTime(new Date(entry.at))}
              detailText={detailText}
              lineText={lineText}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function Entry({
  entry,
  t,
  dateTime,
  detailText,
  lineText,
}: {
  entry: AuditEntryView;
  t: Translate;
  dateTime: string;
  detailText: (d: AuditDetail) => string;
  lineText: (l: AuditProductLine) => string;
}) {
  return (
    <li className="flex flex-col gap-1" data-testid="audit-entry" data-action={entry.action}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-base font-semibold" data-testid="audit-action">
          {t(`actions.${entry.action.replace(".", "_") as ActionKey}`)}
        </span>
        <span className="text-sm text-muted-foreground" data-testid="audit-meta">
          <time dateTime={entry.at}>{dateTime}</time> ·{" "}
          {entry.actor
            ? `${entry.actor.name} (${t(`roles.${entry.actor.role}`)})`
            : t("unknownActor")}
        </span>
      </div>
      {entry.details.length > 0 ? (
        <ul className="ml-1 flex flex-col gap-0.5 text-base">
          {entry.details.map((d, index) =>
            d.kind === "stopGroup" ? (
              <li key={index} data-testid="audit-stop-group">
                <span className="font-medium">
                  {t(`stopGroup.${d.change}`)}: {d.name} ({d.number})
                </span>
                <ul className="ml-4 list-disc">
                  {d.lines.map((l) => (
                    <li key={l.productId} data-testid="audit-line" data-product-id={l.productId}>
                      {lineText(l)}
                    </li>
                  ))}
                </ul>
              </li>
            ) : (
              <li
                key={index}
                data-testid={d.kind === "line" ? "audit-line" : "audit-detail"}
                data-product-id={d.kind === "line" ? d.productId : undefined}
              >
                {detailText(d)}
              </li>
            ),
          )}
        </ul>
      ) : null}
    </li>
  );
}
