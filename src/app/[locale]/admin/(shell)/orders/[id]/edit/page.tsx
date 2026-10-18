import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { OrderForm } from "@/components/admin/order-form";
import { LoadingSkeleton } from "@/components/shared/states";
import { formatCalendarDate } from "@/domain/order";
import { Link, redirect } from "@/i18n/navigation";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import { requirePageActor } from "@/server/auth/page-guards";
import { orderDetailQuery } from "@/server/order-queries";
import { activeProductsQuery } from "@/server/product-queries";

const LOCALES = ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const;

/** Edit an open order (NUD-032). Cancelled orders and orders of past days go back to the detail. */
async function Guarded({ locale, id }: { locale: string; id: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale, namespace: "admin.orders" });
  const [order, activeProducts] = await Promise.all([orderDetailQuery(id), activeProductsQuery()]);
  if (!order) notFound();
  if (!order.editable) return redirect({ href: `/admin/orders/${id}`, locale });
  const status = order.status === "DRAFT" ? "DRAFT" : "CONFIRMED";

  const nameOf = (name: unknown) => {
    const parsed = localizedTextSchema.safeParse(name);
    return parsed.success ? pick(parsed.data, locale as AppLocale) : "";
  };
  const options = activeProducts.map((p) => ({
    value: p.id,
    label: `${pick(p.name, locale as AppLocale)} (${p.sku})`,
    keywords: [p.sku, ...LOCALES.flatMap((l) => (p.name[l] ? [p.name[l]] : []))],
    unit: p.unit,
  }));
  // A product deactivated after the order was entered stays selectable for its existing line.
  for (const item of order.items) {
    if (options.some((o) => o.value === item.productId)) continue;
    options.push({
      value: item.productId,
      label: `${nameOf(item.productName)} (${item.sku})`,
      keywords: [item.sku],
      unit: item.unit as "KG" | "PACK" | "CRATE" | "PIECE",
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/admin/orders/${id}`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("detail.title")}
        </Link>
        <h1 className="text-3xl font-semibold" data-testid="section-title">
          {t("form.editTitle")}
        </h1>
      </div>
      <OrderForm
        key={order.updatedAt.toISOString()}
        defaultDate={formatCalendarDate(order.deliveryDate)}
        customers={[
          {
            value: order.customer.id,
            label: `${order.customer.customerNumber} · ${order.customer.name}, ${order.customer.city}`,
            pinConfirmed: order.customer.pinConfirmed,
          },
        ]}
        products={options}
        order={{
          id: order.id,
          customerId: order.customer.id,
          date: formatCalendarDate(order.deliveryDate),
          status,
          note: order.internalNote ?? "",
          lines: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          screenshotUrl: order.screenshot?.url ?? null,
        }}
      />
    </div>
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/orders/[id]/edit">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} id={id} />
    </Suspense>
  );
}
