import { getTranslations } from "next-intl/server";

import { logoutAction } from "@/server/auth/actions";

export async function LogoutButton({ locale }: { locale: string }) {
  const t = await getTranslations("auth");
  return (
    <form action={logoutAction} data-testid="logout-form">
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        className="min-h-12 rounded border border-zinc-400 px-4 text-base"
        data-testid="logout"
      >
        {t("logout")}
      </button>
    </form>
  );
}
