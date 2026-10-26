import { getTranslations } from "next-intl/server";

import { withBasePath } from "@/lib/base-path";

/**
 * Link to the generated help page (NUD-127). `hand-off.html` is a static file in `public/`, not a
 * route, so it does not get the base path automatically: a relative href would resolve against the
 * current directory (`/de/driver/hand-off.html`), and `next/link` would treat it as a route.
 * Opening in a new tab keeps a half-filled login form alive.
 */
export async function HelpLink({ className }: { className?: string }) {
  const t = await getTranslations("auth");
  return (
    <a
      href={withBasePath("/hand-off.html")}
      target="_blank"
      rel="noopener"
      className={className}
      data-testid="help-link"
    >
      {t("help")}
    </a>
  );
}
