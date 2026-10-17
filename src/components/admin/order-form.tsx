"use client";

import { AlertTriangleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  hasDuplicateProducts,
  orderWarnings,
  parseCalendarDate,
  parseQuantity,
} from "@/domain/order";
import { Link, useRouter } from "@/i18n/navigation";
import { confirmedOrderCountAction, createOrderAction } from "@/server/order-actions";

export type CustomerOption = ComboboxOption & { pinConfirmed: boolean };
export type ProductOption = ComboboxOption & { unit: "KG" | "PACK" | "CRATE" | "PIECE" };

type Props = {
  customers: CustomerOption[];
  products: ProductOption[];
  /** `YYYY-MM-DD`, from `getDefaultDeliveryDate()` (next delivery weekday). */
  defaultDate: string;
};

type Line = { key: number; productId: string | undefined; quantity: string };
type SaveStatus = "CONFIRMED" | "DRAFT";

const isBlank = (line: Line) => !line.productId && line.quantity.trim() === "";
const isComplete = (line: Line) => Boolean(line.productId) && parseQuantity(line.quantity) !== null;

const SERVER_ERRORS: Record<string, string> = {
  invalid: "invalid",
  date_in_past: "datePast",
  customer_not_found: "customerNotFound",
  customer_inactive: "customerInactive",
  product_not_found: "productNotFound",
  product_inactive: "productInactive",
};

/**
 * Manual order entry: customer, delivery date, product lines (picker + quantity + unit). Keyboard
 * flow: Enter in a quantity adds the next line and focuses its product picker; quantities accept
 * `,` and `.`. Blank lines are ignored on save. The server validates everything again.
 */
export function OrderForm({ customers, products, defaultDate }: Props) {
  const t = useTranslations("admin.orders.form");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const nextKey = useRef(2);
  const focusKey = useRef<number | null>(null);
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState(defaultDate);
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: undefined, quantity: "" }]);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [counted, setCounted] = useState<{ key: string; count: number } | null>(null);

  const customer = customers.find((c) => c.value === customerId);
  const productById = new Map(products.map((p) => [p.value, p]));
  const dateValid = parseCalendarDate(date) !== null;

  // Focus the product picker of a freshly added line.
  useEffect(() => {
    if (focusKey.current === null) return;
    document.getElementById(`order-line-product-${focusKey.current}`)?.focus();
    focusKey.current = null;
  }, [lines.length]);

  // Warning: confirmed orders of this customer on that day will be combined into one stop.
  // The answer is stored with the customer/day it belongs to, so a stale answer is never shown.
  const countKey = customerId && dateValid ? `${customerId}|${date}` : null;
  useEffect(() => {
    if (countKey === null || !customerId) return;
    let current = true;
    confirmedOrderCountAction(customerId, date)
      .then((count) => {
        if (current) setCounted({ key: countKey, count });
      })
      .catch(() => {
        if (current) setCounted({ key: countKey, count: 0 });
      });
    return () => {
      current = false;
    };
  }, [countKey, customerId, date]);
  const confirmedCount = counted && counted.key === countKey ? counted.count : 0;

  const warnings = customer
    ? orderWarnings({ pinConfirmed: customer.pinConfirmed, confirmedOrdersOnDate: confirmedCount })
    : [];
  const usedProducts = lines.map((l) => l.productId).filter((p): p is string => Boolean(p));

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setServerError(null);
  }

  function addLine() {
    const key = nextKey.current++;
    focusKey.current = key;
    setLines((current) => [...current, { key, productId: undefined, quantity: "" }]);
  }

  function removeLine(key: number) {
    setLines((current) =>
      current.length === 1
        ? [{ key: nextKey.current++, productId: undefined, quantity: "" }]
        : current.filter((l) => l.key !== key),
    );
  }

  function onQuantityKeyDown(event: KeyboardEvent<HTMLInputElement>, line: Line) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!isComplete(line)) {
      setSubmitted(true);
      return;
    }
    addLine();
  }

  const filled = lines.filter((l) => !isBlank(l));
  const lineErrors = (line: Line): "productRequired" | "quantityInvalid" | null => {
    if (isBlank(line)) return null;
    if (!line.productId) return "productRequired";
    return parseQuantity(line.quantity) === null ? "quantityInvalid" : null;
  };
  const formError = !customerId
    ? "customerRequired"
    : !dateValid
      ? "dateInvalid"
      : filled.length === 0
        ? "linesRequired"
        : filled.some((l) => lineErrors(l) !== null)
          ? "invalid"
          : null;

  function save(status: SaveStatus) {
    setSubmitted(true);
    setServerError(null);
    if (formError !== null || !customerId) return;
    const input = {
      customerId,
      deliveryDate: date,
      status,
      internalNote: note,
      lines: filled.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    };
    startTransition(async () => {
      let result;
      try {
        result = await createOrderAction(input);
      } catch {
        return setServerError("generic");
      }
      if (!result.ok) return setServerError(SERVER_ERRORS[result.error] ?? "generic");
      toast.success(t(result.status === "DRAFT" ? "savedDraft" : "savedConfirmed"));
      router.push("/admin/orders");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="flex max-w-3xl flex-col gap-8"
      noValidate
      data-testid="order-form"
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="order-customer">{t("customer")}</Label>
          <Combobox
            id="order-customer"
            options={customers}
            value={customerId}
            onChange={(value) => {
              setCustomerId(value);
              setServerError(null);
            }}
            placeholder={t("customerPlaceholder")}
            searchPlaceholder={t("customerSearch")}
            emptyText={t("customerEmpty")}
          />
          {submitted && !customerId ? (
            <p className="text-sm text-destructive" role="alert" data-testid="error-customer">
              {t("errors.customerRequired")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="order-date">{t("date")}</Label>
          <Input
            id="order-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setServerError(null);
            }}
            aria-invalid={(submitted && !dateValid) || undefined}
            required
            data-testid="order-date"
          />
          {submitted && !dateValid ? (
            <p className="text-sm text-destructive" role="alert" data-testid="error-date">
              {t("errors.dateInvalid")}
            </p>
          ) : null}
        </div>
      </div>

      {warnings.length > 0 && customer && customerId ? (
        <div className="flex flex-col gap-3" data-testid="order-warnings">
          {warnings.includes("combined_stop") ? (
            <Alert
              role="status"
              className="border-warning text-warning"
              data-testid="warning-combined"
            >
              <AlertTriangleIcon aria-hidden />
              <div>{t("warningCombined", { count: confirmedCount })}</div>
            </Alert>
          ) : null}
          {warnings.includes("pin_unconfirmed") ? (
            <Alert role="status" className="border-warning text-warning" data-testid="warning-pin">
              <AlertTriangleIcon aria-hidden />
              <div className="flex flex-col gap-1">
                <span>{t("warningPin")}</span>
                <Link
                  href={`/admin/customers/${customerId}`}
                  className="underline underline-offset-4"
                  target="_blank"
                >
                  {t("openCustomer")}
                </Link>
              </div>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="order-lines">
        <h2 id="order-lines" className="text-xl font-semibold">
          {t("linesHeading")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("quantityHint")}</p>
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const product = line.productId ? productById.get(line.productId) : undefined;
            const error = submitted ? lineErrors(line) : null;
            return (
              <li key={line.key} className="flex flex-col gap-1" data-testid="order-line">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center">
                  <Label htmlFor={`order-line-product-${line.key}`} className="sr-only">
                    {t("product")} · {t("lineLabel", { n: index + 1 })}
                  </Label>
                  <Combobox
                    id={`order-line-product-${line.key}`}
                    options={products}
                    value={line.productId}
                    onChange={(value) => updateLine(line.key, { productId: value })}
                    placeholder={t("productPlaceholder")}
                    searchPlaceholder={t("productSearch")}
                    emptyText={t("productEmpty")}
                    className="col-span-2 sm:col-span-1"
                  />
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`order-line-quantity-${line.key}`} className="sr-only">
                      {t("quantity")} · {t("lineLabel", { n: index + 1 })}
                    </Label>
                    <Input
                      id={`order-line-quantity-${line.key}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={line.quantity}
                      placeholder={t("quantity")}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      onKeyDown={(e) => onQuantityKeyDown(e, line)}
                      aria-invalid={error === "quantityInvalid" || undefined}
                      className="min-w-0 flex-1"
                      data-testid="line-quantity"
                    />
                    <span className="w-16 shrink-0 text-base" data-testid="line-unit">
                      {product ? tc(`units.${product.unit}`) : ""}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(line.key)}
                    aria-label={t("removeLine", { n: index + 1 })}
                    data-testid="line-remove"
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </div>
                {error ? (
                  <p className="text-sm text-destructive" role="alert" data-testid="error-line">
                    {t(`errors.${error}`)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div>
          <Button type="button" variant="outline" onClick={addLine} data-testid="add-line">
            <PlusIcon aria-hidden />
            {t("addLine")}
          </Button>
        </div>
        {hasDuplicateProducts(usedProducts) ? (
          <p className="text-sm text-muted-foreground" data-testid="duplicate-notice">
            {t("duplicateNotice")}
          </p>
        ) : null}
        {submitted && customerId && dateValid && filled.length === 0 ? (
          <p className="text-sm text-destructive" role="alert" data-testid="error-lines">
            {t("errors.linesRequired")}
          </p>
        ) : null}
      </section>

      <div className="flex max-w-xl flex-col gap-2">
        <Label htmlFor="order-note">{t("internalNote")}</Label>
        <textarea
          id="order-note"
          value={note}
          maxLength={1000}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          data-testid="order-note"
        />
        <p className="text-sm text-muted-foreground">{t("internalNoteHint")}</p>
      </div>

      {serverError ? (
        <p className="text-sm text-destructive" role="alert" data-testid="order-error">
          {t(`errors.${serverError as "generic"}`)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() => save("CONFIRMED")}
          data-testid="order-save"
        >
          {t("saveConfirmed")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => save("DRAFT")}
          data-testid="order-save-draft"
        >
          {t("saveDraft")}
        </Button>
      </div>
    </form>
  );
}
