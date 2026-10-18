"use client";

import { DriverError } from "@/components/driver/driver-error";

/**
 * Error boundary of the driver area outside the app shell: login, language picker, offline shell
 * and the layouts themselves (NUD-094). Pages inside the shell use `(app)/error.tsx`.
 */
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center p-4">
      <DriverError {...props} />
    </main>
  );
}
