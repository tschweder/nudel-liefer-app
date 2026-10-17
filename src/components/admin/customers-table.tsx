import { ArchiveIcon, ImageOffIcon, MapPinOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { customerListQuery } from "@/lib/customer-list-params";
import { cn } from "@/lib/utils";
import type { CustomerListResult } from "@/server/customers";

type Filters = {
  q: string;
  status: "active" | "archived" | "all";
  photosMissing: boolean;
  pinUnconfirmed: boolean;
};

export function CustomersTable({
  result,
  filters,
}: {
  result: CustomerListResult;
  filters: Filters;
}) {
  const t = useTranslations("admin.customers");
  const tc = useTranslations("common");
  const filtered =
    filters.q.trim() !== "" ||
    filters.status !== "active" ||
    filters.photosMissing ||
    filters.pinUnconfirmed;
  const pageHref = (page: number) => ({
    pathname: "/admin/customers" as const,
    query: customerListQuery({ ...filters, page }),
  });

  if (result.total === 0) {
    return (
      <EmptyState
        title={filtered ? t("emptyFilteredTitle") : t("emptyTitle")}
        description={filtered ? t("emptyFiltered") : t("empty")}
      >
        {filtered ? (
          <Link
            href="/admin/customers"
            className={buttonVariants({ variant: "outline" })}
            data-testid="reset-filters"
          >
            {t("resetFilters")}
          </Link>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" data-testid="customer-count" aria-live="polite">
        {tc("itemsCount", { count: result.total })}
      </p>
      <Table data-testid="customers-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.number")}</TableHead>
            <TableHead>{t("columns.name")}</TableHead>
            <TableHead>{t("columns.city")}</TableHead>
            <TableHead>{t("columns.flags")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((c) => (
            <TableRow key={c.id} data-testid="customer-row" data-number={c.customerNumber}>
              <TableCell className="font-mono">{c.customerNumber}</TableCell>
              <TableCell>
                <Link
                  href={`/admin/customers/${c.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  data-testid="customer-link"
                >
                  {c.name}
                </Link>
                <div className="text-sm text-muted-foreground">{c.street}</div>
              </TableCell>
              <TableCell>
                {c.postalCode} {c.city}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  {c.photosMissing ? (
                    <Badge variant="warning" data-testid="flag-photos-missing">
                      <ImageOffIcon aria-hidden />
                      {t("flags.photosMissing")}
                    </Badge>
                  ) : null}
                  {!c.pinConfirmed ? (
                    <Badge variant="warning" data-testid="flag-pin-unconfirmed">
                      <MapPinOffIcon aria-hidden />
                      {t("flags.pinUnconfirmed")}
                    </Badge>
                  ) : null}
                  {!c.active ? (
                    <Badge variant="secondary" data-testid="flag-archived">
                      <ArchiveIcon aria-hidden />
                      {t("flags.archived")}
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {result.pageCount > 1 ? (
        <nav
          aria-label={t("pagination.label")}
          className="flex items-center justify-between gap-3"
          data-testid="pagination"
        >
          <PageLink disabled={result.page <= 1} href={pageHref(result.page - 1)} testId="page-prev">
            {tc("actions.back")}
          </PageLink>
          <span className="text-base">
            {t("pagination.status", { page: result.page, pageCount: result.pageCount })}
          </span>
          <PageLink
            disabled={result.page >= result.pageCount}
            href={pageHref(result.page + 1)}
            testId="page-next"
          >
            {tc("actions.next")}
          </PageLink>
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({
  disabled,
  href,
  testId,
  children,
}: {
  disabled: boolean;
  href: React.ComponentProps<typeof Link>["href"];
  testId: string;
  children: React.ReactNode;
}) {
  const className = buttonVariants({ variant: "outline" });
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(className, "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className} data-testid={testId}>
      {children}
    </Link>
  );
}
