/**
 * Pure validation of the environment of a Vercel build (production or preview).
 * Returns human-readable problems; never includes the values themselves.
 */
export type DeployEnvResult = { errors: string[]; warnings: string[] };

const PLACEHOLDER_SECRETS = ["replace-with-openssl-rand-base64-32-output", "change-me-local-only"];

export function checkDeployEnv(env: Record<string, string | undefined>): DeployEnvResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProduction = env.VERCEL_ENV === "production";

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    errors.push("DATABASE_URL is not set");
  } else {
    if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
      errors.push("DATABASE_URL must start with postgresql://");
    }
    if (/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
      errors.push("DATABASE_URL points to localhost");
    }
    // Neon's pooled host (PgBouncer) does not support the advisory locks `migrate deploy` takes.
    if (/-pooler\./.test(databaseUrl) && !env.DATABASE_URL_UNPOOLED) {
      errors.push(
        "DATABASE_URL is a pooled Neon URL: also set DATABASE_URL_UNPOOLED (direct connection) for migrations",
      );
    }
  }

  const authSecret = env.AUTH_SECRET;
  if (!authSecret) errors.push("AUTH_SECRET is not set");
  else if (authSecret.length < 32 || PLACEHOLDER_SECRETS.includes(authSecret)) {
    errors.push("AUTH_SECRET is too short or still the placeholder (use: openssl rand -base64 32)");
  }

  for (const name of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT"]) {
    if (!env[name]) errors.push(`${name} is not set (uploads would fail at runtime)`);
  }
  const endpoint = env.S3_ENDPOINT;
  if (endpoint) {
    if (/localhost|127\.0\.0\.1/.test(endpoint)) errors.push("S3_ENDPOINT points to localhost");
    else if (
      isProduction &&
      !/^https:\/\/[0-9a-f]+\.eu\.r2\.cloudflarestorage\.com\/?$/.test(endpoint)
    ) {
      warnings.push(
        "S3_ENDPOINT is not an EU-jurisdiction R2 endpoint (https://<account-id>.eu.r2.cloudflarestorage.com)",
      );
    }
  }

  if (isProduction && env.SEED_ADMIN_PASSWORD) {
    warnings.push("SEED_ADMIN_PASSWORD is set in the Vercel production environment: remove it");
  }
  return { errors, warnings };
}
