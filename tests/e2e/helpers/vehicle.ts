/**
 * A tour cannot be released without a vehicle (NUD-146). Specs that release a tour create (once) a
 * roomy vehicle straight in the database and select it next to the driver.
 */
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

export async function ensureVehicle(
  client: Queryable,
  name = "E2E Transporter",
  capacityKg = 5000,
): Promise<string> {
  const id = `veh-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  await client.query(
    `INSERT INTO "Vehicle" ("id","name","capacityKg","active","updatedAt")
     VALUES ($1,$2,$3,true,now())
     ON CONFLICT ("id") DO UPDATE SET "capacityKg"=$3, "active"=true, "updatedAt"=now()`,
    [id, name, capacityKg],
  );
  return id;
}
