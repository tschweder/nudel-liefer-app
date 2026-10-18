import { z } from "zod";

// NUD-093: runs before the app's client code. Zod 4 probes `new Function("")` to decide whether it
// may compile ("JIT") object parsers; under our Content-Security-Policy (no 'unsafe-eval') that
// probe is blocked and reported as a violation although zod handles it. Switching the JIT off in the
// browser avoids the report and costs nothing measurable for the few small payloads parsed there.
// The server keeps the default.
z.config({ jitless: true });
