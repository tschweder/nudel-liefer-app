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

import { PWA_THEME_COLOR } from "../src/lib/pwa";
import { buildOfflineHtml, OFFLINE_LOCALES, type OfflineTexts } from "./lib/offline-page";

const root = process.cwd();
const publicDir = path.join(root, "public");

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
  writeFileSync(
    path.join(publicDir, "offline.html"),
    buildOfflineHtml(offlineTexts(), PWA_THEME_COLOR),
  );

  const swDest = path.join(publicDir, "sw.js");
  await build({
    entryPoints: [path.join(root, "src", "sw", "sw.ts")],
    outfile: swDest,
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });

  const result = await injectManifest({
    swSrc: swDest,
    swDest,
    globDirectory: root,
    globPatterns: [".next/static/**/*.{js,css,woff2}", "public/icons/*.png", "public/offline.html"],
    globIgnores: ["**/*.map", "**/_buildManifest.js", "**/_ssgManifest.js"],
    globFollow: false,
    modifyURLPrefix: { ".next/static/": "/_next/static/", "public/": "/" },
    // Files under /_next/static carry a content hash in their name: no extra revision needed.
    dontCacheBustURLsMatching: /^\/_next\/static\//,
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  });
  for (const warning of result.warnings) console.warn("pwa:", warning);
  console.log(
    `pwa: public/sw.js with ${result.count} precache entries (${(result.size / 1024).toFixed(0)} KiB), public/offline.html`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
