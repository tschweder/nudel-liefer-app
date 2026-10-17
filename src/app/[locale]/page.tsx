import { setRequestLocale } from "next-intl/server";

import { HomeContent } from "@/components/shared/home-content";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HomeContent />;
}
