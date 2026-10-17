export type LoginError = "invalid" | "rateLimited" | "generic";

/**
 * Interprets the URL returned by Auth.js `signIn(..., { redirect: false })`.
 * Failures carry `error=...` (and our `code=rate_limited`) in the query string.
 */
export function parseSignInResult(url: string | null | undefined): { error: LoginError | null } {
  if (!url) return { error: "generic" };
  let params: URLSearchParams;
  try {
    params = new URL(url, "http://localhost").searchParams;
  } catch {
    return { error: "generic" };
  }
  const error = params.get("error");
  if (!error) return { error: null };
  if (params.get("code") === "rate_limited") return { error: "rateLimited" };
  if (error === "CredentialsSignin") return { error: "invalid" };
  return { error: "generic" };
}
