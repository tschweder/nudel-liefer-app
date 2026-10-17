import type { Metadata, Viewport } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PwaRuntime } from "@/components/driver/pwa-runtime";
import { manifestPath, PWA_ICONS, PWA_THEME_COLOR } from "@/lib/pwa";

export const viewport: Viewport = { themeColor: PWA_THEME_COLOR };

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]/driver">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pwa" });
  return {
    manifest: manifestPath(locale),
    icons: {
      icon: [
        { url: PWA_ICONS.any192, sizes: "192x192", type: "image/png" },
        { url: PWA_ICONS.any512, sizes: "512x512", type: "image/png" },
      ],
      apple: { url: PWA_ICONS.apple, sizes: "180x180", type: "image/png" },
    },
    // iOS "Add to Home Screen": open without Safari's chrome, label under the icon.
    appleWebApp: { capable: true, title: t("shortName"), statusBarStyle: "default" },
  };
}

/** Everything under /driver (login included) is the installable PWA. */
export default async function DriverRootLayout({
  children,
  params,
}: LayoutProps<"/[locale]/driver">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <PwaRuntime />
      {children}
    </>
  );
}
