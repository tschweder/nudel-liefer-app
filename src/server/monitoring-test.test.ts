// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { handleMonitoringTest, MonitoringTestError } from "./monitoring-test";

const SECRET = "monitoring-test-secret-0123456789abcdef";
const DSN = "https://key@o1.ingest.de.sentry.io/1";
const req = (auth?: string, query = "") =>
  new Request(`http://localhost/api/monitoring/test-error${query}`, {
    headers: auth ? { authorization: auth } : {},
  });

describe("GET /api/monitoring/test-error", () => {
  it("rejects everything but the exact bearer secret, before touching Sentry", async () => {
    const capture = vi.fn();
    for (const auth of [undefined, "Bearer wrong", SECRET, `Bearer ${SECRET}x`, "Basic abc"]) {
      const res = await handleMonitoringTest(req(auth), { secret: SECRET, dsn: DSN, capture });
      expect(res.status, String(auth)).toBe(401);
    }
    // No secret configured: nobody is authorized, not even an empty bearer.
    expect(
      (await handleMonitoringTest(req("Bearer "), { secret: undefined, dsn: DSN, capture })).status,
    ).toBe(401);
    expect(capture).not.toHaveBeenCalled();
  });

  it("does nothing and says so when Sentry is not configured", async () => {
    const capture = vi.fn();
    const res = await handleMonitoringTest(req(`Bearer ${SECRET}`), {
      secret: SECRET,
      dsn: undefined,
      capture,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "disabled" });
    expect(capture).not.toHaveBeenCalled();
    const throwing = await handleMonitoringTest(req(`Bearer ${SECRET}`, "?mode=throw"), {
      secret: SECRET,
      dsn: "garbage",
      capture,
    });
    expect(throwing.status).toBe(200);
  });

  it("captures the forced error and reports the event id", async () => {
    const capture = vi.fn(async (error: Error) => {
      void error;
      return { eventId: "abc123", delivered: true };
    });
    const res = await handleMonitoringTest(req(`Bearer ${SECRET}`), {
      secret: SECRET,
      dsn: DSN,
      capture,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "sent", eventId: "abc123", delivered: true });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]![0]).toBeInstanceOf(MonitoringTestError);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("throws in mode=throw so that Next.js' onRequestError sees it", async () => {
    const capture = vi.fn();
    await expect(
      handleMonitoringTest(req(`Bearer ${SECRET}`, "?mode=throw"), {
        secret: SECRET,
        dsn: DSN,
        capture,
      }),
    ).rejects.toBeInstanceOf(MonitoringTestError);
    expect(capture).not.toHaveBeenCalled();
  });
});
