// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { isCronAuthorized } from "./cron-auth";
import { handleRetryTranslationsCron } from "./translation-cron";
import { FakeTranslator } from "./translator/fake";
import type { Translator } from "./translator/types";

const SECRET = "s3cret-value-for-tests";
const req = (authorization?: string) =>
  new Request("http://localhost/api/cron/retry-translations", {
    headers: authorization ? { authorization } : {},
  });
const deepl: Translator = { kind: "deepl", translate: async (t) => t };
const report = { translated: 2, failed: 0, skipped: 0, sources: {} };

describe("isCronAuthorized", () => {
  it("accepts exactly the bearer secret", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isCronAuthorized(null, SECRET)).toBe(false);
  });
  it("fails closed without a configured secret", () => {
    expect(isCronAuthorized("Bearer ", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer x", "")).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized(null, "  ")).toBe(false);
  });
});

describe("GET /api/cron/retry-translations", () => {
  it("rejects missing and wrong credentials without touching the database", async () => {
    const run = vi.fn();
    const db = vi.fn();
    for (const header of [undefined, "Bearer wrong", `Bearer ${SECRET}!`, "Bearer"]) {
      const res = await handleRetryTranslationsCron(req(header), {
        secret: SECRET,
        translator: () => deepl,
        db: db as never,
        run: run as never,
      });
      expect(res.status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
    expect(db).not.toHaveBeenCalled();
  });

  it("rejects everything when CRON_SECRET is not configured", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn();
    const res = await handleRetryTranslationsCron(req("Bearer anything"), {
      secret: undefined,
      run: run as never,
    });
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the job for the right secret and returns the report", async () => {
    const run = vi.fn(async () => report);
    const res = await handleRetryTranslationsCron(req(`Bearer ${SECRET}`), {
      secret: SECRET,
      translator: () => deepl,
      db: (() => ({})) as never,
      run: run as never,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", ...report });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips (nothing is faked) while only the Fake translator is configured", async () => {
    const run = vi.fn();
    const res = await handleRetryTranslationsCron(req(`Bearer ${SECRET}`), {
      secret: SECRET,
      translator: () => new FakeTranslator(),
      run: run as never,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "skipped" });
    expect(run).not.toHaveBeenCalled();
  });

  it("is wired as the GET handler of the route file and protected by CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const { GET, maxDuration } = await import("@/app/api/cron/retry-translations/route");
    expect(maxDuration).toBeLessThanOrEqual(60);
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    vi.unstubAllEnvs();
  });
});
