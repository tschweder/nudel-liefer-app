"use client";

import { LogOutIcon, UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/server/auth/actions";

export function UserMenu({ name, locale }: { name: string; locale: string }) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid="user-menu" aria-label={t("admin.shell.userMenu")}>
          <UserIcon aria-hidden />
          <span className="hidden max-w-40 truncate sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel data-testid="signed-in-as">
          {t("auth.signedInAs", { name })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          data-testid="logout"
          onSelect={() =>
            startTransition(async () => {
              const form = new FormData();
              form.set("locale", locale);
              await logoutAction(form);
            })
          }
        >
          <LogOutIcon aria-hidden />
          {t("auth.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
