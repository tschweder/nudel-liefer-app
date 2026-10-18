import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    // NUD-098: OpenCC (~1.2 MB of dictionaries) is server-only. Client-reachable code must not
    // import it, directly or through the server half of LocalizedText. `pnpm check:client-bundle`
    // is the backstop for indirect paths (e.g. a client component importing a server module).
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/sw/**/*.ts",
      "src/domain/**/*.ts",
      "src/lib/**/*.{ts,tsx}",
    ],
    ignores: ["src/lib/opencc.ts", "src/lib/localized-text.server.ts", "src/lib/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "opencc-js",
                "**/lib/opencc",
                "./opencc",
                "**/localized-text.server",
                "./localized-text.server",
              ],
              message:
                "OpenCC is server-only (NUD-098). Use it from src/server/** or scripts only.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "src/generated/**",
    "public/sw.js",
    ".lighthouseci/**",
  ]),
]);

export default eslintConfig;
