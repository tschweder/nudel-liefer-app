// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatViolation, handleCspReport } from "./csp-report";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report", ...headers },
    body,
  });

afterEach(() => vi.restoreAllMocks());

describe("CSP report endpoint", () => {
  it("logs one sanitized line for a legacy report and answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await handleCspReport(
      post(
        JSON.stringify({
          "csp-report": {
            "document-uri": "https://app.example.com/de/admin/orders?token=SECRET#x",
            "violated-directive": "img-src",
            "effective-directive": "img-src",
            "blocked-uri": "https://evil.example/pic.png?sig=SECRET",
            "line-number": 12,
            disposition: "enforce",
          },
        }),
      ),
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]![0] as string;
    expect(line).toContain("directive=img-src");
    expect(line).toContain("blocked=https://evil.example/pic.png");
    expect(line).toContain("document=https://app.example.com/de/admin/orders");
    expect(line).not.toContain("SECRET");
  });

  it("understands the Reporting API format and caps the number of entries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const entries = Array.from({ length: 30 }, () => ({
      type: "csp-violation",
      body: {
        effectiveDirective: "script-src",
        blockedURL: "inline",
        documentURL: "https://a.b/c",
      },
    }));
    const res = await handleCspReport(
      post(JSON.stringify(entries), { "content-type": "application/reports+json" }),
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(10);
  });

  it("ignores garbage and never reflects input", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const body of ["", "not json", "[]", '{"x":1}', "null"]) {
      const res = await handleCspReport(post(body));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies", async () => {
    expect((await handleCspReport(post("x".repeat(20_000)))).status).toBe(413);
    expect((await handleCspReport(post("{}", { "content-length": "999999" }))).status).toBe(413);
  });

  it("strips control characters and truncates fields (no log injection)", () => {
    const line = formatViolation({
      "effective-directive": "img-src\n[csp-violation] forged=1",
      "blocked-uri": "x".repeat(1000),
    });
    expect(line.split("\n")).toHaveLength(1);
    expect(line.length).toBeLessThan(1200);
  });
});
