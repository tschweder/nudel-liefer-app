import type { ReactNode } from "react";

import { ConnectionIndicator } from "@/components/driver/connection-indicator";
import { InstallHint } from "@/components/driver/install-hint";
import { LanguageSwitcher } from "@/components/shared/language-switcher";

/** Mobile-first driver layout: sticky top bar (date, connection, language) and a large content area. */
export function DriverShell({ dateLabel, children }: { dateLabel: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col" data-testid="driver-shell">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background ps-4 pe-1">
        <p className="min-w-0 flex-1 truncate text-lg font-semibold" data-testid="driver-date">
          {dateLabel}
        </p>
        <ConnectionIndicator />
        <LanguageSwitcher variant="icon" />
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <InstallHint />
        {children}
      </main>
    </div>
  );
}
