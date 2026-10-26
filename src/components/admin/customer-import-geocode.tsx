"use client";

import { MapPinIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { GEOCODE_BATCH_SIZE } from "@/domain/customer-import";
import {
  geocodeCustomersAction,
  listCustomersWithoutPinAction,
} from "@/server/customer-import-actions";

type Progress = {
  total: number;
  done: number;
  found: number;
  notFound: number;
  failed: number;
  low: number;
};
type Phase =
  | { name: "idle" }
  | { name: "running" }
  | { name: "cancelled" }
  | { name: "finished" }
  | { name: "stopped"; reason: "rate_limited" | "unavailable" }
  | { name: "error" };

const EMPTY: Progress = { total: 0, done: 0, found: 0, notFound: 0, failed: 0, low: 0 };

/**
 * Batch geocoding with a progress bar. The browser fetches the work list and asks for batches of
 * five customers one after the other; the server paces the geocoder calls (rate limit) and stops
 * at the provider's limit. Found points are stored as the customers' Adresspunkt; it starts by itself after an import
 * (NUD-141), the button repeats it for the customers that were not found.
 */
export function CustomerImportGeocode({ withoutPin }: { withoutPin: number }) {
  const t = useTranslations("admin.customers.import.geocode");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [progress, setProgress] = useState<Progress>(EMPTY);
  const cancelled = useRef(false);
  const autoStarted = useRef(false);

  async function start() {
    cancelled.current = false;
    setPhase({ name: "running" });
    let p = EMPTY;
    setProgress(p);
    try {
      const ids = await listCustomersWithoutPinAction();
      p = { ...EMPTY, total: ids.length };
      setProgress(p);
      for (let i = 0; i < ids.length; i += GEOCODE_BATCH_SIZE) {
        if (cancelled.current) return setPhase({ name: "cancelled" });
        const batch = ids.slice(i, i + GEOCODE_BATCH_SIZE);
        const result = await geocodeCustomersAction(batch);
        if (!result.ok) return setPhase({ name: "error" });
        const count = (s: string) => result.outcomes.filter((o) => o.status === s).length;
        p = {
          ...p,
          done: p.done + result.outcomes.length,
          found: p.found + count("found"),
          notFound: p.notFound + count("not_found"),
          failed: p.failed + count("failed"),
          low: p.low + result.outcomes.filter((o) => o.lowConfidence).length,
        };
        setProgress(p);
        if (result.stopped) return setPhase({ name: "stopped", reason: result.stopped });
      }
      setPhase({ name: "finished" });
    } catch {
      setPhase({ name: "error" });
    }
  }

  useEffect(() => {
    if (autoStarted.current || withoutPin === 0) return;
    autoStarted.current = true;
    void start();
    // Runs once on mount: the import has just finished and `start` reads its own fresh work list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = phase.name === "running";
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  const showBar = phase.name !== "idle";

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="geo-heading">
      <h3 id="geo-heading" className="text-xl font-semibold">
        {t("heading")}
      </h3>
      <p className="max-w-prose text-muted-foreground">{t("description")}</p>
      {withoutPin === 0 && phase.name === "idle" ? (
        <p data-testid="geocode-none">{t("none")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={start} disabled={running} data-testid="geocode-start">
            <MapPinIcon aria-hidden />
            {t("start", { count: withoutPin })}
          </Button>
          {running ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => (cancelled.current = true)}
              data-testid="geocode-cancel"
            >
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      )}
      {showBar ? (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label={t("progressLabel")}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            className="h-3 w-full overflow-hidden rounded-full bg-muted"
            data-testid="geocode-progress"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p aria-live="polite" data-testid="geocode-status">
            {t("progress", { done: progress.done, total: progress.total })}
          </p>
        </div>
      ) : null}
      {phase.name === "finished" ? (
        <p data-testid="geocode-finished">
          {t("finished", {
            found: progress.found,
            notFound: progress.notFound,
            failed: progress.failed,
          })}
        </p>
      ) : null}
      {phase.name === "finished" || phase.name === "cancelled" ? (
        progress.low > 0 ? (
          <p>{t("lowConfidence", { count: progress.low })}</p>
        ) : null
      ) : null}
      {phase.name === "cancelled" ? (
        <p role="status">{t("cancelled", { done: progress.done, total: progress.total })}</p>
      ) : null}
      {phase.name === "stopped" ? (
        <p role="alert" data-testid="geocode-stopped">
          {t(phase.reason === "rate_limited" ? "rateLimited" : "unavailable")}
        </p>
      ) : null}
      {phase.name === "error" ? <p role="alert">{t("error")}</p> : null}
    </section>
  );
}
