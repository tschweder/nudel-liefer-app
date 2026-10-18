"use client";

import { RouteIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { createFollowUpTourAction } from "@/server/tour-actions";
import type { TourPlan } from "@/server/tour-planning";

import { TourDiffList } from "./tour-diff-list";

/**
 * Late orders on the planning page (NUD-099). Orders confirmed after every tour of the day was
 * COMPLETED are on no stop; the office sees them here and creates a follow-up tour (a second tour
 * for the same date) for them. Edits to orders of already delivered stops are listed as well; they
 * are not delivered by the follow-up tour.
 */
export function LateOrdersBanner({ plan }: { plan: TourPlan }) {
  const t = useTranslations("admin.tours.late");
  const te = useTranslations("admin.tours.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { late } = plan;
  if (late.lateOrders.length === 0 && late.conflicts.length === 0) return null;
  const unroutable = late.lateOrders.filter((o) => !o.routable);

  function create() {
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await createFollowUpTourAction({ date: plan.date });
      } catch {
        return setError("generic");
      }
      if (!result.ok) {
        setError(result.error);
        if (["conflict", "follow_up_not_allowed", "no_late_orders"].includes(result.error)) {
          router.refresh();
        }
        return;
      }
      toast.success(t("created", { count: result.stopCount }));
      router.replace({ pathname: "/admin/tours", query: { date: plan.date, tour: result.tourId } });
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="late-orders">
      {late.lateOrders.length > 0 ? (
        <Alert variant="destructive" data-testid="late-orders-banner">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{t("title")}</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{t("body", { count: late.lateOrderCount })}</p>
            <TourDiffList
              diff={{ added: late.lateOrders, removed: [], changed: [], completedChanged: [] }}
              addedHeading={t("listHeading", { count: late.lateOrders.length })}
            />
            {unroutable.length > 0 ? (
              <div data-testid="late-orders-unrouted">
                <p>{t("unrouted")}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {unroutable.map((o) => (
                    <li key={o.customerId}>
                      <Link
                        href={`/admin/customers/${o.customerId}`}
                        className="font-medium underline"
                      >
                        {o.name} ({o.customerNumber})
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {error ? (
              <p className="font-medium" role="alert" data-testid="late-orders-error">
                {te.has(error) ? te(error) : te("generic")}
              </p>
            ) : null}
            <div>
              <Button
                type="button"
                onClick={create}
                disabled={pending || !late.canCreateFollowUp}
                data-testid="create-follow-up"
              >
                <RouteIcon aria-hidden />
                {pending ? t("creating") : t("create")}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {late.conflicts.length > 0 ? (
        <Alert data-testid="delivered-conflicts">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>{t("conflictTitle")}</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{t("conflictBody")}</p>
            <TourDiffList
              diff={{ added: [], removed: [], changed: [], completedChanged: late.conflicts }}
            />
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** Tabs of the tours of one day (shown when there are several). */
export function TourTabs({ plan }: { plan: TourPlan }) {
  const t = useTranslations("admin.tours.tabs");
  const tc = useTranslations("common");
  if (plan.tours.length < 2) return null;
  return (
    <nav aria-label={t("label")} data-testid="tour-tabs">
      <ul className="flex flex-wrap gap-2">
        {plan.tours.map((tab) => {
          const current = tab.id === plan.tour?.id;
          return (
            <li key={tab.id}>
              <Link
                href={{ pathname: "/admin/tours", query: { date: plan.date, tour: tab.id } }}
                aria-current={current ? "page" : undefined}
                data-testid="tour-tab"
                data-tour-id={tab.id}
                data-status={tab.status}
                className={
                  "inline-flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-base font-medium " +
                  (current ? "border-primary bg-primary text-primary-foreground" : "bg-background")
                }
              >
                {tab.number === 1 ? t("first") : t("followUp", { number: tab.number })}
                <span className="text-sm font-normal">
                  {tc(`statuses.tour.${tab.status}`)} · {t("stops", { count: tab.stopCount })}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
