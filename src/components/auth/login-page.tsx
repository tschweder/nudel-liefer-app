import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { PurgeOfflineData } from "@/components/driver/purge-offline-data";
import { HelpLink } from "@/components/shared/help-link";
import { AuthorizationError, requireRole } from "@/server/auth/guards";

import { LoginForm } from "./login-form";

/**
 * NUD-185 (QA 2026-10-29 F20): a signed-in visitor sees the login page instead of being bounced to
 * their home screen with no hint — plus who is signed in and a way out. That is what makes a shared
 * office tablet usable for handing a tour to a driver.
 *
 * The "no session → purge the offline copy" rule (NUD-081) lives here with it: now that a signed-in
 * driver may legitimately open this page, the purge must not wipe his cached tour while he works.
 */
async function LoginIntro() {
  // The session is request data (see `requirePageActor`): without this the guard runs during
  // prerendering with an empty cookie jar.
  await connection();
  let name: string | null = null;
  try {
    name = (await requireRole("ADMIN", "DRIVER")).name;
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
  }
  if (!name) return <PurgeOfflineData />;
  const [t, locale] = await Promise.all([getTranslations("auth"), getLocale()]);
  return (
    <div
      className="mx-auto mb-3 flex w-full max-w-md flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3"
      data-testid="login-session-banner"
    >
      <p className="text-base">{t("signedInAs", { name })}</p>
      <LogoutButton locale={locale} />
    </div>
  );
}

async function Body({
  kind,
  searchParams,
}: {
  kind: "admin" | "driver";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <LoginForm
      kind={kind}
      callbackUrl={typeof callbackUrl === "string" ? callbackUrl : undefined}
    />
  );
}

/** Login page body; reads `?callbackUrl` inside Suspense (dynamic data under cacheComponents). */
export function LoginPageContent(props: Parameters<typeof Body>[0]) {
  return (
    <>
      <Suspense>
        {/* Purges the offline copy when there is no session (NUD-081) — or names the signed-in user. */}
        <LoginIntro />
      </Suspense>
      <Suspense>
        <Body {...props} />
      </Suspense>
      {/* Help page (NUD-127): reachable without a login, so it belongs on both login screens. */}
      <p className="mt-4 text-center text-base">
        <HelpLink className="inline-flex min-h-12 items-center px-3 underline underline-offset-4" />
      </p>
    </>
  );
}
