import { z } from "zod";

// NUD-093: runs before the app's client code. Zod 4 probes `new Function("")` to decide whether it
// may compile ("JIT") object parsers; under our Content-Security-Policy (no 'unsafe-eval') that
// probe is blocked and reported as a violation although zod handles it. Switching the JIT off in the
// browser avoids the report and costs nothing measurable for the few small payloads parsed there.
// The server keeps the default.
z.config({ jitless: true });

// NUD-094: browser-side Sentry. `NEXT_PUBLIC_SENTRY_DSN` is inlined at build time; with no DSN the
// condition is a constant false, the dynamic import disappears from the bundle and nothing is
// downloaded or sent. The SDK loads after the first paint (async chunk), so it never delays the
// driver's screen; errors thrown before it has loaded are not reported.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void Promise.all([import("@sentry/nextjs"), import("./lib/sentry-options")]).then(
    ([Sentry, { sentryInitOptions }]) => {
      Sentry.init(
        sentryInitOptions(process.env.NEXT_PUBLIC_SENTRY_DSN as string, {
          NODE_ENV: process.env.NODE_ENV,
          SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
          SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
        }),
      );
    },
  );
}
