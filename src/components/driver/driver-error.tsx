"use client";

import { AlertCircleIcon, WifiOffIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { startTransition, useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { reportClientError } from "@/lib/monitoring-client";
import { useOnline } from "@/lib/use-online";

/**
 * Error page of the driver app (NUD-094). Two calm variants, both with big buttons and an icon:
 *
 * - online: "Something went wrong - the data is safe", Retry (re-fetches the page and re-renders);
 * - offline (`navigator.onLine === false`): no scary message. A failed page load while the phone has
 *   no network is expected; the queued taps and photos are untouched on the device. The button
 *   makes a full page load, which the service worker answers with the offline shell (today's tour
 *   from the phone's copy); when the connection comes back the page reloads by itself.
 *
 * Nothing here touches the offline queue or the stored tour. Inside the app shell
 * (`driver/(app)/error.tsx`) the shell, and with it the sync of queued taps, keeps running.
 */
export function DriverError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPages.driver");
  const router = useRouter();
  const online = useOnline();

  useEffect(() => {
    console.error(error);
    reportClientError(error);
  }, [error]);

  useEffect(() => {
    if (online) return;
    const reload = () => window.location.reload();
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, [online]);

  const retry = () => {
    if (!online) {
      window.location.reload();
      return;
    }
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  const Icon = online ? AlertCircleIcon : WifiOffIcon;
  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-8 text-center"
      data-testid="driver-error"
      data-connection={online ? "online" : "offline"}
    >
      <Icon className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold" role="alert">
        {online ? t("title") : t("offlineTitle")}
      </h1>
      <p className="text-lg">{online ? t("description") : t("offlineDescription")}</p>
      <Button size="lg" className="w-full" onClick={retry} data-testid="driver-error-retry">
        {online ? t("retry") : t("offlineOpen")}
      </Button>
      <Link
        href="/driver"
        className={buttonVariants({ variant: "outline", size: "lg" }) + " w-full"}
      >
        {t("home")}
      </Link>
    </div>
  );
}
