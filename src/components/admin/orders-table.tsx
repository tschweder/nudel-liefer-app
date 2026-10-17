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

/** Minimal list of upcoming orders (NUD-030); NUD-032 replaces it. */
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
          <TableHead>{t("columns.items")}</TableHead>
          <TableHead>{t("columns.status")}</TableHead>
          <TableHead>{t("columns.source")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.id} data-testid="order-row" data-order-id={order.id}>
            <TableCell className="whitespace-nowrap">
              {fmt.calendarDate(order.deliveryDate)}
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
                data-testid="order-status"
              >
                {tc(`statuses.order.${order.status}`)}
              </Badge>
            </TableCell>
            <TableCell>{t(`source.${order.source}`)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
