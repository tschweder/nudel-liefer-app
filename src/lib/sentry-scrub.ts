/**
 * Privacy filter for everything that leaves the app towards Sentry (NUD-094). The same functions
 * run in the browser and on the server (`beforeSend`, `beforeBreadcrumb`) and are unit-tested with
 * hostile input. The rule: Sentry gets error type, message, stack trace, route, release and a
 * handful of safe tags - never request bodies, cookies, headers, user records, query strings,
 * signed storage URLs, PINs or passwords.
 */

const REDACTED = "[Filtered]";

/** Keys whose value is dropped wherever they appear in `extra`, `contexts`, breadcrumb data, ... */
const SENSITIVE_KEY =
  /pass(word|wd)?|pin(code)?$|secret|token|cookie|authorization|auth|signature|credential|api[-_]?key|session|csrf|dsn|bearer|x-amz/i;

/** `?X-Amz-Signature=...`, `?token=...` and every other query string / fragment of a URL. */
const URL_IN_TEXT = /\b(https?:\/\/[^\s"'<>)\]]+)/gi;

/** Removes query string and fragment (signed storage URLs carry their secret there). */
export function redactUrl(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : `${value.slice(0, cut)}${value[cut] === "?" ? "?" + REDACTED : ""}`;
}

/** Redacts every URL query string inside free text (error messages, breadcrumb messages). */
export function redactText(value: string): string {
  const withUrls = value.replace(URL_IN_TEXT, (url) => redactUrl(url));
  // A signature that lost its URL (split by a logger) is still recognisable.
  return withUrls
    .replace(/(X-Amz-[A-Za-z-]+=)[^&\s"']+/gi, `$1${REDACTED}`)
    .replace(/\b(Bearer|DeepL-Auth-Key)\s+[A-Za-z0-9._~+/=:-]{8,}/g, `$1 ${REDACTED}`);
}

type Json = unknown;

/** Deep copy with sensitive keys blanked, long strings clipped and URLs de-queried. */
export function scrubValue(value: Json, depth = 0): Json {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = redactText(value);
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  }
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [key, inner] of Object.entries(value as Record<string, Json>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(inner, depth + 1);
    }
    return out;
  }
  return REDACTED;
}

type AnyRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is AnyRecord => typeof v === "object" && v !== null;

/** Request headers that are harmless and useful for debugging. Everything else is removed. */
const SAFE_REQUEST_HEADERS = ["user-agent", "accept-language"];

function scrubRequest(request: AnyRecord): AnyRecord {
  const headers = isRecord(request.headers) ? request.headers : {};
  const safeHeaders: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SAFE_REQUEST_HEADERS.includes(name.toLowerCase())) safeHeaders[name] = value;
  }
  const out: AnyRecord = {};
  if (typeof request.method === "string") out.method = request.method;
  if (typeof request.url === "string") out.url = redactUrl(request.url);
  if (Object.keys(safeHeaders).length > 0) out.headers = safeHeaders;
  // Deliberately dropped: data (request body), cookies, query_string, env (remote address), headers.
  return out;
}

/** Breadcrumb filter: console output may contain anything, URLs lose their query strings. */
export function scrubBreadcrumb<T extends object>(input: T): T | null {
  const breadcrumb = input as AnyRecord;
  if (breadcrumb.category === "console") return null;
  const out: AnyRecord = { ...breadcrumb };
  if (typeof out.message === "string") out.message = redactText(out.message);
  if (isRecord(out.data)) {
    const data: AnyRecord = {};
    for (const [key, inner] of Object.entries(out.data)) {
      if (key === "url" || key === "from" || key === "to") {
        data[key] = typeof inner === "string" ? redactUrl(inner) : REDACTED;
      } else if (key === "method" || key === "status_code" || key === "reason") {
        data[key] = inner;
      } else {
        data[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(inner);
      }
    }
    // Request/response bodies and headers are never part of a breadcrumb we forward.
    delete data.body;
    delete data.request_body_size;
    out.data = data;
  }
  return out as unknown as T;
}

/** The whole event. Mutates a shallow copy; never throws (a broken filter must not hide errors). */
export function scrubEvent<T extends object>(event: T): T {
  try {
    const source = event as AnyRecord;
    const out: AnyRecord = { ...source };
    if (isRecord(source.request)) out.request = scrubRequest(source.request);
    // No user record at all: no id, name, email, ip. (`sendDefaultPii` is false as well.)
    delete out.user;
    if (typeof out.message === "string") out.message = redactText(out.message);
    if (isRecord(out.exception) && Array.isArray(out.exception.values)) {
      out.exception = {
        ...out.exception,
        values: out.exception.values.map((v) =>
          isRecord(v) && typeof v.value === "string" ? { ...v, value: redactText(v.value) } : v,
        ),
      };
    }
    if (Array.isArray(out.breadcrumbs)) {
      out.breadcrumbs = out.breadcrumbs
        .map((b) => (isRecord(b) ? scrubBreadcrumb(b) : null))
        .filter(Boolean);
    }
    if (isRecord(out.extra)) out.extra = scrubValue(out.extra);
    if (isRecord(out.contexts)) {
      const contexts = scrubValue(out.contexts) as AnyRecord;
      // Browser/OS/device/runtime/trace descriptions are harmless and useful: keep them as they are.
      for (const keep of ["browser", "os", "device", "runtime", "app", "culture"]) {
        const original = (out.contexts as AnyRecord)[keep];
        if (original !== undefined) contexts[keep] = original;
      }
      out.contexts = contexts;
    }
    if (isRecord(out.tags)) out.tags = scrubValue(out.tags);
    // Server name (host) identifies the machine, not the user, but is not needed either.
    delete out.server_name;
    return out as T;
  } catch {
    return { message: "Event dropped: scrubbing failed" } as unknown as T;
  }
}

/**
 * Errors that carry no information about the app: the phone has no network (the driver PWA is
 * built for exactly that), a chunk could not be fetched during a deploy, the browser cancelled
 * a request while navigating away.
 */
const NOISE =
  /^([A-Za-z]*Error: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|Network request failed|cancelled|The operation was aborted\.?|signal is aborted without reason)$/i;

export function isNoiseError(message: string | undefined | null): boolean {
  if (!message) return false;
  return NOISE.test(message.trim()) || /ResizeObserver loop/.test(message);
}

/** First exception message of an event, for `isNoiseError`. */
export function eventMessage(event: AnyRecord): string | undefined {
  const values = isRecord(event.exception) ? event.exception.values : undefined;
  if (Array.isArray(values) && isRecord(values[0])) {
    const first = values[0];
    const type = typeof first.type === "string" ? first.type : "";
    const value = typeof first.value === "string" ? first.value : "";
    return type && value ? `${type}: ${value}` : value || type || undefined;
  }
  return typeof event.message === "string" ? event.message : undefined;
}

/** `beforeSend`: drop noise, scrub the rest. */
export function beforeSend<T extends object>(event: T): T | null {
  if (isNoiseError(eventMessage(event as AnyRecord))) return null;
  return scrubEvent(event);
}
