"use client";

import { AdminError } from "@/components/admin/admin-error";

/** Error boundary of the admin layouts and the print pages (NUD-094). */
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center p-4">
      <AdminError {...props} />
    </main>
  );
}
