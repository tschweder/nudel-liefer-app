import { z } from "zod";

import {
  type CustomerPatch,
  type ExistingCustomer,
  IMPORT_FIELDS,
  numberKey,
  PATCH_FIELDS,
  planImport,
  type PlanSummary,
  type RowIssue,
  type RowPlan,
  summarizePlan,
} from "@/domain/customer-import";
import { IMPORT_LIMITS } from "@/domain/import-file";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { customerInputSchema, notesText, officeFields } from "./customer-admin";
import { notesJson, prepareNotesWithoutTranslation } from "./customer-notes";

type ImportDb = Pick<PrismaClient, "customer">;

/**
 * Mapped rows as the browser sends them: for every file row its number in the file and the cell
 * texts of the mapped fields. The server cleans and validates them again; nothing in here is trusted.
 */
export const importRequestSchema = z.object({
  records: z
    .array(
      z.object({
        line: z.number().int().min(1).max(10_000_000),
        values: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(IMPORT_LIMITS.maxCellLength)),
      }),
    )
    .min(1)
    .max(IMPORT_LIMITS.maxRows),
});

type StoredRow = ExistingCustomer & { updatedAt: Date; notesRaw: unknown };

async function loadStored(db: ImportDb): Promise<Map<string, StoredRow>> {
  const rows = await db.customer.findMany({
    select: {
      id: true,
      customerNumber: true,
      name: true,
      street: true,
      postalCode: true,
      city: true,
      country: true,
      deliveryHoursInfo: true,
      notes: true,
      companyName: true,
      vatId: true,
      billingStreet: true,
      billingPostalCode: true,
      billingCity: true,
      active: true,
      updatedAt: true,
    },
  });
  return new Map(
    rows.map((r) => [
      numberKey(r.customerNumber),
      {
        id: r.id,
        customerNumber: r.customerNumber,
        name: r.name,
        street: r.street,
        postalCode: r.postalCode,
        city: r.city,
        country: r.country,
        deliveryHoursInfo: r.deliveryHoursInfo,
        notes: notesText(r.notes),
        companyName: r.companyName,
        vatId: r.vatId,
        billingStreet: r.billingStreet,
        billingPostalCode: r.billingPostalCode,
        billingCity: r.billingCity,
        active: r.active,
        updatedAt: r.updatedAt,
        notesRaw: r.notes,
      },
    ]),
  );
}

function plansFor(
  records: z.infer<typeof importRequestSchema>["records"],
  stored: ReadonlyMap<string, StoredRow>,
): RowPlan[] {
  return planImport(
    records.map((r) => ({ line: r.line, record: r.values })),
    stored,
  );
}

export type PreviewRow = Omit<RowPlan, "create" | "patch">;
export type PreviewResult =
  | { ok: true; rows: PreviewRow[]; summary: PlanSummary; pinsReset: number; archived: number }
  | { ok: false; error: "invalid" };

const toPreviewRow = (plan: RowPlan): PreviewRow => {
  const { create, patch, ...rest } = plan;
  void create;
  void patch;
  return rest;
};

/** Dry run: what an import of these rows would do. Writes nothing. The caller checked the role. */
export async function previewImport(db: ImportDb, raw: unknown): Promise<PreviewResult> {
  const parsed = importRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const plan = plansFor(parsed.data.records, await loadStored(db));
  return {
    ok: true,
    rows: plan.map(toPreviewRow),
    summary: summarizePlan(plan),
    pinsReset: plan.filter((p) => p.status === "update" && p.pinReset).length,
    archived: plan.filter((p) => p.status === "update" && p.archived).length,
  };
}

export type ImportFailure = {
  line: number;
  customerNumber: string;
  name: string;
  issues: RowIssue[];
};
export type CommitResult =
  | {
      ok: true;
      created: number;
      updated: number;
      unchanged: number;
      failed: ImportFailure[];
      /** Updates that changed the address: pin and confirmation were dropped. */
      pinsReset: number;
      /** Updated customers that are archived (they stay archived). */
      archivedUpdated: number;
      /** Active customers without a pin after the import (the geocoding step's work list). */
      withoutPin: number;
      /** Active customers whose pin is not confirmed (the pin review queue). */
      toReview: number;
    }
  | { ok: false; error: "invalid" };

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

/**
 * Imports the valid rows: creates unknown customers (pin not confirmed) and updates known ones
 * (matched by customer number, case-insensitive). Invalid rows are skipped and reported; one failing
 * row never stops the others. An update is refused when the customer was edited after the import
 * started. Customers are never deleted or reactivated. The caller checked the role.
 */
export async function commitImport(
  db: ImportDb,
  raw: unknown,
  options: { now?: Date } = {},
): Promise<CommitResult> {
  const parsed = importRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const now = options.now ?? new Date();
  const stored = await loadStored(db);
  const plan = plansFor(parsed.data.records, stored);
  const byId = new Map([...stored.values()].map((s) => [s.id, s]));

  const failed: ImportFailure[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let pinsReset = 0;
  let archivedUpdated = 0;
  const fail = (p: RowPlan, code: RowIssue["code"]) =>
    failed.push({
      line: p.line,
      customerNumber: p.customerNumber,
      name: p.name,
      issues: [{ code, ...(code === "number_taken" ? { field: "customerNumber" as const } : {}) }],
    });

  for (const p of plan) {
    if (p.status === "error") {
      failed.push({
        line: p.line,
        customerNumber: p.customerNumber,
        name: p.name,
        issues: p.issues,
      });
    } else if (p.status === "unchanged") {
      unchanged += 1;
    } else if (p.status === "create") {
      // Same rules as the customer form.
      const input = customerInputSchema.safeParse({ ...p.create, pinConfirmed: false });
      if (!input.success) {
        fail(p, "invalid");
        continue;
      }
      try {
        await db.customer.create({
          data: {
            customerNumber: input.data.customerNumber,
            name: input.data.name,
            street: input.data.street,
            postalCode: input.data.postalCode,
            city: input.data.city,
            country: input.data.country,
            deliveryHoursInfo: input.data.deliveryHoursInfo,
            ...officeFields(input.data),
            notes: notesJson(prepareNotesWithoutTranslation(null, input.data.notes, now)),
            pinConfirmed: false,
          },
        });
        created += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        fail(p, "number_taken");
      }
    } else {
      const before = byId.get(p.existingId!)!;
      const patch = p.patch as CustomerPatch;
      const data: Prisma.CustomerUpdateManyMutationInput = {};
      for (const key of PATCH_FIELDS) {
        if (key !== "notes" && patch[key] !== undefined) data[key] = patch[key];
      }
      if (patch.notes !== undefined) {
        data.notes = notesJson(prepareNotesWithoutTranslation(before.notesRaw, patch.notes, now));
      }
      if (p.pinReset) {
        // The stored pin belongs to the old address (NUD-014): drop it and the confirmation.
        data.lat = null;
        data.lng = null;
        data.pinConfirmed = false;
      }
      const result = await db.customer.updateMany({
        where: { id: before.id, updatedAt: before.updatedAt },
        data,
      });
      if (result.count === 0) {
        fail(p, "changed_meanwhile");
        continue;
      }
      updated += 1;
      if (p.pinReset) pinsReset += 1;
      if (p.archived) archivedUpdated += 1;
    }
  }

  const withoutPin = await db.customer.count({ where: { active: true, lat: null } });
  const toReview = await db.customer.count({ where: { active: true, pinConfirmed: false } });
  console.info(
    `[customer-import] created ${created}, updated ${updated}, unchanged ${unchanged}, failed ${failed.length}, pins reset ${pinsReset}`,
  );
  return {
    ok: true,
    created,
    updated,
    unchanged,
    failed,
    pinsReset,
    archivedUpdated,
    withoutPin,
    toReview,
  };
}
