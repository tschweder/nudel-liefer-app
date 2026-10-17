import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { buildManifest } from "@/lib/pwa";

// NUD-080: one web app manifest per locale. The path has a file extension, so src/proxy.ts does not
// run for it: the manifest is reachable without a session (browsers fetch it without cookies on
// some platforms) and contains nothing personal.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/[locale]/manifest.webmanifest">,
) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return new Response("Not found", { status: 404 });
  const t = await getTranslations({ locale, namespace: "pwa" });
  const manifest = buildManifest({
    locale,
    name: t("name"),
    shortName: t("shortName"),
    description: t("description"),
  });
  return new Response(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
