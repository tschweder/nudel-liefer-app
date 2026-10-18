"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CheckIcon,
  CircleParkingOffIcon,
  DoorClosedIcon,
  EllipsisIcon,
  HandIcon,
  type LucideIcon,
  MapPinOffIcon,
  ScaleIcon,
  Undo2Icon,
  UploadCloudIcon,
  UserXIcon,
  WifiOffIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  isWithinUndoWindow,
  nextPendingAfter,
  PROBLEM_NOTE_MAX,
  PROBLEM_REASONS,
  type ProblemReasonName,
} from "@/domain/stop-status";
import { useRouter } from "@/i18n/navigation";
import { createAppFormatters } from "@/lib/format";
import { requestOfflineSync } from "@/lib/offline/browser";
import { planUndo } from "@/lib/offline/outbox";
import { enqueueMutation, undoStopStatus, useOutbox } from "@/lib/offline/outbox-browser";
import { cn } from "@/lib/utils";

const REASON_ICONS: Record<ProblemReasonName, LucideIcon> = {
  CLOSED: DoorClosedIcon,
  NOBODY_THERE: UserXIcon,
  NO_PARKING: CircleParkingOffIcon,
  WRONG_QUANTITY: ScaleIcon,
  REFUSED: HandIcon,
  ADDRESS_NOT_FOUND: MapPinOffIcon,
  OTHER: EllipsisIcon,
};

const TOAST_MS = 10_000;

type StopForStatus = {
  id: string;
  customerName: string;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  problemReason: string | null;
  completedAt: string | null;
};

type TourStopForStatus = { id: string; sequence: number; status: string };

/** `Date.now()` that re-renders every `intervalMs`, so the undo button disappears by itself. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The big "Delivered" / "Problem" buttons of the stop screen (NUD-053), the problem sheet, the
 * result card with Undo, and the toast with Undo after a success.
 *
 * Offline queue (NUD-082): a tap is written to the outbox on the device (IndexedDB) and the screen
 * changes at once (the stop counts as done, the next one opens); the outbox sends it to
 * `POST /api/driver/sync` as soon as it can. Online this takes a fraction of a second, offline it
 * happens when the connection is back. Every tap has its own `clientMutationId`, so a resend can
 * never book a stop twice. Undo of a tap that is still queued removes it from the queue instead of
 * sending a delivered + undo pair; undo of a confirmed stop queues an undo.
 */
export function StopStatusActions({
  stop,
  tourStops,
  tourStatus,
  timezone,
  offline = false,
}: {
  stop: StopForStatus;
  /** All stops of the tour (queued taps already applied): decides which stop opens next. */
  tourStops: readonly TourStopForStatus[];
  tourStatus: string;
  timezone: string;
  /** Offline copy (NUD-081): an amber hint says that the tap is kept on the device. */
  offline?: boolean;
}) {
  const t = useTranslations("driver.status");
  const tReasons = useTranslations("common.problemReasons");
  const fmt = createAppFormatters(useFormatter(), timezone);
  const router = useRouter();
  const now = useNow(15_000);
  const outbox = useOutbox();

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reason, setReason] = useState<ProblemReasonName | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Runs `task` once at a time (a double tap is one tap); shows a message if the device cannot store. */
  async function guarded<T>(task: () => Promise<T>): Promise<T | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      return await task();
    } catch {
      setError(t("errors.storage"));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function undo(stopId: string, name: string) {
    const result = await guarded(() => undoStopStatus(stopId, name));
    if (!result || result === "none") return;
    requestOfflineSync();
    toast.success(t("undone"));
    router.push(`/driver/stops/${stopId}`);
  }

  async function complete(
    type: "delivered" | "problem",
    extra: { reason?: ProblemReasonName; note?: string } = {},
  ) {
    const entry = await guarded(() =>
      enqueueMutation({ type, stopId: stop.id, customerName: stop.customerName, ...extra }),
    );
    if (!entry) return;
    setSheetOpen(false);
    setReason(null);
    setNote("");
    const next = nextPendingAfter(
      tourStops.map((s) => ({ ...s, status: s.id === stop.id ? type.toUpperCase() : s.status })),
      stop.id,
    );
    toast(
      type === "delivered"
        ? t("deliveredToast", { name: stop.customerName })
        : t("problemToast", { name: stop.customerName }),
      {
        duration: TOAST_MS,
        style: { fontSize: 16 },
        // The last stop closes the tour and a completed tour cannot be reopened (NUD-053).
        action: next
          ? {
              label: t("undo"),
              onClick: () => void undo(stop.id, stop.customerName),
            }
          : undefined,
        actionButtonStyle: { height: 48, minWidth: 48, fontSize: 16, padding: "0 16px" },
      },
    );
    router.push(next ? `/driver/stops/${next.id}` : "/driver");
  }

  const queuedEntries = outbox.entries.filter((e) => e.stopId === stop.id);
  const waiting = queuedEntries.some((e) => !outbox.inFlight.has(e.clientMutationId));

  if (stop.status !== "PENDING") {
    const completedAt = stop.completedAt ? new Date(stop.completedAt) : null;
    // A completion that is still queued can always be taken back (the server never saw it); a
    // confirmed one only inside the window and while the tour is not completed (NUD-053).
    const tourDone = tourStops.every((s) => s.status !== "PENDING");
    const cancelable = planUndo(outbox.entries, stop.id, outbox.inFlight).action === "cancel";
    const canUndo =
      cancelable ||
      (!tourDone &&
        tourStatus !== "COMPLETED" &&
        completedAt !== null &&
        isWithinUndoWindow(completedAt, new Date(now)));
    const delivered = stop.status === "DELIVERED";
    return (
      <section
        className={cn(
          "space-y-3 rounded-xl border-2 p-4",
          delivered
            ? "border-green-600 bg-green-50 text-green-950 dark:bg-green-950/40 dark:text-green-50"
            : "border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50",
        )}
        data-testid="stop-result"
        data-status={stop.status}
        aria-label={t("actionsLabel")}
      >
        <p className="flex items-center gap-3 text-2xl font-bold" data-testid="stop-result-text">
          {delivered ? (
            <CheckCircle2Icon className="size-8 shrink-0" aria-hidden />
          ) : (
            <AlertTriangleIcon className="size-8 shrink-0" aria-hidden />
          )}
          <span>
            {delivered
              ? t("doneDelivered")
              : t("doneProblem", {
                  reason: stop.problemReason
                    ? tReasons(stop.problemReason as ProblemReasonName)
                    : t("problem"),
                })}
          </span>
        </p>
        {completedAt ? (
          <p className="text-base" data-testid="stop-result-time">
            {t("doneAt", { time: fmt.time(completedAt) })}
          </p>
        ) : null}
        {waiting ? (
          <p
            className="flex items-center gap-2 text-base font-semibold"
            data-testid="stop-pending-sync"
          >
            <UploadCloudIcon className="size-5 shrink-0" aria-hidden />
            {t("queuedHint")}
          </p>
        ) : null}
        {canUndo ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-14 w-full text-lg"
            disabled={busy}
            onClick={() => void undo(stop.id, stop.customerName)}
            data-testid="undo"
          >
            <Undo2Icon className="size-6" aria-hidden />
            {t("undo")}
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="text-base font-medium" data-testid="status-error">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="stop-actions" aria-label={t("actionsLabel")}>
      {offline ? (
        <p
          className="flex items-center gap-2 rounded-lg border-2 border-amber-500 bg-amber-50 p-3 text-base font-semibold text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
          data-testid="status-offline-notice"
        >
          <WifiOffIcon className="size-5 shrink-0" aria-hidden />
          {t("offlineNotice")}
        </p>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="min-h-20 w-full gap-3 bg-green-700 text-2xl font-bold text-white hover:bg-green-800 focus-visible:ring-green-900"
        disabled={busy}
        onClick={() => void complete("delivered")}
        data-testid="btn-delivered"
      >
        <CheckIcon className="size-9" aria-hidden />
        {t("delivered")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="min-h-16 w-full gap-3 border-2 border-amber-600 bg-amber-50 text-xl font-bold text-amber-950 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-50"
        disabled={busy}
        onClick={() => {
          setError(null);
          setSheetOpen(true);
        }}
        data-testid="btn-problem"
      >
        <AlertTriangleIcon className="size-7" aria-hidden />
        {t("problem")}
      </Button>
      {error && !sheetOpen ? (
        <p
          role="alert"
          className="text-base font-medium text-destructive"
          data-testid="status-error"
        >
          {error}
        </p>
      ) : null}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] overflow-y-auto rounded-t-2xl p-0"
          data-testid="problem-sheet"
        >
          <SheetHeader className="pe-14">
            <SheetTitle className="text-2xl">{t("problemTitle")}</SheetTitle>
            <SheetDescription>{t("problemDescription")}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4">
            <div
              role="group"
              aria-label={t("problemTitle")}
              className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2"
              data-testid="problem-reasons"
            >
              {PROBLEM_REASONS.map((value) => {
                const Icon = REASON_ICONS[value];
                const selected = reason === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setReason(value)}
                    className={cn(
                      "flex min-h-16 items-center gap-3 rounded-lg border-2 p-3 text-start text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      value === "OTHER" && "col-span-full",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:bg-muted",
                    )}
                    data-testid={`reason-${value}`}
                  >
                    <Icon className="size-7 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">{tReasons(value)}</span>
                  </button>
                );
              })}
            </div>
            <label className="block space-y-1.5">
              <span className="text-base font-semibold">{t("noteLabel")}</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={PROBLEM_NOTE_MAX}
                rows={3}
                placeholder={t("notePlaceholder")}
                className="block w-full resize-none rounded-lg border-2 bg-background p-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="problem-note"
              />
            </label>
            {error ? (
              <p
                role="alert"
                className="text-base font-medium text-destructive"
                data-testid="sheet-error"
              >
                {error}
              </p>
            ) : null}
            {/* Sticky: the thumb finds "Report problem" / "Cancel" at the bottom edge without scrolling the sheet. */}
            <div className="sticky bottom-0 -mx-4 grid gap-2 border-t bg-background px-4 pt-3 pb-4">
              <Button
                type="button"
                size="lg"
                className="min-h-14 text-lg font-bold"
                disabled={busy || reason === null}
                onClick={() => {
                  if (!reason) return;
                  const text = note.trim();
                  void complete("problem", { reason, ...(text ? { note: text } : {}) });
                }}
                data-testid="problem-submit"
              >
                <AlertTriangleIcon className="size-6" aria-hidden />
                {t("submit")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="min-h-14 text-lg"
                disabled={busy}
                onClick={() => setSheetOpen(false)}
                data-testid="problem-cancel"
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
