/**
 * Runs first in the Vercel build (`pnpm build:vercel`): fails fast with a readable list of
 * problems instead of a half-configured deployment. Outside Vercel (VERCEL_ENV unset) it does
 * nothing, so `pnpm build:vercel` can also be tried locally with the variables set.
 */
import { checkDeployEnv } from "./lib/deploy-env";

if (!process.env.VERCEL_ENV && !process.env.CHECK_DEPLOY_ENV) {
  console.log("[deploy-env] not a Vercel build, skipping");
} else {
  const { errors, warnings } = checkDeployEnv(process.env);
  for (const w of warnings) console.warn(`[deploy-env] warning: ${w}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[deploy-env] error: ${e}`);
    console.error("[deploy-env] see docs/deploy.md section 'Environment variables'");
    process.exit(1);
  }
  console.log("[deploy-env] ok");
}
