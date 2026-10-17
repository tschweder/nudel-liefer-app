import { setRequestLocale } from "next-intl/server";

import { LoginPageContent } from "@/components/auth/login-page";

export default async function AdminLoginPage({
  params,
  searchParams,
}: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LoginPageContent kind="admin" searchParams={searchParams} />;
}
