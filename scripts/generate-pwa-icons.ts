/**
 * Renders the PWA icons into public/icons (SVG -> PNG with a headless Chromium via Playwright).
 * Run manually when the artwork in scripts/lib/pwa-icons.ts changes; the PNGs are committed.
 * Set CHROMIUM_PATH if Playwright's own browser is not installed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import { iconSvg } from "./lib/pwa-icons";

const outDir = path.join(process.cwd(), "public", "icons");
const targets = [
  { file: "icon-192.png", size: 192, variant: "any" },
  { file: "icon-512.png", size: 512, variant: "any" },
  { file: "icon-maskable-192.png", size: 192, variant: "maskable" },
  { file: "icon-maskable-512.png", size: 512, variant: "maskable" },
  // iOS rounds the corners itself, so the apple-touch-icon is full-bleed.
  { file: "apple-touch-icon.png", size: 180, variant: "maskable" },
] as const;

async function main() {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "icon.svg"), iconSvg("any"));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.env.CHROMIUM_PATH ? ["--no-sandbox"] : [],
  });
  try {
    for (const { file, size, variant } of targets) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${iconSvg(variant)}`,
      );
      await page.screenshot({ path: path.join(outDir, file), omitBackground: true });
      await page.close();
      console.log("wrote", file);
    }
  } finally {
    await browser.close();
  }
}

void main();
