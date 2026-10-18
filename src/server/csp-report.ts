const MAX_BODY_BYTES = 16 * 1024;
const MAX_FIELD_CHARS = 200;

/** One-line, length-limited, control-character-free value for a log line (no log injection). */
function clean(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "-";

  return (
    String(value)
      .replace(/[\u0000-\u001f\u007f\s]+/g, " ")
      .trim()
      .slice(0, MAX_FIELD_CHARS) || "-"
  );
}

/** Origin + path of a URL without query / fragment (they can carry tokens or signed parameters). */
function stripUrl(value: unknown): string {
  if (typeof value !== "string") return "-";
  try {
    const url = new URL(value);
    return clean(`${url.origin}${url.pathname}`);
  } catch {
    return clean(value); // keywords such as "inline", "eval", "data"
  }
}

type Violation = Record<string, unknown>;

/** Accepts the legacy `report-uri` body and the Reporting API list. */
function violationsIn(json: unknown): Violation[] {
  const isObject = (v: unknown): v is Violation => typeof v === "object" && v !== null;
  if (Array.isArray(json)) {
    return json
      .filter((r) => isObject(r) && r.type === "csp-violation" && isObject(r.body))
      .map((r) => (r as { body: Violation }).body)
      .slice(0, 10);
  }
  if (isObject(json) && isObject(json["csp-report"])) return [json["csp-report"] as Violation];
  return [];
}

/** Logs a CSP violation reported by a browser; format is stable so it can be searched in the logs. */
export function formatViolation(v: Violation): string {
  const directive = v["effective-directive"] ?? v.effectiveDirective ?? v["violated-directive"];
  return [
    "[csp-violation]",
    `directive=${clean(directive)}`,
    `blocked=${stripUrl(v["blocked-uri"] ?? v.blockedURL)}`,
    `document=${stripUrl(v["document-uri"] ?? v.documentURL)}`,
    `source=${stripUrl(v["source-file"] ?? v.sourceFile)}`,
    `line=${clean(v["line-number"] ?? v.lineNumber)}`,
    `disposition=${clean(v.disposition)}`,
  ].join(" ");
}

/**
 * `POST /api/csp-report` (NUD-093): target of the CSP `report-uri`. Public on purpose (browsers send
 * reports without credentials), so it does as little as possible: size-limited body, nothing is
 * stored or echoed, the answer is always 204, a single log line per violation.
 */
export async function handleCspReport(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return new Response(null, { status: 413 });
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
    for (const violation of violationsIn(JSON.parse(text)))
      console.warn(formatViolation(violation));
  } catch {
    // malformed report: ignore
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
