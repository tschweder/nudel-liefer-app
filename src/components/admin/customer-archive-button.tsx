"use client";

import { AlertTriangleIcon, ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { setCustomerActiveAction } from "@/server/customer-actions";

/** Archive (soft delete, with confirmation) or reactivate a customer. */
export function CustomerArchiveButton({
  customerId,
  active,
  upcomingOrders = 0,
  runningRules = 0,
}: {
  customerId: string;
  active: boolean;
  /** Not cancelled orders from today on: archiving cancels the open ones (D25, NUD-149). */
  upcomingOrders?: number;
  /** Running recurring rules: archiving pauses them. */
  runningRules?: number;
}) {
  const t = useTranslations("admin.customers.detail");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(next: boolean) {
    startTransition(async () => {
      let result;
      try {
        result = await setCustomerActiveAction(customerId, next);
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      if (!result.ok) return void toast.error(tc("errors.generic"));
      setOpen(false);
      toast.success(
        next
          ? t("restored")
          : result.cancelledOrders > 0
            ? t("archivedCancelled", { count: result.cancelledOrders })
            : t("archived"),
      );
      router.refresh();
    });
  }

  if (!active) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => apply(true)}
        data-testid="customer-restore"
      >
        <ArchiveRestoreIcon aria-hidden />
        {tc("actions.restore")}
      </Button>
    );
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="customer-archive"
      >
        <ArchiveIcon aria-hidden />
        {tc("actions.archive")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("archiveTitle")}</DialogTitle>
            <DialogDescription>{t("archiveDescription")}</DialogDescription>
          </DialogHeader>
          {upcomingOrders > 0 ? (
            <p
              className="flex items-start gap-2 text-base font-medium text-warning"
              role="status"
              data-testid="archive-upcoming-warning"
            >
              <AlertTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
              {t("archiveUpcoming", { count: upcomingOrders })}
            </p>
          ) : null}
          {runningRules > 0 ? (
            <p className="text-base text-muted-foreground" data-testid="archive-rules-note">
              {t("archiveRules", { count: runningRules })}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => apply(false)}
              data-testid="customer-archive-confirm"
            >
              {tc("actions.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
