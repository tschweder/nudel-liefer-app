import {
  type AuditAction,
  type AuditEntity,
  isAuditAction,
  sanitizeAuditDiff,
} from "@/domain/audit";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Audit log writer (NUD-092). The only way the application writes to `AuditLog`, and it only ever
 * inserts: there is no update or delete path (a test scans the sources, the database refuses
 * both with a trigger).
 *
 * Call it with the transaction client of the change itself, as the last step of the transaction:
 * the entry exists if and only if the change was committed. Pass ids and values, never names,
 * secrets or signed URLs; `sanitizeAuditDiff` removes forbidden keys, truncates long text and
 * caps lists as a second line of defence.
 */
export type AuditDb = Pick<PrismaClient, "auditLog">;

export type AuditEntry = {
  actorId: string;
  entity: AuditEntity;
  entityId: string;
  action: AuditAction;
  diff: unknown;
};

export async function recordAudit(tx: AuditDb, entry: AuditEntry): Promise<void> {
  if (!isAuditAction(entry.action)) throw new Error(`Unknown audit action ${entry.action}`);
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      diff: sanitizeAuditDiff(entry.diff ?? {}) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}
