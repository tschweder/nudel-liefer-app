/**
 * Script hashes for the CSP (NUD-110). `next build` produces the prebuilt page shells; their inline
 * scripts cannot carry a per-request nonce, so `src/proxy.ts` allows them by hash. The hashes depend
 * on the build output (chunk names), the proxy bundle is built before it exists, hence `pnpm build`
 * runs `next build` twice:
 *
 *   reset  ->  next build  ->  write  ->  next build  ->  ...  ->  check
 *
 * `write` hashes every inline script in `.next/server/app/**\/*.html` and stores the manifest in
 * `.csp-script-hashes.json` (git-ignored), which `next.config.ts` hands to the proxy. `check` (end of
 * the build) recomputes it and fails if it differs from the one the proxy was built with, if a
 * public static HTML file has an inline script, or if the manifest is empty.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { LOCALES } from "../src/lib/localized-text";
import { buildScriptHashManifest, inlineScriptBodies } from "./lib/csp-hash-build";

const root = process.cwd();
export const MANIFEST_FILE = path.join(root, ".csp-script-hashes.json");
const appDir = path.join(root, ".next", "server", "app");

function htmlFiles(dir: string, base = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return htmlFiles(path.join(dir, entry.name), rel);
    return entry.name.endsWith(".html") ? [rel] : [];
  });
}

function currentManifest() {
  if (!existsSync(appDir)) throw new Error(".next/server/app not found: run `next build` first");
  const files = htmlFiles(appDir).map((rel) => ({
    path: rel,
    html: readFileSync(path.join(appDir, rel), "utf8"),
  }));
  return { manifest: buildScriptHashManifest(files, LOCALES), files: files.length };
}

const serialize = (value: unknown) => `${JSON.stringify(value)}\n`;

function reset() {
  rmSync(MANIFEST_FILE, { force: true });
}

function write() {
  const { manifest, files } = currentManifest();
  // The build ID is inlined in the flight data of static pages (so it is part of what is hashed):
  // the second pass has to reuse it.
  const buildId = readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8").trim();
  writeFileSync(MANIFEST_FILE, serialize({ buildId, ...manifest }));
  const count = manifest.common.length + Object.values(manifest.locales).flat().length;
  console.log(`csp-script-hashes: ${count} hashes from ${files} prerendered pages`);
}

function check() {
  const { manifest } = currentManifest();
  const errors: string[] = [];
  const buildId = readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8").trim();
  const embedded = existsSync(MANIFEST_FILE) ? readFileSync(MANIFEST_FILE, "utf8") : "";
  if (embedded !== serialize({ buildId, ...manifest })) {
    errors.push(
      "the hashes the proxy was built with differ from the final build output: the build is not " +
        "reproducible between the two passes (run `pnpm build`, not `next build`)",
    );
  }
  if (manifest.common.length === 0) errors.push("no common script hashes: the shells are empty?");
  // Static files in public/ get `script-src 'self'` only: they must not need an inline script.
  const publicDir = path.join(root, "public");
  for (const name of readdirSync(publicDir).filter((f) => f.endsWith(".html"))) {
    const bodies = inlineScriptBodies(readFileSync(path.join(publicDir, name), "utf8"));
    if (bodies.length) errors.push(`public/${name} has ${bodies.length} inline script(s)`);
  }
  if (errors.length) {
    console.error(`csp-script-hashes: FAILED\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
  console.log("csp-script-hashes: OK, the proxy was built with the hashes of the final output");
}

const mode = process.argv[2];
if (mode === "reset") reset();
else if (mode === "write") write();
else if (mode === "check") check();
else {
  console.error("usage: tsx scripts/csp-script-hashes.ts reset|write|check");
  process.exit(2);
}
