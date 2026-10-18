import { type AuditEntryView, getOrderHistory, getTourHistory } from "./audit-history";
import { requireRole } from "./auth/guards";
import { getDb } from "./db";

/**
 * Admin-only reads of the audit log for the order and tour pages (NUD-092). The role is checked
 * against the database first; drivers and anonymous callers never reach the log. The log has no
 * write path besides `recordAudit` in the service layer.
 */

export async function orderHistoryQuery(orderId: string): Promise<AuditEntryView[]> {
  await requireRole("ADMIN");
  return getOrderHistory(getDb(), orderId);
}

export async function tourHistoryQuery(tourId: string): Promise<AuditEntryView[]> {
  await requireRole("ADMIN");
  return getTourHistory(getDb(), tourId);
}
