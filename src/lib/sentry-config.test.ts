import { describe, expect, it } from "vitest";

import {
  isSentryEnabled,
  parseSentryDsn,
  sentryEnvironment,
  sentryIngestSource,
  sentryRelease,
} from "./sentry-config";

describe("parseSentryDsn", () => {
  it("reads host, key and project of a Sentry DSN", () => {
    expect(parseSentryDsn(" https://abc123@o1.ingest.de.sentry.io/4507 ")).toEqual({
      protocol: "https",
      publicKey: "abc123",
      host: "o1.ingest.de.sentry.io",
      projectId: "4507",
      origin: "https://o1.ingest.de.sentry.io",
    });
    expect(parseSentryDsn("http://k@localhost:9999/1")?.origin).toBe("http://localhost:9999");
  });
  it("accepts a DSN with a path prefix (self-hosted) and a legacy secret", () => {
    expect(parseSentryDsn("https://k:s@sentry.example.org/prefix/12")?.projectId).toBe("12");
  });
  it("returns null for empty or malformed values", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "  ",
      "nope",
      "ftp://k@h/1",
      "https://h/1",
      "https://k@h/",
      "https://k@h/abc",
    ]) {
      expect(parseSentryDsn(bad as string | undefined), String(bad)).toBeNull();
      expect(isSentryEnabled(bad as string | undefined)).toBe(false);
      expect(sentryIngestSource(bad as string | undefined)).toBeNull();
    }
  });
});

describe("environment and release", () => {
  it("prefers the explicit value, then Vercel, then NODE_ENV", () => {
    expect(sentryEnvironment({ SENTRY_ENVIRONMENT: "staging", VERCEL_ENV: "preview" })).toBe(
      "staging",
    );
    expect(sentryEnvironment({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(
      "production",
    );
    expect(sentryEnvironment({ NODE_ENV: "test" })).toBe("test");
    expect(sentryEnvironment({})).toBe("development");
  });
  it("uses the git commit of the deployment as release", () => {
    expect(sentryRelease({ VERCEL_GIT_COMMIT_SHA: "abc" })).toBe("abc");
    expect(sentryRelease({ SENTRY_RELEASE: "r1", VERCEL_GIT_COMMIT_SHA: "abc" })).toBe("r1");
    expect(sentryRelease({})).toBeUndefined();
  });
});
