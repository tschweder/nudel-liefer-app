import { FileQuestionIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** Localized 404 (rendered inside the locale layout, so `lang` and messages are right). */
export default function NotFound() {
  const t = useTranslations("common.notFound");
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-4 p-4 text-center"
      data-testid="not-found"
    >
      <FileQuestionIcon className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="text-base text-muted-foreground">{t("description")}</p>
      <Link href="/" className={buttonVariants({ size: "lg" })}>
        {t("home")}
      </Link>
    </main>
  );
}
