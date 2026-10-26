"use client";

import { HelpCircleIcon, LogOutIcon } from "lucide-react";
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
import { withBasePath } from "@/lib/base-path";
import { logoutAction } from "@/server/auth/actions";

/** Initials avatar (re-design.md §8.1: no image file, no `Avatar` dependency). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * Top-bar user menu (re-design.md §8.1): initials avatar + name, dropdown with who is signed in and
 * "Abmelden". The test ids (`user-menu`, `signed-in-as`, `logout`) stay as the specs use them.
 */
export function UserMenu({ name, locale }: { name: string; locale: string }) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          data-testid="user-menu"
          aria-label={t("admin.shell.userMenu")}
          className="gap-2 ps-1.5"
        >
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground"
          >
            {initials(name)}
          </span>
          <span className="hidden max-w-40 truncate sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel data-testid="signed-in-as">
          {t("auth.signedInAs", { name })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          {/* Static file in public/, so it needs the base path explicitly (NUD-127). */}
          <a
            href={withBasePath("/hand-off.html")}
            target="_blank"
            rel="noopener"
            data-testid="help-link"
          >
            <HelpCircleIcon aria-hidden />
            {t("auth.help")}
          </a>
        </DropdownMenuItem>
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
