import { connection } from "next/server";

import { runProductionHealthChecks } from "@/server/health";

/**
 * Public liveness/readiness probe (no auth on purpose, no secrets in the body).
 * 200 when database and storage are reachable, 503 otherwise.
 */
export async function GET() {
  // Opt out of prerendering: the answer must reflect the state at request time.
  await connection();
  const report = await runProductionHealthChecks();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
