/**
 * Lighthouse CI for the driver home (NUD-095). `scripts/lighthouse/prepare.ts` creates the logged-in
 * Chrome profile (session cookie, HTTP cache, service worker) in LHCI_PROFILE_DIR; the runs reuse it
 * without clearing storage, i.e. they measure the visit AFTER the first load, on mobile emulation with
 * Chrome's "Slow 4G" and a 4x slower CPU (applied by DevTools throttling, not simulated).
 *
 * Budget: LCP < 2.5 s. Run: `pnpm lhci` with a production server on BASE_URL (see docs/performance.md).
 */
const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const profileDir = require("node:path").resolve(
  process.env.LHCI_PROFILE_DIR ?? ".lighthouseci/profile",
);
const chromePath = process.env.CHROME_PATH || process.env.LHCI_CHROME_PATH || undefined;

module.exports = {
  ci: {
    collect: {
      url: [`${baseUrl}/de/driver`],
      numberOfRuns: 3,
      ...(chromePath ? { chromePath } : {}),
      settings: {
        onlyCategories: ["performance"],
        throttlingMethod: "devtools",
        disableStorageReset: true,
        chromeFlags: `--no-sandbox --headless --user-data-dir=${profileDir}`,
      },
    },
    assert: {
      assertions: {
        "largest-contentful-paint": [
          "error",
          { maxNumericValue: 2500, aggregationMethod: "median" },
        ],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median" }],
        "total-blocking-time": ["warn", { maxNumericValue: 600, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci/reports" },
  },
};
