import { notFound } from "next/navigation";
import { connection } from "next/server";

/**
 * Hidden test page (NUD-094): raises an error so the error pages (and Sentry) can be seen working.
 * It is a 404 unless `ENABLE_ERROR_TEST_PAGES=true`, which only the e2e run and a deliberate
 * check on a staging deployment set. Behind the admin layout and the proxy like every admin page.
 */
export default async function Page() {
  await connection();
  if (process.env.ENABLE_ERROR_TEST_PAGES !== "true") notFound();
  throw new Error("Forced test error from /admin/dev/error");
}
