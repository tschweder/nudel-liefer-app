"use client";

import { CopyIcon, PencilIcon, XCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseCalendarDate } from "@/domain/order";
import { Link, useRouter } from "@/i18n/navigation";
import { cancelOrderAction, duplicateOrderAction } from "@/server/order-actions";

/**
 * Buttons of the order detail: edit (open orders only), cancel (open orders only, with
 * confirmation; nothing is deleted) and duplicate to another delivery date (any order).
 */
export function OrderActions({
  orderId,
  editable,
  inTour,
  defaultDuplicateDate,
}: {
  orderId: string;
  editable: boolean;
  inTour: boolean;
  /** `YYYY-MM-DD` proposed in the copy dialog (the next delivery date). */
  defaultDuplicateDate: string;
}) {
  const t = useTranslations("admin.orders.detail");
  const tc = useTranslations("common");
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState(defaultDuplicateDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const errorText = (code: string) =>
    t(`actionErrors.${(code in ACTION_ERRORS ? code : "generic") as keyof typeof ACTION_ERRORS}`);

  function cancel() {
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await cancelOrderAction(orderId);
      } catch {
        return setError(errorText("generic"));
      }
      if (!result.ok) return setError(errorText(result.error));
      setCancelOpen(false);
      toast.success(t("cancelled"));
      router.refresh();
    });
  }

  function duplicate() {
    setError(null);
    if (parseCalendarDate(copyDate) === null) return setError(errorText("invalid"));
    startTransition(async () => {
      let result;
      try {
        result = await duplicateOrderAction(orderId, copyDate);
      } catch {
        return setError(errorText("generic"));
      }
      if (!result.ok) return setError(errorText(result.error));
      setCopyOpen(false);
      toast.success(t("duplicated"));
      router.push(`/admin/orders/${result.id}`);
    });
  }

  return (
    <div className="flex flex-wrap gap-3">
      {editable ? (
        <Link
          href={`/admin/orders/${orderId}/edit`}
          className={buttonVariants()}
          data-testid="order-edit"
        >
          <PencilIcon aria-hidden />
          {t("edit")}
        </Link>
      ) : null}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError(null);
          setCopyOpen(true);
        }}
        data-testid="order-duplicate"
      >
        <CopyIcon aria-hidden />
        {t("duplicate")}
      </Button>
      {editable ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setError(null);
            setCancelOpen(true);
          }}
          data-testid="order-cancel"
        >
          <XCircleIcon aria-hidden />
          {t("cancel")}
        </Button>
      ) : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelTitle")}</DialogTitle>
            <DialogDescription>{t("cancelDescription")}</DialogDescription>
          </DialogHeader>
          {inTour ? (
            <p className="text-base" data-testid="cancel-tour-note">
              {t("cancelTourNote")}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="action-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={cancel}
              data-testid="order-cancel-confirm"
            >
              {t("cancelConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("duplicateTitle")}</DialogTitle>
            <DialogDescription>{t("duplicateDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="duplicate-date">{t("duplicateDate")}</Label>
            <Input
              id="duplicate-date"
              type="date"
              value={copyDate}
              onChange={(e) => {
                setCopyDate(e.target.value);
                setError(null);
              }}
              className="w-48"
              data-testid="duplicate-date"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="action-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCopyOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={duplicate}
              data-testid="order-duplicate-confirm"
            >
              {t("duplicateConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ACTION_ERRORS = {
  invalid: 1,
  not_found: 1,
  not_editable: 1,
  date_in_past: 1,
  customer_inactive: 1,
  product_not_found: 1,
  product_inactive: 1,
  generic: 1,
};
