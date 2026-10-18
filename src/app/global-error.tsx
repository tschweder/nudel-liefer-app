"use client";

import { FatalError } from "@/components/shared/fatal-error";

/** Errors in the root layout itself (NUD-094): nothing of the app can be rendered then. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return <FatalError error={error} />;
}
