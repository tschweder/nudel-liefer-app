/** Shared constants and the manifest builder for the driver PWA (NUD-080). */

/** Browser UI / splash colours. Light primary of `globals.css`; background = page background. */
export const PWA_THEME_COLOR = "#9a3412";
export const PWA_BACKGROUND_COLOR = "#ffffff";

export const SW_URL = "/sw.js";
export const OFFLINE_URL = "/offline.html";

export const PWA_ICONS = {
  any192: "/icons/icon-192.png",
  any512: "/icons/icon-512.png",
  maskable192: "/icons/icon-maskable-192.png",
  maskable512: "/icons/icon-maskable-512.png",
  apple: "/icons/apple-touch-icon.png",
} as const;

export function manifestPath(locale: string): string {
  return `/${locale}/manifest.webmanifest`;
}

export function driverHomePath(locale: string): string {
  return `/${locale}/driver`;
}

export type WebAppManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  dir: "ltr";
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "portrait";
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose: "any" | "maskable" }[];
};

/**
 * Manifest of one locale. `start_url` is the driver home in that locale; `id` is the same for all
 * locales so the browser treats them as one app. `scope` is the whole origin so that switching
 * the language (a different `/<locale>/...` prefix) does not leave the installed app's scope.
 */
export function buildManifest(input: {
  locale: string;
  name: string;
  shortName: string;
  description: string;
}): WebAppManifest {
  const png = (src: string, size: number, purpose: "any" | "maskable") => ({
    src,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose,
  });
  return {
    id: "/driver",
    name: input.name,
    short_name: input.shortName,
    description: input.description,
    lang: input.locale,
    dir: "ltr",
    start_url: driverHomePath(input.locale),
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: PWA_THEME_COLOR,
    background_color: PWA_BACKGROUND_COLOR,
    icons: [
      png(PWA_ICONS.any192, 192, "any"),
      png(PWA_ICONS.any512, 512, "any"),
      png(PWA_ICONS.maskable192, 192, "maskable"),
      png(PWA_ICONS.maskable512, 512, "maskable"),
    ],
  };
}
