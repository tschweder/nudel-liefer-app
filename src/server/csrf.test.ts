// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isSameOriginRequest, rejectCrossOrigin } from "./csrf";

const req = (headers: Record<string, string>) =>
  new Request("https://app.example.com/api/uploads", { method: "POST", headers });

describe("isSameOriginRequest", () => {
  it("accepts the own origin", () => {
    expect(isSameOriginRequest(req({ origin: "https://app.example.com" }))).toBe(true);
    expect(
      isSameOriginRequest(
        req({ origin: "https://app.example.com", "sec-fetch-site": "same-origin" }),
      ),
    ).toBe(true);
  });

  it("rejects another origin, 'null' and malformed origins", () => {
    expect(isSameOriginRequest(req({ origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginRequest(req({ origin: "https://app.example.com.evil.example" }))).toBe(
      false,
    );
    expect(isSameOriginRequest(req({ origin: "http://app.example.com:8080" }))).toBe(false);
    expect(isSameOriginRequest(req({ origin: "null" }))).toBe(false);
    expect(isSameOriginRequest(req({ origin: "not a url" }))).toBe(false);
  });

  it("rejects cross-site and same-site fetch metadata even without Origin", () => {
    expect(isSameOriginRequest(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("lets non-browser clients (no Origin, no fetch metadata) through", () => {
    expect(isSameOriginRequest(req({}))).toBe(true);
  });

  it("compares against the forwarded host behind a proxy", () => {
    const behindProxy = new Request("http://internal:3000/api/uploads", {
      method: "POST",
      headers: { origin: "https://app.example.com", "x-forwarded-host": "app.example.com" },
    });
    expect(isSameOriginRequest(behindProxy)).toBe(true);
  });
});

describe("rejectCrossOrigin", () => {
  it("answers 403 bad_origin or null", async () => {
    expect(rejectCrossOrigin(req({ origin: "https://app.example.com" }))).toBeNull();
    const res = rejectCrossOrigin(req({ origin: "https://evil.example" }));
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "bad_origin" });
  });
});
