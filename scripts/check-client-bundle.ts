/**
 * Client-bundle guard (NUD-098). Run after `pnpm build`:
 *
 *   pnpm check:client-bundle            fails if any file under .next/static contains OpenCC
 *   pnpm check:client-bundle --report   additionally prints the first-load JS per route
 *
 * OpenCC (`opencc-js`, ~1.2 MB of dictionaries) must only ever run on the server (src/lib/opencc.ts
 * and src/lib/localized-text.server.ts). If a client component imports it, directly or through a
 * shared module, the dictionaries land in a client chunk and every phone downloads them.
 * The signatures are real dictionary entries (Simplified -> Traditional) plus the package name.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const NEXT_DIR = join(process.cwd(), ".next");
const STATIC_DIR = join(NEXT_DIR, "static");

/** Substrings that only occur if the OpenCC dictionaries (or the library) are bundled. */
export const OPENCC_SIGNATURES = [
  "意大利面 意大利麪",
  "意大利 義大利",
  "opencc-js",
  "OpenCC",
] as const;

export function findSignatures(source: string): string[] {
  return OPENCC_SIGNATURES.filter((signature) => source.includes(signature));
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function scanStatic(staticDir: string = STATIC_DIR): { file: string; found: string[] }[] {
  return walk(staticDir)
    .filter((file) => /\.(js|css|json|map)$/.test(file) && !file.endsWith(".map"))
    .map((file) => ({ file, found: findSignatures(readFileSync(file, "utf8")) }))
    .filter((hit) => hit.found.length > 0);
}

type Manifest = { entryJSFiles?: Record<string, string[]> };

function readClientManifest(file: string): Manifest {
  const globalThisStub = { __RSC_MANIFEST: {} as Record<string, Manifest> };
  new Function("globalThis", readFileSync(file, "utf8"))(globalThisStub);
  return Object.values(globalThisStub.__RSC_MANIFEST)[0] ?? {};
}

/** JS files a browser needs for the first load of an app route (page + ancestor layouts + root). */
function firstLoadFiles(pageDir: string, pageKey: string): string[] {
  const build = JSON.parse(readFileSync(join(NEXT_DIR, "build-manifest.json"), "utf8")) as {
    polyfillFiles: string[];
    rootMainFiles: string[];
  };
  const manifestFile = join(NEXT_DIR, "server/app", pageDir, "page_client-reference-manifest.js");
  const entries = readClientManifest(manifestFile).entryJSFiles ?? {};
  const files = new Set<string>([...build.polyfillFiles, ...build.rootMainFiles]);
  const segments = pageKey.split("/").filter(Boolean); // [locale], driver, (app), page
  const dirs = segments.slice(0, -1);
  const wanted = new Set<string>([`/${segments.join("/")}`]);
  for (let i = 0; i <= dirs.length; i++)
    wanted.add(`/${[...dirs.slice(0, i), "layout"].join("/")}`);
  for (const [key, chunks] of Object.entries(entries)) {
    if ([...wanted].some((suffix) => key.endsWith(`/src/app${suffix}`))) {
      for (const chunk of chunks) files.add(chunk);
    }
  }
  return [...files];
}

function report(): void {
  const routes: [string, string][] = [
    ["/de/driver", "[locale]/driver/(app)/page"],
    ["/de/admin", "[locale]/admin/(shell)/page"],
  ];
  for (const [label, key] of routes) {
    const dir = key.split("/").slice(0, -1).join("/");
    const files = firstLoadFiles(dir, `/${key}`);
    let raw = 0;
    let gz = 0;
    for (const file of files) {
      const buffer = readFileSync(join(NEXT_DIR, file));
      raw += buffer.length;
      gz += gzipSync(buffer).length;
    }
    console.log(
      `first-load JS ${label}: ${files.length} files, ${(raw / 1024).toFixed(0)} KiB raw, ${(gz / 1024).toFixed(0)} KiB gzip`,
    );
  }
  const chunks = walk(join(STATIC_DIR, "chunks")).filter((f) => f.endsWith(".js"));
  const all = chunks.reduce((sum, f) => sum + statSync(f).size, 0);
  console.log(`all client chunks: ${chunks.length} files, ${(all / 1024).toFixed(0)} KiB raw`);
}

function main(): void {
  if (!existsSync(STATIC_DIR)) {
    console.error("check-client-bundle: .next/static not found. Run `pnpm build` first.");
    process.exit(2);
  }
  if (process.argv.includes("--report")) report();
  const hits = scanStatic();
  if (hits.length > 0) {
    for (const hit of hits) {
      const size = (statSync(hit.file).size / 1024).toFixed(0);
      console.error(
        `OpenCC found in client file ${relative(process.cwd(), hit.file)} (${size} KiB): ${hit.found.join(", ")}`,
      );
    }
    console.error(
      "check-client-bundle FAILED: a client component imports OpenCC (see src/lib/opencc.ts, src/lib/localized-text.server.ts).",
    );
    process.exit(1);
  }
  console.log("check-client-bundle: OK, no OpenCC in .next/static");
}

if (process.argv[1]?.endsWith("check-client-bundle.ts")) main();
