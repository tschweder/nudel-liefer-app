import { requireRole } from "./auth/guards";
import { listCustomers } from "./customers";
import { getDb } from "./db";

/**
 * Admin-only server reads for customers. Every read re-checks the role against the database
 * first (anonymous / driver / deactivated callers get an AuthorizationError before any query).
 */
export async function listCustomersQuery(input: unknown) {
  await requireRole("ADMIN");
  return listCustomers(getDb(), input);
}
