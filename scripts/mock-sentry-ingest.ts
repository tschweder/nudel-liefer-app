/**
 * A stand-in for Sentry's ingest endpoint (NUD-094), for checking the wiring without a Sentry
 * account: `pnpm exec tsx scripts/mock-sentry-ingest.ts [port] [logfile]`.
 *
 * Build and start the app with `SENTRY_DSN=http://publickey@localhost:<port>/1`; every event the
 * server or the browser sends is appended to the log file as one JSON line (the event payload of
 * each envelope). It answers like Sentry (200 + event id) and allows cross-origin posts from the
 * browser. See docs/runbook.md "Check Sentry locally". NEVER point a real DSN at it.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? process.env.MOCK_SENTRY_PORT ?? 9999);
const logFile = process.argv[3] ?? process.env.MOCK_SENTRY_LOG ?? "mock-sentry-events.jsonl";
writeFileSync(logFile, "");

/** An envelope is newline separated JSON: envelope header, then (item header, payload) pairs. */
export function eventsOfEnvelope(body: string): unknown[] {
  const lines = body.split("\n").filter(Boolean);
  const events: unknown[] = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    try {
      const header = JSON.parse(lines[i]!) as { type?: string };
      if (header.type === "event") events.push(JSON.parse(lines[i + 1]!));
    } catch {
      // not JSON (attachment), ignore
    }
  }
  return events;
}

createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    console.log(`${req.method} ${req.url} ${Buffer.concat(chunks).length} bytes`);
    if (req.method === "POST" && /\/envelope\/?$/.test((req.url ?? "").split("?")[0]!)) {
      for (const event of eventsOfEnvelope(Buffer.concat(chunks).toString("utf8"))) {
        appendFileSync(
          logFile,
          `${JSON.stringify({ receivedFrom: req.headers.origin ?? "server", event })}\n`,
        );
      }
    }
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "00000000000000000000000000000000" }));
  });
}).listen(port, () => console.log(`mock sentry on port ${port}, log ${logFile}`));
