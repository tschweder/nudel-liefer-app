"use client";

import { MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AdminNav } from "@/components/admin/admin-nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * Sidebar as an off-canvas drawer below the rail breakpoint (re-design.md §8.1: the 260 px sidebar
 * needs the room, so **≤ 1024 px** the navigation moves behind a hamburger). Radix `Dialog` provides
 * the focus trap and closes on `Esc`; the test ids stay as in the specs (`open-menu`, `admin-nav`).
 *
 * `min-[1025px]:hidden` pairs with the `min-[1025px]:flex` of the rail in `admin-shell.tsx` — `lg`
 * starts at exactly 1024 px and would hide the hamburger while the rail was still a drawer.
 */
export function MobileNav() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="min-[1025px]:hidden"
          data-testid="open-menu"
          aria-label={t("admin.shell.openMenu")}
        >
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" aria-describedby={undefined} className="w-64 max-w-[80vw]">
        <SheetHeader>
          <SheetTitle>{t("common.appName")}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <AdminNav onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
