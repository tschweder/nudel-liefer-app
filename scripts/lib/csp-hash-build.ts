import { createHash } from "node:crypto";

import type { ScriptHashManifest } from "../../src/lib/csp-script-hashes";

const SCRIPT_PATTERN = /<script((?:\s[^>]*)?)>([\s\S]*?)<\/script>/gi;

/** Bodies of the inline `<script>` elements (no `src`) of an HTML document. */
export function inlineScriptBodies(html: string): string[] {
  const bodies: string[] = [];
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    if (/(?:^|\s)src\s*=/i.test(match[1] ?? "")) continue;
    bodies.push(match[2] ?? "");
  }
  return bodies;
}

/** CSP hash source (without quotes) of a script body: `sha256-<base64>`. */
export function scriptHash(body: string): string {
  return `sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`;
}

/**
 * Hash manifest of prerendered documents. `files` are paths relative to `.next/server/app`
 * (`de.html`, `de/driver/offline-shell.html`, `_not-found.html`). A document below a locale
 * directory belongs to that locale (and to its own `<locale>.html`); everything else is `common`
 * and goes into every locale's list, because it can be shown under any locale.
 */
export function buildScriptHashManifest(
  files: ReadonlyArray<{ path: string; html: string }>,
  locales: readonly string[],
): ScriptHashManifest {
  const common = new Set<string>();
  const perLocale = new Map<string, Set<string>>(locales.map((l) => [l, new Set<string>()]));
  for (const file of files) {
    const hashes = inlineScriptBodies(file.html).map(scriptHash);
    const first = file.path.split("/")[0]!.replace(/\.html$/, "");
    const bucket = perLocale.get(first) ?? common;
    for (const hash of hashes) bucket.add(hash);
  }
  return {
    common: [...common].sort(),
    locales: Object.fromEntries(
      locales.map((l) => [l, [...perLocale.get(l)!].filter((h) => !common.has(h)).sort()]),
    ),
  };
}
