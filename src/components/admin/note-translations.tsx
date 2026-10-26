"use client";

import { AlertTriangleIcon, LanguagesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { TranslatedLocale } from "@/domain/note-translations";
import { Link, useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/lib/localized-text";
import { retranslateNoteAction, saveNoteTranslationsAction } from "@/server/customer-actions";
import type { NoteTranslationsView } from "@/server/customer-notes";

const textareaClass =
  "flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

type ErrorKey = "invalid" | "not_found" | "no_notes" | "conflict" | "translation_failed";

/**
 * "Translations" tab of the customer detail page (NUD-071): the four versions of the driver note,
 * each editable. Edited Chinese versions lose the "machine-translated" badge; a changed German
 * text re-translates machine versions only (server side).
 */
export function NoteTranslations({
  customerId,
  view,
}: {
  customerId: string;
  /** `null` = the customer has no note yet. */
  view: NoteTranslationsView | null;
}) {
  const t = useTranslations("admin.customers.translations");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Partial<Record<AppLocale, string>>>({});
  const [reviewed, setReviewed] = useState<TranslatedLocale[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!view) {
    return (
      <div className="flex flex-col items-start gap-3" data-testid="translations-empty">
        <p className="text-base text-muted-foreground">{t("empty")}</p>
        <Link
          href={`/admin/customers/${customerId}/edit`}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("addNote")}
        </Link>
      </div>
    );
  }

  const shown = (locale: AppLocale, stored: string) => values[locale] ?? stored;
  const germanRow = view.rows.find((r) => r.locale === "de");
  const germanChanged = shown("de", germanRow?.value ?? "").trim() !== (germanRow?.value ?? "");
  const germanBlank = shown("de", germanRow?.value ?? "").trim() === "";
  const dirty =
    view.rows.some((r) => shown(r.locale, r.value).trim() !== r.value) || reviewed.length > 0;

  function fail(error: ErrorKey) {
    toast.error(t(`errors.${error}`));
    if (error === "conflict") router.refresh();
  }

  function save() {
    startTransition(async () => {
      let result;
      try {
        result = await saveNoteTranslationsAction({
          customerId,
          baseUpdatedAt: view!.updatedAt,
          values,
          reviewed,
        });
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      if (!result.ok) return fail(result.error);
      setValues({});
      setReviewed([]);
      toast.success(t("saved"));
      router.refresh();
    });
  }

  function retranslate() {
    startTransition(async () => {
      let result;
      try {
        result = await retranslateNoteAction(customerId);
      } catch {
        return void toast.error(tc("errors.generic"));
      }
      setConfirmOpen(false);
      if (!result.ok) return fail(result.error);
      setValues({});
      setReviewed([]);
      toast.success(t("retranslated"));
      router.refresh();
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5" data-testid="translations">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <LanguagesIcon className="size-5" aria-hidden />
          {t("heading")}
        </h2>
        <p className="text-base text-muted-foreground">{t("intro")}</p>
      </div>
      {view.pending ? (
        <p
          className="flex items-start gap-2 text-base font-medium text-warning"
          role="status"
          data-testid="translations-pending"
        >
          <AlertTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          {t("pending")}
        </p>
      ) : null}

      {view.rows.map((row) => {
        const locale = row.locale;
        const value = shown(locale, row.value);
        const edited = locale !== "de" && value.trim() !== row.value;
        const isChecked = reviewed.includes(locale as TranslatedLocale);
        const showStale = row.stale && !edited && !isChecked;
        const kind =
          locale === "de"
            ? "source"
            : edited
              ? value.trim() === ""
                ? "empty"
                : "manual"
              : row.kind;
        return (
          <div key={locale} className="flex flex-col gap-2" data-testid={`tr-${locale}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`tr-text-${locale}`}>{t(`locales.${locale}`)}</Label>
              <Badge
                variant={kind === "machine" ? "secondary" : "outline"}
                data-testid={`tr-badge-${locale}`}
                data-kind={kind}
              >
                {t(`badges.${kind}`)}
              </Badge>
              {showStale ? (
                <Badge variant="warning" data-testid={`tr-stale-${locale}`}>
                  <AlertTriangleIcon aria-hidden />
                  {t("badges.stale")}
                </Badge>
              ) : null}
              {showStale ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReviewed((r) => [...r, locale as TranslatedLocale])}
                  data-testid={`tr-checked-${locale}`}
                >
                  {t("markChecked")}
                </Button>
              ) : null}
            </div>
            <textarea
              id={`tr-text-${locale}`}
              className={textareaClass}
              lang={locale}
              value={value}
              maxLength={2000}
              onChange={(e) => setValues((v) => ({ ...v, [locale]: e.target.value }))}
              data-testid={`tr-text-${locale}`}
            />
            {locale === "de" && germanChanged ? (
              <p className="text-sm text-muted-foreground" data-testid="tr-source-hint">
                {t("sourceChangeHint")}
              </p>
            ) : null}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={pending || !dirty || germanBlank}
          onClick={save}
          data-testid="translations-save"
        >
          {pending ? t("saving") : t("save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => setConfirmOpen(true)}
          data-testid="translations-retranslate"
        >
          {t("retranslate")}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("retranslateTitle")}</DialogTitle>
            <DialogDescription>{t("retranslateDescription")}</DialogDescription>
          </DialogHeader>
          <p
            className="flex items-start gap-2 text-base font-medium text-warning"
            role="alert"
            data-testid="retranslate-warning"
          >
            <AlertTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
            {t("retranslateWarning")}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={retranslate}
              data-testid="retranslate-confirm"
            >
              {t("retranslateConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
