import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { type UserListRow, UsersManager } from "@/components/admin/users-manager";
import { LoadingSkeleton } from "@/components/shared/states";
import { createAppFormatters } from "@/lib/format";
import { requirePageActor } from "@/server/auth/page-guards";
import { getDb } from "@/server/db";
import { getFactoryTimezone } from "@/server/settings";
import { listUsers } from "@/server/users";

async function Guarded({ locale }: { locale: string }) {
  // Defence in depth behind the proxy and the admin layout.
  const actor = await requirePageActor("admin", locale);
  const db = getDb();
  const [drivers, admins] = await Promise.all([listUsers(db, "DRIVER"), listUsers(db, "ADMIN")]);
  const formatters = createAppFormatters(
    await getFormatter({ locale }),
    await getFactoryTimezone(),
  );
  const toRow = (u: Awaited<ReturnType<typeof listUsers>>[number]): UserListRow => ({
    id: u.id,
    displayName: u.displayName,
    username: u.username,
    email: u.email,
    locale: u.locale,
    active: u.active,
    lastLogin: u.lastLoginAt ? formatters.dateTime(new Date(u.lastLoginAt)) : null,
  });
  return (
    <UsersManager
      drivers={drivers.map(toRow)}
      admins={admins.map(toRow)}
      currentUserId={actor.id}
    />
  );
}

export default async function Page({ params }: PageProps<"/[locale]/admin/drivers">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Guarded locale={locale} />
    </Suspense>
  );
}
