import { isCronAuthorized } from "./cron-auth";
import { getDb } from "./db";
import { todayIn } from "./orders";
import { generateRecurringOrders, type GenerationReport } from "./recurring-orders";
import { getFactoryTimezone } from "./settings";
import { getTourService } from "./tour-service";

export type RecurringCronDeps = {
  secret: string | undefined;
  run: () => Promise<GenerationReport>;
};

const noStore = { "Cache-Control": "no-store" };

/**
 * `GET /api/cron/recurring-orders` (NUD-149), run daily: generates the CONFIRMED orders of all
 * running recurring rules for the next `Settings.recurringLeadDays` days. Idempotent (one order
 * per rule and day), so a second run creates nothing. Bearer `CRON_SECRET` like the other cron
 * routes; fails closed without a configured secret.
 */
export async function handleRecurringCron(
  request: Request,
  deps: Partial<RecurringCronDeps> = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    if (!secret?.trim()) console.warn("[cron] CRON_SECRET is not set - rejecting cron requests");
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  try {
    const report = await (
      deps.run ??
      (async () =>
        generateRecurringOrders(getDb(), {
          today: todayIn(await getFactoryTimezone()),
          tours: getTourService(),
        }))
    )();
    console.info(`[recurring-orders] ${JSON.stringify(report)}`);
    return Response.json({ status: "ok", ...report }, { headers: noStore });
  } catch (error) {
    console.error("[recurring-orders] run failed:", error);
    return Response.json({ status: "error" }, { status: 503, headers: noStore });
  }
}
