"use client";

import { ArrowDownIcon, ArrowUpIcon, BanIcon, CheckCircle2Icon, PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { moveProductAction, setProductActiveAction } from "@/server/product-actions";
import type { ProductRow } from "@/server/products";

/** Product list with up/down reordering and deactivate / reactivate (no delete). */
export function ProductsTable({ rows }: { rows: ProductRow[] }) {
  const t = useTranslations("admin.products");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean }>, successKey?: string) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      if (!result.ok) return void toast.error(tc("errors.generic"));
      if (successKey) toast.success(t(successKey));
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("empty")} />;
  }

  return (
    <Table data-testid="products-table">
      <TableHeader>
        <TableRow>
          <TableHead>{t("columns.order")}</TableHead>
          <TableHead>{t("columns.sku")}</TableHead>
          <TableHead>{t("columns.nameDe")}</TableHead>
          <TableHead>{t("columns.nameHans")}</TableHead>
          <TableHead>{t("columns.unit")}</TableHead>
          <TableHead>{t("columns.status")}</TableHead>
          <TableHead>
            <span className="sr-only">{t("columns.actions")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p, index) => (
          <TableRow
            key={p.id}
            data-testid="product-row"
            data-sku={p.sku}
            className={cn(!p.active && "text-muted-foreground")}
          >
            <TableCell>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={pending || index === 0}
                  aria-label={t("moveUp", { name: p.name.de ?? p.sku })}
                  onClick={() => run(() => moveProductAction(p.id, "up"))}
                  data-testid="move-up"
                >
                  <ArrowUpIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={pending || index === rows.length - 1}
                  aria-label={t("moveDown", { name: p.name.de ?? p.sku })}
                  onClick={() => run(() => moveProductAction(p.id, "down"))}
                  data-testid="move-down"
                >
                  <ArrowDownIcon aria-hidden />
                </Button>
              </div>
            </TableCell>
            <TableCell className="font-mono">{p.sku}</TableCell>
            <TableCell lang="de">{p.name.de}</TableCell>
            <TableCell lang="zh-Hans">{p.name["zh-Hans"]}</TableCell>
            <TableCell>{tc(`units.${p.unit}`)}</TableCell>
            <TableCell>
              {p.active ? (
                <Badge variant="secondary" data-testid="status-active">
                  {t("status.active")}
                </Badge>
              ) : (
                <Badge variant="outline" data-testid="status-inactive">
                  {t("status.inactive")}
                </Badge>
              )}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/admin/products/${p.id}/edit`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  data-testid="product-edit"
                >
                  <PencilIcon aria-hidden />
                  {tc("actions.edit")}
                </Link>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => setProductActiveAction(p.id, !p.active),
                      p.active ? "deactivated" : "activated",
                    )
                  }
                  data-testid={p.active ? "product-deactivate" : "product-activate"}
                >
                  {p.active ? <BanIcon aria-hidden /> : <CheckCircle2Icon aria-hidden />}
                  {t(p.active ? "deactivate" : "activate")}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
