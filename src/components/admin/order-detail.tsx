import { useFormatter, useLocale, useTranslations } from "next-intl";

import { ImagePreview } from "@/components/shared/image-preview";
import { Badge } from "@/components/ui/badge";
import { formatCalendarDate } from "@/domain/order";
import { Link } from "@/i18n/navigation";
import { createAppFormatters, formatOrderWindow } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { AuditEntryView } from "@/server/audit-history";
import type { OrderDetail } from "@/server/orders";

import { AuditTimeline } from "./audit-timeline";
import { OrderActions } from "./order-actions";
import { PageHeader } from "./page-header";

function productName(name: unknown, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return parsed.success ? pick(parsed.data, locale) : "";
}

/**
 * Order detail (NUD-031, NUD-032). Shows the lines and, when the order was typed from a
 * screenshot, its thumbnail that opens the fullscreen zoom view (for disputes about quantities).
 * Open orders can be edited and cancelled; every order can be copied to another delivery date.
 */
export function OrderDetailView({
  order,
  history,
  defaultDuplicateDate,
}: {
  order: OrderDetail;
  history: AuditEntryView[];
  defaultDuplicateDate: Date;
}) {
  const t = useTranslations("admin.orders");
  const td = useTranslations("admin.orders.detail");
  const tc = useTranslations("common");
  // Unit labels ("Sackerl", "Kiste", "×") live once, under `driver.units` (§9.3).
  const tu = useTranslations("driver.units");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());

  return (
    <div className="flex flex-col gap-6" data-testid="order-detail">
      <PageHeader
        title={td("title")}
        description={`${fmt.calendarDate(order.deliveryDate)} · ${order.customer.name}`}
        breadcrumb={
          <Link
            href="/admin/orders"
            className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("backToList")}
          </Link>
        }
        actions={
          <OrderActions
            orderId={order.id}
            editable={order.editable}
            inTour={order.tour !== null}
            defaultDuplicateDate={formatCalendarDate(defaultDuplicateDate)}
          />
        }
      />

      {order.editable ? null : (
        <p className="max-w-3xl text-base text-muted-foreground" data-testid="read-only-note">
          {order.status === "CANCELLED" ? td("readOnlyCancelled") : td("readOnlyPast")}
        </p>
      )}

      <dl className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{t("columns.customer")}</dt>
          <dd className="text-base">
            <Link
              href={`/admin/customers/${order.customer.id}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
              data-testid="detail-customer"
            >
              {order.customer.name}
            </Link>
            <div className="text-sm text-muted-foreground">{order.customer.customerNumber}</div>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{t("window.label")}</dt>
          <dd className="text-base" data-testid="detail-window">
            {formatOrderWindow(fmt, order.window)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{t("columns.date")}</dt>
          <dd className="text-base" data-testid="detail-date">
            {fmt.calendarDate(order.deliveryDate)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{t("columns.status")}</dt>
          <dd>
            <Badge
              variant={order.status === "CONFIRMED" ? "success" : "secondary"}
              data-testid="detail-status"
            >
              {tc(`statuses.order.${order.status}`)}
            </Badge>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{t("columns.source")}</dt>
          <dd className="text-base" data-testid="detail-source">
            {t(`source.${order.source}`)}
            {order.fromRecurring ? (
              <span className="block text-sm text-muted-foreground" data-testid="detail-recurring">
                {t("fromRecurring")}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{td("tourHeading")}</dt>
          <dd className="text-base" data-testid="detail-tour">
            {order.tour ? td("inTour") : td("notInTour")}
          </dd>
        </div>
      </dl>

      <section className="flex max-w-3xl flex-col gap-2" aria-labelledby="detail-items">
        <h2 id="detail-items" className="text-xl font-semibold">
          {t("form.linesHeading")}
        </h2>
        <ul className="flex flex-col gap-1" data-testid="detail-items">
          {order.items.map((item) => (
            <li key={item.id} className="text-base" data-testid="detail-item">
              <span className="font-semibold">
                {fmt.quantity(item.quantity)}{" "}
                {tu(item.unit as "KG" | "PACK" | "CRATE" | "PIECE", {
                  count: Number(item.quantity),
                })}
              </span>{" "}
              {productName(item.productName, locale)}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex max-w-3xl flex-col gap-2" aria-labelledby="detail-note">
        <h2 id="detail-note" className="text-xl font-semibold">
          {t("form.internalNote")}
        </h2>
        <p className="text-base whitespace-pre-line" data-testid="detail-note">
          {order.internalNote ?? td("noNote")}
        </p>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="detail-screenshot">
        <h2 id="detail-screenshot" className="text-xl font-semibold">
          {t("form.screenshot.heading")}
        </h2>
        {order.screenshot ? (
          <div className="flex flex-col gap-1" data-testid="detail-screenshot">
            <ImagePreview
              src={order.screenshot.url}
              alt={td("screenshotAlt")}
              fit="contain"
              className="h-48 w-48 border bg-muted"
            />
            <p className="text-sm text-muted-foreground">{td("screenshotHint")}</p>
          </div>
        ) : (
          <p className="text-base text-muted-foreground" data-testid="detail-no-screenshot">
            {td("noScreenshot")}
          </p>
        )}
      </section>

      <AuditTimeline entries={history} />
    </div>
  );
}
