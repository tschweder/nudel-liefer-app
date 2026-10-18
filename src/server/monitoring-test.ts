import { isSentryEnabled } from "@/lib/sentry-config";

import { isCronAuthorized } from "./cron-auth";

/** The error that `GET /api/monitoring/test-error` raises on purpose. */
export class MonitoringTestError extends Error {
  constructor(mode: string) {
    super(`Forced monitoring test error (mode=${mode}). Nothing is broken.`);
    this.name = "MonitoringTestError";
  }
}

export type MonitoringTestDeps = {
  secret: string | undefined;
  dsn: string | undefined;
  /** Sends the error to Sentry and waits for delivery; returns the event id. */
  capture: (error: Error) => Promise<{ eventId: string | undefined; delivered: boolean }>;
};

const noStore = { "Cache-Control": "no-store" };

async function captureWithSentry(error: Error) {
  const Sentry = await import("@sentry/nextjs");
  const eventId = Sentry.captureException(error, { tags: { monitoring_test: "true" } });
  const delivered = await Sentry.flush(5000);
  return { eventId, delivered };
}

/**
 * `GET /api/monitoring/test-error` (NUD-094): raises a test error so the person who set up Sentry
 * can see it arrive. Protected by `Authorization: Bearer $CRON_SECRET` like the cron routes (fails
 * closed without a secret); no session, no role, no cookies involved, so it is CSRF-proof.
 *
 * - default: the error is captured explicitly, the answer reports the Sentry event id;
 * - `?mode=throw`: the handler throws, which exercises Next.js' own `onRequestError` path
 *   (answer: 500, the event arrives with the request's route).
 * Without `SENTRY_DSN` nothing is raised and the answer says so.
 */
export async function handleMonitoringTest(
  request: Request,
  deps: Partial<MonitoringTestDeps> = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const dsn = "dsn" in deps ? deps.dsn : process.env.SENTRY_DSN;
  if (!isSentryEnabled(dsn)) {
    return Response.json(
      { status: "disabled", hint: "SENTRY_DSN is not set (or invalid) on this deployment" },
      { headers: noStore },
    );
  }
  const mode = new URL(request.url).searchParams.get("mode") === "throw" ? "throw" : "capture";
  const error = new MonitoringTestError(mode);
  if (mode === "throw") throw error;
  const { eventId, delivered } = await (deps.capture ?? captureWithSentry)(error);
  return Response.json(
    { status: "sent", eventId: eventId ?? null, delivered },
    { headers: noStore },
  );
}
