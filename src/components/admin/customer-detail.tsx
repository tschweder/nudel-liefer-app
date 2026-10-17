import {
  AlertTriangleIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  ImageOffIcon,
  MapPinOffIcon,
  PencilIcon,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { type PhotoKind, photosMissing as photosMissingFor } from "@/domain/photos";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { CustomerDetail, UpcomingOrder } from "@/server/customer-admin";

import { CustomerArchiveButton } from "./customer-archive-button";
import { CustomerPhotoSlots, type PhotoSlotValue } from "./customer-photo-slots";

function Field({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base whitespace-pre-line" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

function productName(name: unknown, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return parsed.success ? pick(parsed.data, locale) : "";
}

export function CustomerDetailView({
  customer,
  orders,
  photos,
}: {
  customer: CustomerDetail;
  orders: UpcomingOrder[];
  photos: Record<PhotoKind, PhotoSlotValue | null>;
}) {
  const t = useTranslations("admin.customers");
  const td = useTranslations("admin.customers.detail");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());
  const photosMissing = photosMissingFor(
    (Object.keys(photos) as PhotoKind[]).filter((kind) => photos[kind] !== null),
  );

  return (
    <div className="flex w-full max-w-4xl min-w-0 flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 max-w-full flex-col gap-2">
          <Link
            href="/admin/customers"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t("backToList")}
          </Link>
          <h1 className="text-3xl font-semibold break-words" data-testid="section-title">
            {customer.name}
          </h1>
          <p className="font-mono text-base text-muted-foreground" data-testid="detail-number">
            {td("number", { number: customer.customerNumber })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {photosMissing ? (
              <Badge variant="warning" data-testid="flag-photos-missing">
                <ImageOffIcon aria-hidden />
                {t("flags.photosMissing")}
              </Badge>
            ) : null}
            {!customer.pinConfirmed ? (
              <Badge variant="warning" data-testid="flag-pin-unconfirmed">
                <MapPinOffIcon aria-hidden />
                {t("flags.pinUnconfirmed")}
              </Badge>
            ) : null}
            {!customer.active ? (
              <Badge variant="secondary" data-testid="flag-archived">
                <ArchiveIcon aria-hidden />
                {t("flags.archived")}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/customers/${customer.id}/edit`}
            className={buttonVariants()}
            data-testid="customer-edit"
          >
            <PencilIcon aria-hidden />
            {tc("actions.edit")}
          </Link>
          <CustomerArchiveButton customerId={customer.id} active={customer.active} />
        </div>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="d-address">
        <h2 id="d-address" className="text-xl font-semibold">
          {td("addressHeading")}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={td("address")} testId="detail-address">
            {customer.street}
            {"\n"}
            {customer.postalCode} {customer.city}, {customer.country}
          </Field>
          <Field label={td("hours")}>{customer.deliveryHoursInfo ?? td("none")}</Field>
          <Field label={td("notes")} testId="detail-notes">
            {customer.notes || td("none")}
          </Field>
          <Field label={td("pin")} testId="detail-pin">
            {customer.lat !== null && customer.lng !== null ? (
              <span className="flex flex-col gap-1">
                <span>
                  {customer.pinConfirmed ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2Icon className="size-4 text-success" aria-hidden />
                      {td("pinConfirmed")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangleIcon className="size-4" aria-hidden />
                      {td("pinUnconfirmed")}
                    </span>
                  )}
                </span>
                <span className="font-mono text-sm text-muted-foreground">
                  {customer.lat}, {customer.lng}
                </span>
              </span>
            ) : (
              td("pinNone")
            )}
          </Field>
        </dl>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="d-photos">
        <h2 id="d-photos" className="text-xl font-semibold">
          {td("photosHeading")}
        </h2>
        <CustomerPhotoSlots customerId={customer.id} customerName={customer.name} photos={photos} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="d-orders">
        <h2 id="d-orders" className="text-xl font-semibold">
          {td("ordersHeading")}
        </h2>
        {orders.length === 0 ? (
          <p className="text-base text-muted-foreground" data-testid="orders-empty">
            {td("ordersEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="orders-list">
            {orders.map((order) => (
              <li key={order.id} className="rounded-md border p-3" data-testid="order-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{fmt.calendarDate(order.deliveryDate)}</span>
                  <Badge variant={order.status === "CONFIRMED" ? "success" : "secondary"}>
                    {tc(`statuses.order.${order.status}`)}
                  </Badge>
                </div>
                <ul className="mt-2 flex flex-col gap-0.5 text-base">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      {fmt.quantity(item.quantity)}{" "}
                      {tc(`units.${item.unit as "KG" | "PACK" | "CRATE" | "PIECE"}`)} ·{" "}
                      {productName(item.productName, locale)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
