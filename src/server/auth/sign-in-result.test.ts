import { describe, expect, it } from "vitest";

import { parseSignInResult } from "./sign-in-result";

describe("parseSignInResult", () => {
  it("maps Auth.js result URLs to login errors", () => {
    expect(parseSignInResult("http://x/api/auth/callback/driver?callbackUrl=/")).toEqual({
      error: null,
    });
    expect(parseSignInResult("http://x/login?error=CredentialsSignin&code=credentials")).toEqual({
      error: "invalid",
    });
    expect(parseSignInResult("http://x/login?error=CredentialsSignin&code=rate_limited")).toEqual({
      error: "rateLimited",
    });
    expect(parseSignInResult("http://x/login?error=Configuration")).toEqual({ error: "generic" });
    expect(parseSignInResult(null)).toEqual({ error: "generic" });
  });
});
