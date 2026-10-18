import { describe, expect, it } from "vitest";

import {
  beforeSend,
  eventMessage,
  isNoiseError,
  redactText,
  redactUrl,
  scrubBreadcrumb,
  scrubEvent,
  scrubValue,
} from "./sentry-scrub";

const SIGNED =
  "https://abc.eu.r2.cloudflarestorage.com/nudel-photos/customers/1.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F2026&X-Amz-Signature=deadbeef";

describe("redactUrl / redactText", () => {
  it("removes query strings and fragments", () => {
    expect(redactUrl(SIGNED)).toBe(
      "https://abc.eu.r2.cloudflarestorage.com/nudel-photos/customers/1.jpg?[Filtered]",
    );
    expect(redactUrl("https://app.example/de/driver#token=abc")).toBe(
      "https://app.example/de/driver",
    );
    expect(redactUrl("/de/driver")).toBe("/de/driver");
  });
  it("finds URLs, signatures and bearer tokens inside free text", () => {
    const text = redactText(
      `failed to load ${SIGNED} and then X-Amz-Signature=abc123 Bearer abcdefghijkl1234`,
    );
    expect(text).not.toContain("deadbeef");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("abcdefghijkl1234");
    expect(text).toContain("customers/1.jpg");
  });
});

describe("scrubValue", () => {
  it("blanks sensitive keys at any depth and clips long strings", () => {
    const out = scrubValue({
      ok: "fine",
      password: "hunter2",
      pin: "123456",
      nested: {
        sessionToken: "x",
        authorization: "Bearer y",
        cookie: "a=b",
        list: [{ apiKey: "k" }],
      },
      long: "x".repeat(2000),
    }) as Record<string, unknown>;
    const json = JSON.stringify(out);
    for (const secret of ["hunter2", "123456", "Bearer y", "a=b", '"k"']) {
      expect(json).not.toContain(secret);
    }
    expect(out.ok).toBe("fine");
    expect((out.long as string).length).toBeLessThan(600);
  });
  it("stops at a depth limit", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i++) deep = { a: deep };
    expect(JSON.stringify(scrubValue(deep))).toContain("[Filtered]");
  });
});

describe("scrubBreadcrumb", () => {
  it("drops console breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "console", message: "PIN 123456" })).toBeNull();
  });
  it("strips query strings from fetch breadcrumbs and drops bodies", () => {
    const b = scrubBreadcrumb({
      category: "fetch",
      data: { url: SIGNED, method: "PUT", status_code: 200, body: "secret", request_body_size: 5 },
    })!;
    expect(JSON.stringify(b)).not.toContain("deadbeef");
    expect((b.data as Record<string, unknown>).method).toBe("PUT");
    expect(b.data).not.toHaveProperty("body");
  });
  it("keeps navigation targets without their query", () => {
    const b = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/de?a=1", to: "/de/driver?pin=1" },
    })!;
    expect(b.data).toEqual({ from: "/de?[Filtered]", to: "/de/driver?[Filtered]" });
  });
});

describe("scrubEvent", () => {
  const hostile = {
    event_id: "1",
    message: `boom ${SIGNED}`,
    exception: { values: [{ type: "Error", value: `bad ${SIGNED}`, stacktrace: { frames: [] } }] },
    user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4", username: "driver1" },
    request: {
      method: "POST",
      url: "https://app.example/de/driver/login?callbackUrl=/x&pin=123456",
      query_string: "pin=123456",
      data: { username: "driver1", pin: "123456", password: "pw" },
      cookies: { "authjs.session-token": "jwt" },
      headers: {
        cookie: "authjs.session-token=jwt",
        authorization: "Bearer abc",
        "user-agent": "UA",
        "x-forwarded-for": "1.2.3.4",
      },
      env: { REMOTE_ADDR: "1.2.3.4" },
    },
    extra: { form: { password: "pw" }, signedUrl: SIGNED },
    contexts: { browser: { name: "Chrome" }, custom: { token: "t", fine: 1 } },
    tags: { route: "/de/driver", secretTag: SIGNED },
    breadcrumbs: [
      { category: "console", message: "x" },
      { category: "xhr", data: { url: SIGNED, method: "GET" } },
    ],
    server_name: "machine-1",
  };

  it("removes everything that identifies a person or authorises a request", () => {
    const out = scrubEvent(hostile) as Record<string, unknown>;
    const json = JSON.stringify(out);
    for (const needle of [
      "123456",
      "hunter",
      "pw",
      "jwt",
      "Bearer abc",
      "1.2.3.4",
      "a@b.c",
      "driver1",
      "deadbeef",
      "AKIA",
      "machine-1",
      "callbackUrl",
    ]) {
      expect(json, needle).not.toContain(needle);
    }
    expect(out).not.toHaveProperty("user");
    const request = out.request as Record<string, unknown>;
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ "user-agent": "UA" });
    expect(request).not.toHaveProperty("data");
    expect(request).not.toHaveProperty("cookies");
    expect(request).not.toHaveProperty("query_string");
    expect((out.breadcrumbs as unknown[]).length).toBe(1);
    expect((out.contexts as Record<string, unknown>).browser).toEqual({ name: "Chrome" });
  });

  it("does not mutate its input", () => {
    const copy = JSON.stringify(hostile);
    scrubEvent(hostile);
    expect(JSON.stringify(hostile)).toBe(copy);
  });

  it("copes with odd shapes without throwing", () => {
    expect(() =>
      scrubEvent({ request: "x", exception: 5, breadcrumbs: [null, 1], extra: [] }),
    ).not.toThrow();
    expect(scrubEvent({})).toEqual({});
  });
});

describe("noise filter and beforeSend", () => {
  const event = (type: string, value: string) => ({ exception: { values: [{ type, value }] } });
  it("drops offline / aborted network errors", () => {
    for (const [type, value] of [
      ["TypeError", "Failed to fetch"],
      ["TypeError", "Load failed"],
      ["TypeError", "NetworkError when attempting to fetch resource."],
      ["AbortError", "The operation was aborted."],
    ] as const) {
      expect(beforeSend(event(type, value)), value).toBeNull();
    }
    expect(isNoiseError("ResizeObserver loop completed with undelivered notifications.")).toBe(
      true,
    );
  });
  it("keeps real errors and scrubs them", () => {
    const kept = beforeSend({ ...event("Error", `test ${SIGNED}`), user: { id: "1" } });
    expect(kept).not.toBeNull();
    expect(JSON.stringify(kept)).not.toContain("deadbeef");
    expect(kept).not.toHaveProperty("user");
    expect(eventMessage(event("Error", "x"))).toBe("Error: x");
  });
});
