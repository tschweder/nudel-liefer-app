import { setRequestLocale } from "next-intl/server";

import { LoginPageContent } from "@/components/auth/login-page";

export default async function DriverLoginPage({
  params,
  searchParams,
}: PageProps<"/[locale]/driver/login">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LoginPageContent kind="driver" searchParams={searchParams} />;
}
