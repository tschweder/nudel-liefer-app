import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { DriverLanguagePicker } from "@/components/driver/driver-language-picker";
import { requirePageActor } from "@/server/auth/page-guards";

async function Picker({ locale }: { locale: string }) {
  const actor = await requirePageActor("driver", locale, { allowUnchosen: true });
  // Admins (support view) and drivers who already chose have nothing to pick.
  if (actor.role !== "DRIVER" || actor.localeChosen) redirect(`/${locale}/driver`);
  return <DriverLanguagePicker />;
}

/** First-start language picker (NUD-050): full screen, no shell, no text besides the languages. */
export default async function DriverStartPage({ params }: PageProps<"/[locale]/driver/start">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <Picker locale={locale} />
    </Suspense>
  );
}
