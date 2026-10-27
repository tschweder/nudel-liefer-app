import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { listVehicles } from "./vehicles";

/** Admin-only read of the vehicle list (NUD-146); re-checks the role against the database first. */
export async function listVehiclesQuery() {
  await requireRole("ADMIN");
  return listVehicles(getDb());
}
