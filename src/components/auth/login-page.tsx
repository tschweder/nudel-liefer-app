import { Suspense } from "react";

import { PurgeOfflineData } from "@/components/driver/purge-offline-data";

import { LoginForm } from "./login-form";

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
      {/* A login page means no session: no personal offline copy may stay on the device (NUD-081). */}
      <PurgeOfflineData />
      <Suspense>
        <Body {...props} />
      </Suspense>
    </>
  );
}
