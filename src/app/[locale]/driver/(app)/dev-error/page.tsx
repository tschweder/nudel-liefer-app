import { notFound } from "next/navigation";
import { connection } from "next/server";

/** Hidden driver-side twin of `/admin/dev/error` (NUD-094); a 404 unless `ENABLE_ERROR_TEST_PAGES=true`. */
export default async function Page() {
  await connection();
  if (process.env.ENABLE_ERROR_TEST_PAGES !== "true") notFound();
  throw new Error("Forced test error from /driver/dev-error");
}
