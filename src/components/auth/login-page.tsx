import { Suspense } from "react";

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
    <Suspense>
      <Body {...props} />
    </Suspense>
  );
}
