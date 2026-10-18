import { describe, expect, it } from "vitest";

import { buildCsp, securityHeaders, storageSources, tileSource } from "./security-headers";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(" ") ?? [];

describe("tileSource", () => {
  it("uses the OSM default when MAP_TILE_URL is unset", () => {
    expect(tileSource(undefined)).toBe("https://tile.openstreetmap.org");
    expect(tileSource("  ")).toBe("https://tile.openstreetmap.org");
  });
  it("takes the origin of a configured provider, keeping query keys out", () => {
    expect(tileSource("https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=SECRET")).toBe(
      "https://api.maptiler.com",
    );
    expect(tileSource("http://localhost:4010/tiles/{z}/{x}/{y}.png")).toBe("http://localhost:4010");
  });
  it("turns a subdomain placeholder into a wildcard", () => {
    expect(tileSource("https://{s}.tile.example.org/{z}/{x}/{y}.png")).toBe(
      "https://*.tile.example.org",
    );
    expect(tileSource("https://tiles-{s}.example.org/{z}/{x}/{y}.png")).toBe(
      "https://*.example.org",
    );
  });
  it("returns null for something that is not an http(s) URL", () => {
    expect(tileSource("javascript:alert(1)")).toBeNull();
    expect(tileSource("//cdn.example/{z}.png")).toBeNull();
  });
});

describe("storageSources", () => {
  it("uses the endpoint origin (MinIO / R2, path style)", () => {
    expect(
      storageSources({ S3_ENDPOINT: "https://abc.eu.r2.cloudflarestorage.com/some/path" }),
    ).toEqual(["https://abc.eu.r2.cloudflarestorage.com"]);
    expect(storageSources({ S3_ENDPOINT: "http://localhost:9000" })).toEqual([
      "http://localhost:9000",
    ]);
  });
  it("derives AWS S3 hosts without an endpoint", () => {
    expect(storageSources({ S3_BUCKET: "b", S3_REGION: "eu-central-1" })).toEqual([
      "https://b.s3.eu-central-1.amazonaws.com",
      "https://s3.eu-central-1.amazonaws.com",
    ]);
  });
  it("is empty when nothing is configured or the endpoint is garbage", () => {
    expect(storageSources({})).toEqual([]);
    expect(storageSources({ S3_ENDPOINT: "not a url" })).toEqual([]);
  });
});

describe("buildCsp", () => {
  const prod = {
    NODE_ENV: "production",
    S3_ENDPOINT: "https://abc.eu.r2.cloudflarestorage.com",
    MAP_TILE_URL: "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=K",
  };

  it("locks down framing, plugins, base URI and forms", () => {
    const csp = buildCsp(prod);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "frame-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
  });

  it("allows the tile and storage origins from the environment, nothing else external", () => {
    const csp = buildCsp(prod);
    expect(directive(csp, "img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://abc.eu.r2.cloudflarestorage.com",
      "https://api.maptiler.com",
    ]);
    expect(directive(csp, "connect-src")).toEqual([
      "'self'",
      "https://abc.eu.r2.cloudflarestorage.com",
    ]);
    expect(csp).not.toContain("SECRET");
    expect(csp).not.toContain("key=");
    expect(csp).not.toMatch(/\*(?!\.)/);
  });

  it("allows eval and websockets only in development", () => {
    expect(directive(buildCsp(prod), "script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directive(buildCsp(prod), "connect-src")).not.toContain("ws:");
    const dev = buildCsp({ NODE_ENV: "development" });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
  });
});

describe("securityHeaders", () => {
  const find = (headers: ReturnType<typeof securityHeaders>, key: string) =>
    headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

  it("sends the full set", () => {
    const headers = securityHeaders({ NODE_ENV: "production" });
    expect(find(headers, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(find(headers, "Strict-Transport-Security")).toMatch(/^max-age=\d{8,}/);
    expect(find(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(find(headers, "X-Frame-Options")).toBe("DENY");
    expect(find(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const permissions = find(headers, "Permissions-Policy")!;
    expect(permissions).toContain("camera=(self)");
    expect(permissions).toContain("geolocation=()");
    expect(permissions).toContain("microphone=()");
  });

  it("switches to report-only on request", () => {
    const headers = securityHeaders({ NODE_ENV: "production", CSP_REPORT_ONLY: "true" });
    expect(find(headers, "Content-Security-Policy")).toBeUndefined();
    expect(find(headers, "Content-Security-Policy-Report-Only")).toContain("default-src 'self'");
  });
});
