import type { ReactNode } from "react";

import { ConnectionIndicator } from "@/components/driver/connection-indicator";
import { InstallHint } from "@/components/driver/install-hint";
import { OfflineStatusBar } from "@/components/driver/offline-status";
import { OfflineSync } from "@/components/driver/offline-sync";
import { PendingBadge } from "@/components/driver/pending-badge";
import { SyncNotices } from "@/components/driver/sync-notices";
import { LanguageSwitcher } from "@/components/shared/language-switcher";

/**
 * Mobile-first driver layout: sticky top bar (date, connection, language) and a large content area.
 * `syncUserId` (DRIVER users) keeps the offline copy of the tour current (NUD-081); `offline` is the
 * service-worker shell: no language switcher (it needs the server) and no install hint.
 */
export function DriverShell({
  dateLabel,
  syncUserId,
  offline = false,
  children,
}: {
  dateLabel: string;
  syncUserId?: string;
  offline?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col" data-testid="driver-shell">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background ps-4 pe-1">
        <p className="min-w-0 flex-1 truncate text-lg font-semibold" data-testid="driver-date">
          {dateLabel}
        </p>
        <PendingBadge />
        <ConnectionIndicator />
        {offline ? null : <LanguageSwitcher variant="icon" />}
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        {syncUserId ? <OfflineSync userId={syncUserId} /> : null}
        {offline ? null : <InstallHint />}
        <OfflineStatusBar />
        <SyncNotices />
        {children}
      </main>
    </div>
  );
}
