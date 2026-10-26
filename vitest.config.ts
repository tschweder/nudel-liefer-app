import "dotenv/config";

import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "content/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // next-auth imports "next/server" without the extension, which Node's ESM loader rejects; let
    // Vite resolve it so the authorization matrix (NUD-093) can run the real Auth.js handlers.
    // The same for next-intl's middleware, which the proxy test (NUD-110) runs.
    server: { deps: { inline: [/next-auth/, /@auth\/core/, /next-intl/] } },
  },
});
