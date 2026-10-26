import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClipboardListIcon,
  ImageOffIcon,
  MapPinOffIcon,
  RouteIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/page-header";
import { TodayCard } from "@/components/admin/today-card";
import { EmptyState, LoadingSkeleton } from "@/components/shared/states";
import { tourTone } from "@/components/shared/status";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import { Link } from "@/i18n/navigation";
import { type AppFormatters, createAppFormatters } from "@/lib/format";
import { tourHistoryQuery } from "@/server/audit-queries";
import { requirePageActor } from "@/server/auth/page-guards";
import { listCustomersQuery } from "@/server/customer-queries";
import { orderOverviewQuery } from "@/server/order-queries";
import { getDefaultDeliveryDate, getFactoryTimezone } from "@/server/settings";
import {
  getLivePollIntervalMs,
  type TodayProgress,
  todayProgressQuery,
} from "@/server/tour-progress";

/**
 * Dashboard "Übersicht" (re-design.md §8.2): an operations cockpit built from the data this page
 * already reads (`todayProgressQuery`) plus the audit history of today's tour. Stat tiles, today's
 * tour, what needs attention and the latest changes.
 *
 * The "Zu erledigen" groups of §8.2.3 additionally reuse two existing read queries unchanged —
 * `orderOverviewQuery` (drafts of the next delivery day) and `listCustomersQuery` (customers whose
 * photos or map pin are missing) — passed with filter inputs and read for their counts only
 * (`pageSize: 1`). No new aggregate and no new SQL: the same queries the Bestellungen and Kunden
 * pages use.
 */
async function Dashboard({ locale }: { locale: string }) {
  await requirePageActor("admin", locale);
  const t = await getTranslations({ locale });
  const fmt = createAppFormatters(await getFormatter({ locale }), await getFactoryTimezone());
  const nextDeliveryDate = await getDefaultDeliveryDate();
  const nextDeliveryDay = formatCalendarDate(nextDeliveryDate);
  const [today, missingPhotos, pinUnconfirmed, drafts] = await Promise.all([
    todayProgressQuery(),
    listCustomersQuery({ status: "active", photosMissing: true, pageSize: 1 }),
    listCustomersQuery({ status: "active", pinUnconfirmed: true, pageSize: 1 }),
    orderOverviewQuery({
      from: nextDeliveryDay,
      to: nextDeliveryDay,
      status: "DRAFT",
    }),
  ]);
  // Newest first, capped to the five shown. Only today's tour: a cross-tour feed has no query yet.
  const activity = today.tour ? (await tourHistoryQuery(today.tour.id)).slice(0, 5) : [];
  const attention = {
    missingPhotos: missingPhotos.total,
    pinUnconfirmed: pinUnconfirmed.total,
    drafts: { count: drafts.rows.length, date: nextDeliveryDay },
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.dashboard.title")}
        description={t("admin.dashboard.description")}
        titleTestId="admin-title"
      />
      <StatTiles today={today} t={t} />
      <div className="grid items-stretch gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <TodayCard today={today} pollIntervalMs={getLivePollIntervalMs()} />
        </div>
        <AttentionPanel today={today} attention={attention} fmt={fmt} t={t} />
      </div>
      <ActivityPanel entries={activity} fmt={fmt} t={t} />
    </div>
  );
}

type Translate = Awaited<ReturnType<typeof getTranslations>>;

/** The three KPI tiles the existing data can fill, each linking to today's tour (re-design.md §8.2). */
function StatTiles({ today, t }: { today: TodayProgress; t: Translate }) {
  const { tour } = today;
  const tourHref = `/admin/tours?date=${today.date}`;
  const progress = tour?.progress;
  const problems = progress?.problems ?? 0;
  const statusLabel = tour
    ? t(`common.statuses.tour.${tour.status}`)
    : t("admin.dashboard.tiles.noTour");

  return (
    <section
      aria-label={t("admin.dashboard.tiles.title")}
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {/* "erledigt" (delivered + problems) is the numerator of the percentage the card below shows
          as well — "geliefert" used to leave the tile at "2 / 6 (50 %)" while the card said
          "3 von 6 Stopps erledigt (50 %)" (round-3 review). */}
      <StatTile
        data-testid="stat-delivered"
        label={t("admin.dashboard.tiles.done")}
        value={`${progress?.done ?? 0} / ${progress?.total ?? 0}`}
        sub={
          progress ? t("admin.dashboard.today.percent", { percent: progress.percent }) : undefined
        }
        icon={CircleCheckIcon}
        tone="success"
        href={tourHref}
      />
      <StatTile
        data-testid="stat-problems"
        label={t("admin.dashboard.tiles.problems")}
        value={problems}
        sub={t("admin.dashboard.tiles.problemsSub")}
        icon={problems > 0 ? TriangleAlertIcon : CircleAlertIcon}
        tone={problems > 0 ? "warning" : "neutral"}
        href={tourHref}
      />
      <StatTile
        data-testid="stat-tour"
        label={t("admin.dashboard.tiles.tour")}
        value={statusLabel}
        sub={tour ? undefined : t("admin.dashboard.tiles.tourSub")}
        icon={RouteIcon}
        tone={tour ? tourTone(tour.status) : "neutral"}
        href={tourHref}
      />
    </section>
  );
}

/** "Zu erledigen" — the three groups §8.2.3 asks for, all from existing read queries. */
function AttentionPanel({
  today,
  attention,
  fmt,
  t,
}: {
  today: TodayProgress;
  attention: {
    missingPhotos: number;
    pinUnconfirmed: number;
    drafts: { count: number; date: string };
  };
  fmt: AppFormatters;
  t: Translate;
}) {
  const problems = today.tour?.problemStops ?? [];
  const late = today.lateOrderCount;
  const tourHref = `/admin/tours?date=${today.date}`;
  const { missingPhotos, pinUnconfirmed, drafts } = attention;
  const empty =
    problems.length === 0 &&
    late === 0 &&
    missingPhotos === 0 &&
    pinUnconfirmed === 0 &&
    drafts.count === 0;

  return (
    <Card className="h-full" data-testid="attention-card">
      <CardHeader>
        {/* Card titles are `h2` so the outline never skips a level (re-design.md §9.2). */}
        <h2 className="text-lg font-semibold tracking-tight">
          {t("admin.dashboard.attention.title")}
        </h2>
      </CardHeader>
      <CardContent>
        {empty ? (
          <EmptyState
            icon={CheckCircle2Icon}
            title={t("admin.dashboard.attention.emptyTitle")}
            description={t("admin.dashboard.attention.emptyDescriptionAll")}
            className="border-0 p-0"
          />
        ) : (
          <ul className="flex flex-col">
            {problems.map((problem) => (
              <li
                key={problem.id}
                data-testid="attention-problem"
                className="flex items-start gap-3 border-b border-border py-3 last:border-b-0"
              >
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={tourHref}
                    className="truncate rounded-sm font-medium outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {problem.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {problem.reason
                      ? t(`common.problemReasons.${problem.reason}`)
                      : t("admin.dashboard.attention.reasonUnknown")}
                  </span>
                </div>
              </li>
            ))}
            {drafts.count > 0 ? (
              <AttentionItem
                testId="attention-draft-orders"
                icon={ClipboardListIcon}
                href={{
                  pathname: "/admin/orders" as const,
                  query: { from: drafts.date, to: drafts.date, status: "DRAFT" },
                }}
                label={t("admin.dashboard.attention.unconfirmedOrders", { count: drafts.count })}
                hint={t("admin.dashboard.attention.unconfirmedOrdersHint", {
                  date: fmt.calendarDate(parseCalendarDate(drafts.date) ?? new Date(drafts.date)),
                })}
              />
            ) : null}
            {late > 0 ? (
              <AttentionItem
                testId="attention-late-orders"
                icon={ClipboardListIcon}
                href={tourHref}
                label={t("admin.dashboard.attention.lateOrders", { count: late })}
                hint={t("admin.dashboard.attention.lateOrdersHint")}
              />
            ) : null}
            {missingPhotos > 0 ? (
              <AttentionItem
                testId="attention-missing-photos"
                icon={ImageOffIcon}
                href={{
                  pathname: "/admin/customers" as const,
                  query: { photos: "missing" },
                }}
                label={t("admin.dashboard.attention.missingPhotos", { count: missingPhotos })}
                hint={t("admin.dashboard.attention.missingPhotosHint")}
              />
            ) : null}
            {pinUnconfirmed > 0 ? (
              <AttentionItem
                testId="attention-pin-unconfirmed"
                icon={MapPinOffIcon}
                href={{
                  pathname: "/admin/customers" as const,
                  query: { pin: "unconfirmed" },
                }}
                label={t("admin.dashboard.attention.pinUnconfirmed", { count: pinUnconfirmed })}
                hint={t("admin.dashboard.attention.pinUnconfirmedHint")}
              />
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** One "Zu erledigen" row: an icon, a linked count and a one-line explanation. */
function AttentionItem({
  testId,
  icon: Icon,
  href,
  label,
  hint,
}: {
  testId: string;
  icon: typeof TriangleAlertIcon;
  href: React.ComponentProps<typeof Link>["href"];
  label: string;
  hint: string;
}) {
  return (
    <li
      data-testid={testId}
      className="flex items-start gap-3 border-b border-border py-3 last:border-b-0"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="flex min-w-0 flex-col">
        <Link
          href={href}
          className="rounded-sm font-medium outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </Link>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </div>
    </li>
  );
}

/** Last five audit entries of today's tour, timeline-style compact list (re-design.md §8.2/§8.4). */
function ActivityPanel({
  entries,
  fmt,
  t,
}: {
  entries: Array<{ id: string; at: string; action: string; actor: { name: string } | null }>;
  fmt: AppFormatters;
  t: Translate;
}) {
  return (
    <Card data-testid="activity-card">
      <CardHeader>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("admin.dashboard.activity.title")}
        </h2>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-base text-muted-foreground">{t("admin.dashboard.activity.empty")}</p>
        ) : (
          <ol className="flex flex-col">
            {entries.map((entry) => (
              <li
                key={entry.id}
                data-testid="activity-entry"
                data-action={entry.action}
                className="flex flex-wrap items-baseline gap-x-3 border-b border-border py-2.5 last:border-b-0"
              >
                <time
                  dateTime={entry.at}
                  className="w-40 shrink-0 text-sm tabular-nums text-muted-foreground"
                >
                  {fmt.dateTime(new Date(entry.at))}
                </time>
                <span className="min-w-0 flex-1 text-base">
                  {t(`admin.history.actions.${entry.action.replace(".", "_")}`)}
                </span>
                {entry.actor ? (
                  <span className="shrink-0 text-sm text-muted-foreground">{entry.actor.name}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AdminDashboardPage({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Dashboard locale={locale} />
    </Suspense>
  );
}
