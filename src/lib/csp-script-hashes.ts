/**
 * Hash sources of the inline scripts inside prerendered HTML (NUD-110).
 *
 * Next.js puts a per-request nonce on every inline script it renders for a request, but the
 * prebuilt shells (partial prerendering, fully static pages) are produced at build time and cannot
 * carry one. Their inline scripts are fixed text (bootstrap code, the chunk list of the page, the
 * flight data of static pages), so the policy allows them by SHA-256 hash instead. The hashes are
 * computed at build time by `scripts/csp-script-hashes.ts` and read here by `src/proxy.ts`.
 * No Node imports: the proxy bundles this file.
 */

/** Hash sources per locale directory of `.next/server/app`; `common` for the locale-less pages. */
export type ScriptHashManifest = { common: string[]; locales: Record<string, string[]> };

/** Parses the manifest passed in by `next.config.ts`; anything malformed becomes an empty manifest. */
export function parseScriptHashManifest(raw: string | undefined): ScriptHashManifest {
  const empty: ScriptHashManifest = { common: [], locales: {} };
  if (!raw?.trim()) return empty;
  try {
    const value = JSON.parse(raw) as Partial<ScriptHashManifest>;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    const locales: Record<string, string[]> = {};
    for (const [key, hashes] of Object.entries(value.locales ?? {})) locales[key] = list(hashes);
    return { common: list(value.common), locales };
  } catch {
    return empty;
  }
}

/** The hash sources a response in `locale` needs (`null`: no locale in the path). */
export function scriptHashesFor(manifest: ScriptHashManifest, locale: string | null): string[] {
  return [...manifest.common, ...(locale ? (manifest.locales[locale] ?? []) : [])];
}
