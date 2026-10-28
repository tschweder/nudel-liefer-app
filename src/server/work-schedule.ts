import { z } from "zod";

import {
  ISO_WEEKDAYS,
  MAX_SHIFT_MINUTES,
  type ScheduleDay,
  timeToMinutes,
  type WorkSchedule,
} from "@/domain/work-time";
import type { PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";

/**
 * Working days and hours per driver (NUD-152, D28): one row per ISO weekday in `WorkSchedule`.
 * A weekday without an active row is a non-working day, so "delete" means `active = false` (soft
 * delete only). The callers (`work-schedule-actions.ts`) have checked the ADMIN role; every save is
 * audited in the same transaction. Read models for reports live in `utilization.ts`.
 */

type WorkScheduleDb = Pick<PrismaClient, "workSchedule" | "user" | "auditLog" | "$transaction">;

const timeString = z
  .string()
  .trim()
  .max(5)
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const workScheduleDaySchema = z.object({
  weekday: z.number().int().min(1).max(7),
  active: z.boolean(),
  /** "HH:MM" in the factory time zone; ignored for an inactive day. */
  start: timeString,
  end: timeString,
});
export type WorkScheduleDayInput = z.input<typeof workScheduleDaySchema>;

export const workScheduleInputSchema = z
  .object({
    driverId: z.string().trim().min(1).max(64),
    days: z.array(workScheduleDaySchema).max(7),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<number>();
    for (const day of value.days) {
      if (seen.has(day.weekday)) {
        ctx.addIssue({ code: "custom", message: `duplicate weekday ${day.weekday}` });
      }
      seen.add(day.weekday);
      if (!day.active) continue;
      const start = timeToMinutes(day.start);
      const end = timeToMinutes(day.end);
      if (start === null || end === null || end <= start || end > MAX_SHIFT_MINUTES) {
        ctx.addIssue({ code: "custom", message: `invalid hours for weekday ${day.weekday}` });
      }
    }
  });
export type WorkScheduleInput = z.input<typeof workScheduleInputSchema>;

export type WorkScheduleSaveResult =
  { ok: true } | { ok: false; error: "invalid" | "not_found" | "not_a_driver" };

const select = { weekday: true, startMinutes: true, endMinutes: true, active: true } as const;

/** The stored rows of one driver (soft-deleted weekdays included, `active = false`). */
export async function readWorkSchedule(
  db: Pick<PrismaClient, "workSchedule">,
  driverId: string,
): Promise<ScheduleDay[]> {
  const rows = await db.workSchedule.findMany({
    where: { driverId },
    orderBy: { weekday: "asc" },
    select,
  });
  return rows.map((row) => ({ ...row }));
}

/**
 * The schedules of several drivers at once (`Map` keyed by driver id); a driver without rows is
 * absent from the map. Used by the driver list, the utilization page and the planning warning.
 */
export async function listWorkSchedules(
  db: Pick<PrismaClient, "workSchedule">,
  driverIds?: readonly string[],
): Promise<Map<string, ScheduleDay[]>> {
  const rows = await db.workSchedule.findMany({
    where: driverIds && driverIds.length > 0 ? { driverId: { in: [...driverIds] } } : {},
    orderBy: [{ driverId: "asc" }, { weekday: "asc" }],
    select: { driverId: true, ...select },
  });
  const byDriver = new Map<string, ScheduleDay[]>();
  for (const row of rows) {
    const list = byDriver.get(row.driverId) ?? [];
    list.push({
      weekday: row.weekday,
      startMinutes: row.startMinutes,
      endMinutes: row.endMinutes,
      active: row.active,
    });
    byDriver.set(row.driverId, list);
  }
  return byDriver;
}

/** The active days only, in ISO weekday order — what the editor and the warnings work with. */
export function activeDays(schedule: WorkSchedule): ScheduleDay[] {
  return ISO_WEEKDAYS.flatMap((weekday) => {
    const day = schedule.find((entry) => entry.weekday === weekday);
    return day && day.active ? [day] : [];
  });
}

/**
 * Replaces the working days and hours of one driver. Weekdays marked inactive are switched off
 * (`active = false`) and never deleted; a weekday without a row stays without one. The whole
 * change is one transaction with one audit entry (`driver.schedule_update`).
 */
export async function saveWorkScheduleWith(
  db: WorkScheduleDb,
  actorId: string,
  rawInput: unknown,
): Promise<WorkScheduleSaveResult> {
  const parsed = workScheduleInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { driverId, days } = parsed.data;

  const driver = await db.user.findUnique({
    where: { id: driverId },
    select: { id: true, role: true },
  });
  if (!driver) return { ok: false, error: "not_found" };
  if (driver.role !== "DRIVER") return { ok: false, error: "not_a_driver" };

  const before = await readWorkSchedule(db, driverId);
  const byWeekday = new Map(days.map((day) => [day.weekday, day]));
  const after: ScheduleDay[] = ISO_WEEKDAYS.map((weekday) => {
    const requested = byWeekday.get(weekday);
    const active = requested?.active === true;
    return {
      weekday,
      startMinutes: active ? (timeToMinutes(requested.start) ?? 0) : 0,
      endMinutes: active ? (timeToMinutes(requested.end) ?? 0) : 0,
      active,
    };
  }).filter((day) => day.active);

  const changed = summarise(before) !== summarise(after);
  if (!changed) return { ok: true };

  await db.$transaction(async (tx) => {
    for (const weekday of ISO_WEEKDAYS) {
      const requested = byWeekday.get(weekday);
      const existing = before.find((day) => day.weekday === weekday);
      if (requested?.active) {
        const startMinutes = timeToMinutes(requested.start)!;
        const endMinutes = timeToMinutes(requested.end)!;
        await tx.workSchedule.upsert({
          where: { driverId_weekday: { driverId, weekday } },
          create: { driverId, weekday, startMinutes, endMinutes, active: true },
          update: { startMinutes, endMinutes, active: true },
        });
      } else if (existing?.active) {
        await tx.workSchedule.update({
          where: { driverId_weekday: { driverId, weekday } },
          data: { active: false },
        });
      }
    }
    await recordAudit(tx, {
      actorId,
      entity: "Driver",
      entityId: driverId,
      action: "driver.schedule_update",
      diff: { schedule: { from: summarise(before), to: summarise(after) } },
    });
  });
  return { ok: true };
}

/** Compact, comparable form of a schedule for the audit diff: "1 360-840; 2 360-840". */
function summarise(schedule: WorkSchedule): string {
  return activeDays(schedule)
    .map((day) => `${day.weekday} ${day.startMinutes}-${day.endMinutes}`)
    .join("; ");
}
