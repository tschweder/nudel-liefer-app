import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// NUD-110: the proxy gives every page response its own nonce and the hashes of the prebuilt shells.

const HASH_DE = "sha256-0GFkk+3XvOIs1EPnW+Xu+mcSrXckV7bNnbgaA4G3Rf4=";
const HASH_COMMON = "sha256-29UH2qFGJ9/q6z6Xebtqho17VtF+2RUqXFc6GD2TxGY=";

async function loadProxy(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return (await import("./proxy")).default;
}
const scriptSrc = (csp: string | null) =>
  csp
    ?.split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src "))
    ?.split(" ")
    .slice(1) ?? [];

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret-for-the-proxy-unit-test-0123456789");
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy CSP in production", () => {
  const env = {
    NODE_ENV: "production",
    CSP_SCRIPT_HASHES: JSON.stringify({
      common: [HASH_COMMON],
      locales: { de: [HASH_DE], "zh-Hans": [] },
    }),
  };

  it("sets a nonce and the shell hashes of the locale on the response and on the request Next.js renders", async () => {
    const proxy = await loadProxy(env);
    const request = new NextRequest("http://localhost/de/login");
    const response = await proxy(request);
    const header = response.headers.get("content-security-policy");
    const sources = scriptSrc(header);
    expect(sources[0]).toBe("'self'");
    expect(sources.find((s) => s.startsWith("'nonce-"))).toMatch(/^'nonce-[A-Za-z0-9+/]{22}=='$/);
    expect(sources).toContain(`'${HASH_COMMON}'`);
    expect(sources).toContain(`'${HASH_DE}'`);
    expect(sources).not.toContain("'unsafe-inline'");
    // Next.js takes the nonce from the request header: it must carry the same policy.
    expect(request.headers.get("content-security-policy")).toBe(header);
  });

  it("uses only the hashes of the request's locale", async () => {
    const proxy = await loadProxy(env);
    const response = await proxy(new NextRequest("http://localhost/zh-Hans/login"));
    const sources = scriptSrc(response.headers.get("content-security-policy"));
    expect(sources).toContain(`'${HASH_COMMON}'`);
    expect(sources).not.toContain(`'${HASH_DE}'`);
  });

  it("a different nonce for every response, redirects included", async () => {
    const proxy = await loadProxy(env);
    const nonces = new Set<string>();
    for (const path of ["/de/login", "/de/login", "/de/admin", "/xx/unknown", "/"]) {
      const response = await proxy(new NextRequest(`http://localhost${path}`));
      const nonce = scriptSrc(response.headers.get("content-security-policy")).find((s) =>
        s.startsWith("'nonce-"),
      );
      expect(nonce, path).toBeTruthy();
      nonces.add(nonce!);
    }
    expect(nonces.size).toBe(5);
  });

  it("without a hash manifest only the nonce is added (first build pass)", async () => {
    const proxy = await loadProxy({ NODE_ENV: "production" });
    const response = await proxy(new NextRequest("http://localhost/de/login"));
    const sources = scriptSrc(response.headers.get("content-security-policy"));
    expect(sources).toHaveLength(2);
  });

  it("honours CSP_REPORT_ONLY for the header the page sees and the response header", async () => {
    const proxy = await loadProxy({ ...env, CSP_REPORT_ONLY: "true" });
    const request = new NextRequest("http://localhost/de/login");
    const response = await proxy(request);
    expect(response.headers.get("content-security-policy")).toBeNull();
    const reportOnly = response.headers.get("content-security-policy-report-only");
    expect(reportOnly).toContain("'nonce-");
    expect(request.headers.get("content-security-policy-report-only")).toBe(reportOnly);
  });
});

describe("proxy CSP in development", () => {
  it("keeps 'unsafe-inline' and 'unsafe-eval' and uses no nonce (it would switch 'unsafe-inline' off)", async () => {
    const proxy = await loadProxy({ NODE_ENV: "development" });
    const response = await proxy(new NextRequest("http://localhost/de/login"));
    expect(scriptSrc(response.headers.get("content-security-policy"))).toEqual([
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
    ]);
  });
});
