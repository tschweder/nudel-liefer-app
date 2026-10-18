import { handleCspReport } from "@/server/csp-report";

/** Receives Content-Security-Policy violation reports from browsers (NUD-093). */
export function POST(request: Request) {
  return handleCspReport(request);
}
