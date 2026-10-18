import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

/**
 * NUD-094: Sentry wiring against the local stand-in for the ingest endpoint
 * (`scripts/mock-sentry-ingest.ts`). Skipped unless E2E_SENTRY_LOG names the mock's log file,
 * because it needs a build made WITH `SENTRY_DSN=http://publickey@localhost:9999/1`, a server
 * started with the same variable, `CRON_SECRET` and `ENABLE_ERROR_TEST_PAGES=true`
 * (docs/runbook.md "Check Sentry locally"). Proves: server, route-handler and browser errors
 * arrive, nothing personal is in the payload, and the CSP lets the browser send.
 */
const logFile = process.env.E2E_SENTRY_LOG;
test.skip(!logFile, "needs the mock Sentry ingest and a DSN build (see docs/runbook.md)");
test.describe.configure({ mode: "serial" });

const cronSecret = process.env.CRON_SECRET ?? "";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

type Received = { receivedFrom: string; event: Record<string, unknown> };
const received = (): Received[] =>
  readFileSync(logFile!, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Received);

const text = (e: Received) => JSON.stringify(e.event);

async function waitForEvent(match: (e: Received) => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = received().find(match);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `no matching Sentry event within ${timeoutMs} ms; got ${received().length} events`,
  );
}

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  const form = page.getByTestId("admin-login-form");
  await form.locator('input[name="email"]').fill("admin@example.com");
  await form.locator('input[name="password"]').fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Nothing that identifies a person or authorises a request may be in any event. */
function expectNoPersonalData(e: Received) {
  const json = text(e);
  for (const needle of [
    "authjs.session-token",
    "authjs.csrf-token",
    adminPassword,
    "admin@example.com",
    cronSecret,
    "Bearer ",
    "X-Amz-Signature",
  ]) {
    if (needle) expect(json, `event contains ${needle}`).not.toContain(needle);
  }
  expect(e.event).not.toHaveProperty("user");
  const request = e.event.request as Record<string, unknown> | undefined;
  for (const key of ["cookies", "data", "query_string"])
    expect(request ?? {}).not.toHaveProperty(key);
}

test("a forced test error sent by the secret-protected route arrives", async ({ request }) => {
  const denied = await request.get("/api/monitoring/test-error");
  expect(denied.status()).toBe(401);
  const res = await request.get("/api/monitoring/test-error", {
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("sent");
  expect(body.eventId).toMatch(/^[0-9a-f]{32}$/);
  const hit = await waitForEvent(
    (e) => (e.event.tags as Record<string, string> | undefined)?.monitoring_test === "true",
  );
  expect(text(hit)).toContain("MonitoringTestError");
  expect(hit.event.environment).toBeTruthy();
  expectNoPersonalData(hit);
});

test("an unhandled error in a route handler is reported through onRequestError", async ({
  request,
}) => {
  const res = await request.get("/api/monitoring/test-error?mode=throw", {
    headers: { authorization: `Bearer ${cronSecret}`, cookie: "authjs.session-token=SECRETCOOKIE" },
  });
  expect(res.status()).toBe(500);
  const hit = await waitForEvent((e) => text(e).includes("mode=throw"));
  expect(text(hit)).not.toContain("SECRETCOOKIE");
  expectNoPersonalData(hit);
});

test("a page error is reported once from the server (no duplicate from the browser) and a browser error from the browser", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(m.text()))
      violations.push(m.text());
  });
  await loginAdmin(page);
  await page.goto("/de/admin/dev/error");
  await expect(page.getByTestId("admin-error")).toBeVisible();
  const pageError = await waitForEvent((e) =>
    text(e).includes("Forced test error from /admin/dev/error"),
  );
  expectNoPersonalData(pageError);
  await page.waitForTimeout(2000);
  expect(
    received().filter((e) => text(e).includes("Forced test error from /admin/dev/error")),
  ).toHaveLength(1);

  // A plain uncaught error in the browser: reaches the ingest endpoint straight from the page.
  const marker = `client-forced-${Date.now()}`;
  await page.evaluate((m) => {
    setTimeout(() => {
      throw new Error(m);
    });
  }, marker);
  const clientError = await waitForEvent((e) => text(e).includes(marker));
  // platform "javascript" = the browser SDK (the server SDK reports "node").
  expect(clientError.event.platform).toBe("javascript");
  expectNoPersonalData(clientError);
  expect(violations).toEqual([]);
});
