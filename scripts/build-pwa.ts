/**
 * Builds the service worker after `next build` (NUD-080): writes public/offline.html, bundles
 * src/sw/sw.ts to public/sw.js (esbuild) and injects the precache list (hashed assets of
 * .next/static, the icons, the offline page). Serwist's Next plugin is not used because it needs
 * webpack; this keeps `pnpm build` on Turbopack. Output files are git-ignored.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { injectManifest } from "@serwist/build";
import { build } from "esbuild";

import { BASE_PATH } from "../src/lib/base-path";
import { isTileCacheEnabled } from "../src/lib/map-config";
import { PWA_THEME_COLOR } from "../src/lib/pwa";
import { offlineShellUrls } from "../src/sw/rules";
import {
  buildOfflineHtml,
  buildOfflineScript,
  OFFLINE_LOCALES,
  type OfflineTexts,
} from "./lib/offline-page";

const root = process.cwd();
const publicDir = path.join(root, "public");

/**
 * The precache entries are URLs the browser fetches, so they carry the base path
 * (`/delivery-app/_next/static/...`); the worker itself is inlined with the same value (esbuild
 * `define` below) and `src/sw/rules.ts` builds its own URLs with it. Empty without a sub-path.
 */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const precachedStaticPrefix = `${BASE_PATH}/_next/static/`;

function offlineTexts(): Record<(typeof OFFLINE_LOCALES)[number], OfflineTexts> {
  const entries = OFFLINE_LOCALES.map((locale) => {
    const messages = JSON.parse(
      readFileSync(path.join(root, "messages", `${locale}.json`), "utf8"),
    );
    const o = messages?.pwa?.offline as OfflineTexts | undefined;
    if (!o?.title || !o.text || !o.retry)
      throw new Error(`messages/${locale}.json: pwa.offline missing`);
    return [locale, o] as const;
  });
  return Object.fromEntries(entries) as Record<(typeof OFFLINE_LOCALES)[number], OfflineTexts>;
}

async function main() {
  const buildId = readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8").trim();
  writeFileSync(
    path.join(publicDir, "offline.html"),
    buildOfflineHtml(offlineTexts(), PWA_THEME_COLOR),
  );
  // The script of the offline page is a file of its own (the CSP of static files has no 'unsafe-inline', NUD-110).
  writeFileSync(path.join(publicDir, "offline.js"), buildOfflineScript());

  const swDest = path.join(publicDir, "sw.js");
  await build({
    entryPoints: [path.join(root, "src", "sw", "sw.ts")],
    outfile: swDest,
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    platform: "browser",
    define: {
      "process.env.NODE_ENV": '"production"',
      // `src/lib/base-path.ts` (bundled into the worker, where `process` does not exist) reads the
      // value at module load: esbuild has to inline it, exactly as Next inlines it elsewhere.
      "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(BASE_PATH),
      // NUD-108: only an explicit MAP_TILE_CACHE=1 (with MAP_TILE_URL) makes the worker cache tiles.
      __TILE_CACHE_URL__: JSON.stringify(
        isTileCacheEnabled(process.env) ? process.env.MAP_TILE_URL!.trim() : "",
      ),
    },
    logLevel: "warning",
  });

  const result = await injectManifest({
    swSrc: swDest,
    swDest,
    globDirectory: root,
    globPatterns: [
      ".next/static/**/*.{js,css,woff2}",
      "public/icons/*.png",
      "public/offline.html",
      "public/offline.js",
      // NUD-175 (QA 2026-10-29 F8): the blocking theme bootstrap of every page — without it an
      // offline reload asks the network for it and gets ERR_CONNECTION_REFUSED.
      "public/theme.js",
    ],
    globIgnores: ["**/*.map", "**/_buildManifest.js", "**/_ssgManifest.js"],
    globFollow: false,
    modifyURLPrefix: {
      ".next/static/": `${BASE_PATH}/_next/static/`,
      "public/": `${BASE_PATH}/`,
    },
    // Files under /_next/static carry a content hash in their name: no extra revision needed.
    dontCacheBustURLsMatching: new RegExp(`^${escapeRegExp(precachedStaticPrefix)}`),
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    // The public offline shell pages (NUD-081, one per locale). The worker fetches them when it
    // installs; they are prerendered, carry no personal data and change with every build.
    additionalPrecacheEntries: offlineShellUrls().map((url) => ({ url, revision: buildId })),
  });
  for (const warning of result.warnings) console.warn("pwa:", warning);
  console.log(
    `pwa: public/sw.js with ${result.count} precache entries (${(result.size / 1024).toFixed(0)} KiB), public/offline.html + offline.js`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
