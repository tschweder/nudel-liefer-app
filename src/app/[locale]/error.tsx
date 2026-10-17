"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";

/** Error boundary for every page below the locale layout. */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center p-4">
      <ErrorState title={t("error.title")} description={t("error.description")}>
        <Button size="lg" onClick={reset}>
          {t("actions.retry")}
        </Button>
      </ErrorState>
    </main>
  );
}
