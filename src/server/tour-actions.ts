"use server";

import { z } from "zod";

import { requireRole } from "./auth/guards";
import { generateTour, type GenerateTourResult } from "./tour-builder";

const generateTourInputSchema = z.object({ date: z.string().trim().min(1).max(10) }).strict();

/**
 * Admin-only: builds or rebuilds the tour of one delivery day (`YYYY-MM-DD`). The UI is NUD-042;
 * it shows `error` / `warnings` of the result with messages (`depot_not_set` ->
 * `admin.settings.errors.depotNotSet`).
 */
export async function generateTourAction(input: unknown): Promise<GenerateTourResult> {
  await requireRole("ADMIN");
  const parsed = generateTourInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_date", warnings: [] };
  return generateTour(parsed.data.date);
}
