"use client";

import { AdminError } from "@/components/admin/admin-error";

/** Error boundary of the admin pages: the navigation (shell) stays usable (NUD-094). */
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <AdminError {...props} />;
}
