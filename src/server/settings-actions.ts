"use server";

import { updateTag } from "next/cache";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { saveSettings, type SaveSettingsResult, SETTINGS_TAG } from "./settings";

/**
 * Admin-only: stores the depot and planning settings and expires the settings cache.
 * The role is checked before the input is read.
 */
export async function saveSettingsAction(input: unknown): Promise<SaveSettingsResult> {
  await requireRole("ADMIN");
  const result = await saveSettings(getDb(), input);
  if (result.ok) updateTag(SETTINGS_TAG);
  return result;
}
