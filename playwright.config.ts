// The specs read DATABASE_URL / SEED_ADMIN_PASSWORD straight from the environment (Vitest loads
// dotenv in vitest.config.ts, Playwright does not), so without this `pnpm test:e2e` fails on a
// machine that only has a `.env` file. dotenv never overwrites variables that are already set, so
// the CI workflow's env block still wins.
import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: process.env.CI ? `pnpm build && pnpm start -p ${port}` : `pnpm dev -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Every spec runs from the same address and several log in wrongly on purpose (the
      // rate-limit tests). Without this the shared per-IP counter (20 failures / 15 min) fills up
      // and every later login in the run is rejected as rate limited. The per-identifier limit the
      // rate-limit tests actually assert is unchanged. Ignored when a server is reused.
      LOGIN_MAX_FAILURES_PER_IP: "1000000",
    },
  },
});
