import { ImageIcon, PencilLineIcon, RouteIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";
import type { OrderOverviewRow } from "@/server/orders";

function productName(name: unknown, locale: AppLocale): string {
  const parsed = localizedTextSchema.safeParse(name);
  return parsed.success ? pick(parsed.data, locale) : "";
}

/**
 * Order overview rows: date, customer, lines (count + quantities), status, source icon and the
 * "in tour" badge (the order is part of a stop of a tour). Opens the order detail.
 */
export function OrdersTable({ orders }: { orders: OrderOverviewRow[] }) {
  const t = useTranslations("admin.orders");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const fmt = createAppFormatters(useFormatter());

  if (orders.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("empty")} />;
  }
  return (
    <Table data-testid="orders-table">
      <TableHeader>
        <TableRow>
          <TableHead>{t("columns.date")}</TableHead>
          <TableHead>{t("columns.customer")}</TableHead>
          <TableHead>{t("columns.lines")}</TableHead>
          <TableHead>{t("columns.status")}</TableHead>
          <TableHead>{t("columns.source")}</TableHead>
          <TableHead>{t("columns.tour")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.id} data-testid="order-row" data-order-id={order.id}>
            <TableCell className="whitespace-nowrap">
              <Link
                href={`/admin/orders/${order.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
                data-testid="order-open"
              >
                {fmt.calendarDate(order.deliveryDate)}
              </Link>
            </TableCell>
            <TableCell>
              <Link
                href={`/admin/customers/${order.customer.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {order.customer.name}
              </Link>
              <div className="text-sm text-muted-foreground">{order.customer.customerNumber}</div>
            </TableCell>
            <TableCell>
              <div className="font-semibold" data-testid="order-line-count">
                {order.items.length}
              </div>
              <ul className="flex flex-col gap-0.5" data-testid="order-items">
                {order.items.map((item) => (
                  <li key={item.id} data-testid="order-item">
                    {fmt.quantity(item.quantity)}{" "}
                    {tc(`units.${item.unit as "KG" | "PACK" | "CRATE" | "PIECE"}`)} ·{" "}
                    {productName(item.productName, locale)}
                  </li>
                ))}
              </ul>
            </TableCell>
            <TableCell>
              <Badge
                variant={order.status === "CONFIRMED" ? "success" : "secondary"}
                className={order.status === "CANCELLED" ? "line-through" : undefined}
                data-testid="order-status"
              >
                {tc(`statuses.order.${order.status}`)}
              </Badge>
            </TableCell>
            <TableCell>
              <span
                className="inline-flex items-center gap-1.5"
                data-testid="order-source"
                data-source={order.source}
              >
                {order.source === "SCREENSHOT" ? (
                  <ImageIcon className="size-4" aria-hidden />
                ) : (
                  <PencilLineIcon className="size-4" aria-hidden />
                )}
                {t(`source.${order.source}`)}
              </span>
            </TableCell>
            <TableCell>
              {order.tour ? (
                <Badge
                  variant="outline"
                  className="gap-1"
                  data-testid="order-in-tour"
                  data-tour-id={order.tour.tourId}
                  data-stop-id={order.tour.stopId}
                >
                  <RouteIcon className="size-3.5" aria-hidden />
                  {t("inTour")}
                </Badge>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
