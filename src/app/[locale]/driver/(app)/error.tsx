"use client";

import { DriverError } from "@/components/driver/driver-error";

/**
 * Error boundary of the driver pages inside the app shell (NUD-094). The shell (top bar, connection
 * indicator, sync of queued taps and photos) stays mounted; only the page content is replaced.
 */
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <DriverError {...props} />;
}
