import { DEFAULT_TIMEZONE } from "@/lib/format";

import { getDb } from "./db";

/** Factory time zone from the `Settings` singleton (falls back to the default before the first save). */
export async function getFactoryTimezone(): Promise<string> {
  const settings = await getDb().settings.findFirst({ select: { timezone: true } });
  return settings?.timezone ?? DEFAULT_TIMEZONE;
}
