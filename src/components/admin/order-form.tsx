"use client";

import { AlertTriangleIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { ZoomableImage } from "@/components/shared/image-preview";
import { ImageUploader } from "@/components/shared/image-uploader";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isInsideWindow, isValidWindow } from "@/domain/delivery-window";
import {
  hasDuplicateProducts,
  orderWarnings,
  parseCalendarDate,
  parseQuantity,
} from "@/domain/order";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  confirmedOrderCountAction,
  createOrderAction,
  screenshotPreviewUrlAction,
  updateOrderAction,
} from "@/server/order-actions";

export type CustomerOption = ComboboxOption;
export type ProductOption = ComboboxOption & { unit: "KG" | "PACK" | "CRATE" | "PIECE" };

/** An existing order that is being edited (NUD-032). */
export type EditableOrder = {
  id: string;
  customerId: string;
  /** Planned day. */
  date: string;
  /** Requested delivery window (NUD-148). */
  windowFrom: string;
  windowTo: string;
  windowFromTime: string;
  windowToTime: string;
  status: "CONFIRMED" | "DRAFT";
  note: string;
  lines: Array<{ productId: string; quantity: string }>;
  /** Signed URL of the attached screenshot, shown read-only next to the form. */
  screenshotUrl: string | null;
};

type Props = {
  customers: CustomerOption[];
  products: ProductOption[];
  /** `YYYY-MM-DD`, from `getDefaultDeliveryDate()` (next delivery weekday). */
  defaultDate: string;
  /** Edit mode: the form is filled from this order; customer and screenshot cannot be changed. */
  order?: EditableOrder;
};

type Line = { key: number; productId: string | undefined; quantity: string };
type SaveStatus = "CONFIRMED" | "DRAFT";

const isBlank = (line: Line) => !line.productId && line.quantity.trim() === "";
const isComplete = (line: Line) => Boolean(line.productId) && parseQuantity(line.quantity) !== null;

const SERVER_ERRORS: Record<string, string> = {
  invalid: "invalid",
  not_found: "notFound",
  not_editable: "notEditable",
  date_in_past: "datePast",
  customer_not_found: "customerNotFound",
  customer_inactive: "customerInactive",
  product_not_found: "productNotFound",
  product_inactive: "productInactive",
  screenshot_missing: "screenshotMissing",
  screenshot_in_use: "screenshotInUse",
};

/** An uploaded screenshot: its storage key (sent on save) and a signed URL for the viewer. */
type Screenshot = { storageKey: string; url: string };

/**
 * Manual order entry: customer, delivery date, product lines (picker + quantity + unit). Keyboard
 * flow: Enter in a quantity adds the next line and focuses its product picker; quantities accept
 * `,` and `.`. Blank lines are ignored on save. The server validates everything again.
 *
 * Screenshot (NUD-031): can be uploaded, dropped or pasted (Ctrl+V anywhere on the page). With a
 * screenshot the page is a split view from 1024 px: zoomable image left, form right; stacked
 * (image above the form) on smaller screens. The order is saved with `source=SCREENSHOT`.
 *
 * Edit mode (NUD-032, `order` given): same fields and the same server validation; the customer is
 * fixed, the attached screenshot (if any) is shown read-only in the split view.
 */
export function OrderForm({ customers, products, defaultDate, order }: Props) {
  const t = useTranslations("admin.orders.form");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(order);
  const nextKey = useRef(order ? order.lines.length + 1 : 2);
  const focusKey = useRef<number | null>(null);
  const [customerId, setCustomerId] = useState<string | undefined>(order?.customerId);
  // Requested window (NUD-148). The planned day below stays empty = automatic unless the office sets it.
  const [windowFrom, setWindowFrom] = useState(order?.windowFrom ?? defaultDate);
  const [windowTo, setWindowTo] = useState(order?.windowTo ?? defaultDate);
  const [windowFromTime, setWindowFromTime] = useState(order?.windowFromTime ?? "");
  const [windowToTime, setWindowToTime] = useState(order?.windowToTime ?? "");
  const [plannedDay, setPlannedDay] = useState(order?.date ?? "");
  const windowTouched = useRef(Boolean(order));
  const plannedTouched = useRef(false);
  const [lines, setLines] = useState<Line[]>(
    order && order.lines.length > 0
      ? order.lines.map((l, i) => ({ key: i + 1, productId: l.productId, quantity: l.quantity }))
      : [{ key: 1, productId: undefined, quantity: "" }],
  );
  const [note, setNote] = useState(order?.note ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<Screenshot | null>(
    order?.screenshotUrl ? { storageKey: "", url: order.screenshotUrl } : null,
  );
  const [screenshotError, setScreenshotError] = useState(false);
  const [counted, setCounted] = useState<{ key: string; count: number } | null>(null);

  const customer = customers.find((c) => c.value === customerId);
  const productById = new Map(products.map((p) => [p.value, p]));
  const fromDate = parseCalendarDate(windowFrom);
  const toDate = parseCalendarDate(windowTo);
  const plannedDate = plannedDay ? parseCalendarDate(plannedDay) : null;
  const windowValid =
    fromDate !== null &&
    toDate !== null &&
    isValidWindow({
      from: fromDate,
      to: toDate,
      fromTime: windowFromTime || null,
      toTime: windowToTime || null,
    });
  const plannedValid = plannedDay === "" || plannedDate !== null;
  const dateValid = windowValid && plannedValid;
  // The day the order is expected on, for the "combined stop" hint and the list after saving.
  const date = plannedDay || windowFrom;
  const outsideWindow =
    plannedDate !== null && fromDate !== null && toDate !== null
      ? !isInsideWindow(plannedDate, { from: fromDate, to: toDate })
      : false;

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
    confirmedOrderCountAction(customerId, date, order?.id)
      .then((count) => {
        if (current) setCounted({ key: countKey, count });
      })
      .catch(() => {
        if (current) setCounted({ key: countKey, count: 0 });
      });
    return () => {
      current = false;
    };
  }, [countKey, customerId, date, order?.id]);
  const confirmedCount = counted && counted.key === countKey ? counted.count : 0;

  const warnings = customer ? orderWarnings({ confirmedOrdersOnDate: confirmedCount }) : [];
  const usedProducts = lines.map((l) => l.productId).filter((p): p is string => Boolean(p));

  /**
   * Next keeps the previous route (hidden) with its state, so the saved order's values, and above
   * all its screenshot, would still be there the next time "new order" is opened.
   */
  function resetForm() {
    setCustomerId(undefined);
    setWindowFrom(defaultDate);
    setWindowTo(defaultDate);
    setWindowFromTime("");
    setWindowToTime("");
    setPlannedDay("");
    windowTouched.current = false;
    plannedTouched.current = false;
    setLines([{ key: nextKey.current++, productId: undefined, quantity: "" }]);
    setNote("");
    setSubmitted(false);
    setServerError(null);
    setScreenshot(null);
    setScreenshotError(false);
    setCounted(null);
  }

  async function onScreenshotUploaded(image: { storageKey: string }) {
    setScreenshotError(false);
    try {
      const url = await screenshotPreviewUrlAction(image.storageKey);
      if (!url) throw new Error("no preview");
      setScreenshot({ storageKey: image.storageKey, url });
    } catch {
      setScreenshotError(true);
    }
  }

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
      ? windowValid
        ? "dateInvalid"
        : "windowInvalid"
      : filled.length === 0
        ? "linesRequired"
        : filled.some((l) => lineErrors(l) !== null)
          ? "invalid"
          : null;

  function save(status: SaveStatus) {
    setSubmitted(true);
    setServerError(null);
    if (formError !== null || !customerId) return;
    // Editing: a changed window without a touched planned day is planned again by the server.
    const windowChanged =
      order !== undefined &&
      (windowFrom !== order.windowFrom ||
        windowTo !== order.windowTo ||
        windowFromTime !== order.windowFromTime ||
        windowToTime !== order.windowToTime);
    const input = {
      customerId,
      deliveryDate: order && windowChanged && !plannedTouched.current ? "" : plannedDay,
      windowFrom,
      windowTo,
      windowFromTime,
      windowToTime,
      status,
      internalNote: note,
      screenshotKey: editing ? null : (screenshot?.storageKey ?? null),
      lines: filled.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    };
    startTransition(async () => {
      let result;
      try {
        result = order ? await updateOrderAction(order.id, input) : await createOrderAction(input);
      } catch {
        return setServerError("generic");
      }
      if (!result.ok) return setServerError(SERVER_ERRORS[result.error] ?? "generic");
      for (const warning of result.warnings) {
        toast.warning(t(`planWarnings.${warning}`, { date: result.plannedDate }));
      }
      if (order) {
        toast.success(t("savedChanges"));
        router.push(`/admin/orders/${order.id}`);
      } else {
        toast.success(t(result.status === "DRAFT" ? "savedDraft" : "savedConfirmed"));
        resetForm();
        router.push({
          pathname: "/admin/orders",
          query: { from: result.plannedDate, to: result.plannedDate },
        });
      }
      router.refresh();
    });
  }

  return (
    <div
      className={cn("flex flex-col gap-6", screenshot && "lg:grid lg:grid-cols-2 lg:items-start")}
      data-testid="order-entry"
      data-split={screenshot ? "true" : "false"}
    >
      {screenshot ? (
        <aside
          aria-label={t("screenshot.heading")}
          className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-4"
          data-testid="screenshot-pane"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">{t("screenshot.heading")}</h2>
            {editing ? null : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setScreenshot(null)}
                data-testid="screenshot-remove"
              >
                <XIcon aria-hidden />
                {t("screenshot.remove")}
              </Button>
            )}
          </div>
          <div className="relative h-[50dvh] overflow-hidden rounded-md bg-black lg:h-[calc(100dvh-17rem)] lg:min-h-80">
            <ZoomableImage src={screenshot.url} alt={t("screenshot.alt")} />
          </div>
          <p className="text-sm text-muted-foreground">{t("screenshot.zoomHint")}</p>
        </aside>
      ) : null}
      <form
        onSubmit={(event) => event.preventDefault()}
        className="flex min-w-0 max-w-3xl flex-col gap-8"
        noValidate
        data-testid="order-form"
      >
        {screenshot || editing ? null : (
          <section className="flex flex-col gap-2" aria-labelledby="order-screenshot">
            <h2 id="order-screenshot" className="text-xl font-semibold">
              {t("screenshot.heading")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("screenshot.hint")}</p>
            <ImageUploader
              purpose="screenshot"
              pasteAnywhere
              onUploaded={(image) => void onScreenshotUploaded(image)}
            />
            {screenshotError ? (
              <p className="text-sm text-destructive" role="alert" data-testid="screenshot-error">
                {t("screenshot.previewFailed")}
              </p>
            ) : null}
          </section>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="order-customer">{t("customer")}</Label>
            <Combobox
              id="order-customer"
              disabled={editing}
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
            {editing ? (
              <p className="text-sm text-muted-foreground" data-testid="customer-fixed">
                {t("customerFixed")}
              </p>
            ) : null}
            {submitted && !customerId ? (
              <p className="text-sm text-destructive" role="alert" data-testid="error-customer">
                {t("errors.customerRequired")}
              </p>
            ) : null}
          </div>
        </div>

        <fieldset
          className="flex max-w-3xl flex-col gap-3 rounded-md border border-input p-4"
          data-testid="order-window"
        >
          <legend className="px-1 text-base font-semibold">{t("window.heading")}</legend>
          <p className="text-sm text-muted-foreground">{t("window.hint")}</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="order-window-from">{t("window.from")}</Label>
              <Input
                id="order-window-from"
                type="date"
                value={windowFrom}
                onChange={(e) => {
                  const value = e.target.value;
                  windowTouched.current = true;
                  setWindowFrom(value);
                  if (windowTo < value || windowTo === windowFrom) setWindowTo(value);
                  setServerError(null);
                }}
                aria-invalid={(submitted && !windowValid) || undefined}
                required
                data-testid="order-window-from"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="order-window-to">{t("window.to")}</Label>
              <Input
                id="order-window-to"
                type="date"
                value={windowTo}
                min={windowFrom || undefined}
                onChange={(e) => {
                  windowTouched.current = true;
                  setWindowTo(e.target.value);
                  setServerError(null);
                }}
                aria-invalid={(submitted && !windowValid) || undefined}
                required
                data-testid="order-window-to"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="order-window-from-time">{t("window.fromTime")}</Label>
              <Input
                id="order-window-from-time"
                type="time"
                value={windowFromTime}
                onChange={(e) => {
                  windowTouched.current = true;
                  setWindowFromTime(e.target.value);
                  setServerError(null);
                }}
                data-testid="order-window-from-time"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="order-window-to-time">{t("window.toTime")}</Label>
              <Input
                id="order-window-to-time"
                type="time"
                value={windowToTime}
                onChange={(e) => {
                  windowTouched.current = true;
                  setWindowToTime(e.target.value);
                  setServerError(null);
                }}
                data-testid="order-window-to-time"
              />
            </div>
          </div>
          {submitted && !windowValid ? (
            <p className="text-sm text-destructive" role="alert" data-testid="error-window">
              {t("errors.windowInvalid")}
            </p>
          ) : null}
          <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="order-date">{t("date")}</Label>
            <Input
              id="order-date"
              type="date"
              value={plannedDay}
              onChange={(e) => {
                const value = e.target.value;
                plannedTouched.current = true;
                setPlannedDay(value);
                // Without a window of its own the chosen day is the window: the whole day.
                if (!windowTouched.current && value) {
                  setWindowFrom(value);
                  setWindowTo(value);
                }
                setServerError(null);
              }}
              aria-invalid={(submitted && !plannedValid) || undefined}
              data-testid="order-date"
            />
            <p className="text-sm text-muted-foreground">{t("dateHint")}</p>
            {submitted && !plannedValid ? (
              <p className="text-sm text-destructive" role="alert" data-testid="error-date">
                {t("errors.dateInvalid")}
              </p>
            ) : null}
            {outsideWindow ? (
              <p
                className="text-sm text-warning"
                role="status"
                data-testid="warning-outside-window"
              >
                {t("planWarnings.outside_window", { date: plannedDay })}
              </p>
            ) : null}
          </div>
        </fieldset>

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
                        inputMode="numeric"
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
    </div>
  );
}
