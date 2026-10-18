"use client";

import { AlertTriangleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { startTransition, useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { reportClientError } from "@/lib/monitoring-client";

/**
 * Error page of the admin area (NUD-094). Shows the error reference (`digest`, the id Next.js
 * puts into the server log and into Sentry) so the office can quote it; never the message.
 */
export function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPages.admin");
  const router = useRouter();

  useEffect(() => {
    console.error(error);
    reportClientError(error);
  }, [error]);

  return (
    <div
      className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 p-8 text-center"
      data-testid="admin-error"
    >
      <AlertTriangleIcon className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold" role="alert">
        {t("title")}
      </h1>
      <p className="text-base text-muted-foreground">{t("description")}</p>
      {error.digest ? (
        <p className="font-mono text-sm text-muted-foreground" data-testid="admin-error-reference">
          {t("reference", { digest: error.digest })}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          size="lg"
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          {t("retry")}
        </Button>
        <Link href="/admin" className={buttonVariants({ variant: "outline", size: "lg" })}>
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
