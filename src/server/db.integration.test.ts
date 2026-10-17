// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seed } from "../../prisma/seed";
import { createTestDb, type TestDb } from "./test-db";

// Needs a real PostgreSQL (`DATABASE_URL`): `docker compose up -d` or `pnpm db:embedded`.
// Skipped (not faked) when no database is configured.
describe.skipIf(!process.env.DATABASE_URL)("database schema (integration)", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    process.env.SEED_ADMIN_PASSWORD = "test-admin-password";
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb?.teardown();
  });

  async function createFixtures() {
    const { prisma } = testDb;
    const user = await prisma.user.create({
      data: {
        role: "ADMIN",
        email: `a-${Math.random()}@example.com`,
        passwordHash: "x",
        displayName: "A",
      },
    });
    const customer = await prisma.customer.create({
      data: {
        customerNumber: `C-${Math.random()}`,
        name: "Trattoria Roma",
        street: "Hauptstrasse 1",
        postalCode: "1010",
        city: "Wien",
      },
    });
    const product = await prisma.product.create({
      data: { sku: `P-${Math.random()}`, name: { de: "Spaghetti", meta: {} }, unit: "PACK" },
    });
    return { user, customer, product };
  }

  it("creates customer -> order -> items and reads them back", async () => {
    const { prisma } = testDb;
    const { user, customer, product } = await createFixtures();

    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        deliveryDate: new Date("2026-11-03"),
        status: "CONFIRMED",
        createdById: user.id,
        items: { create: [{ productId: product.id, quantity: "2.5" }] },
      },
    });

    const read = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { customer: true, items: { include: { product: true } } },
    });
    expect(read.customer.name).toBe("Trattoria Roma");
    expect(read.deliveryDate.toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(read.source).toBe("MANUAL");
    expect(read.items).toHaveLength(1);
    expect(read.items[0].quantity.toString()).toBe("2.5");
    expect(read.items[0].product.id).toBe(product.id);
  });

  it("refuses to hard-delete a customer that has orders; archiving works", async () => {
    const { prisma } = testDb;
    const { user, customer } = await createFixtures();
    await prisma.order.create({
      data: { customerId: customer.id, deliveryDate: new Date("2026-11-04"), createdById: user.id },
    });

    await expect(prisma.customer.delete({ where: { id: customer.id } })).rejects.toThrow();
    expect(await prisma.customer.count({ where: { id: customer.id } })).toBe(1);

    const archived = await prisma.customer.update({
      where: { id: customer.id },
      data: { active: false },
    });
    expect(archived.active).toBe(false);
  });

  it("allows several tours on the same date (no unique constraint on Tour.date)", async () => {
    const { prisma } = testDb;
    const depotSnapshot = { name: "Depot", lat: 48.2, lng: 16.3 };
    await prisma.tour.create({ data: { date: new Date("2026-11-05"), depotSnapshot } });
    await prisma.tour.create({ data: { date: new Date("2026-11-05"), depotSnapshot } });
    expect(await prisma.tour.count({ where: { date: new Date("2026-11-05") } })).toBe(2);
  });

  it("seeds settings, 1 admin, 5 drivers, 6 products, 0 customers - idempotently", async () => {
    const { prisma } = testDb;
    // Fresh schema counts are asserted via deltas to stay independent of other tests' users.
    const before = {
      customers: await prisma.customer.count(),
      products: await prisma.product.count(),
    };
    await seed(prisma);
    await seed(prisma);

    expect(await prisma.settings.count()).toBe(1);
    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings.timezone).toBe("Europe/Vienna");
    expect(settings.deliveryWeekdays).toEqual([1, 2, 3, 4, 5]);
    // The seeded depot is a placeholder: tour building must stay blocked until an admin confirms it.
    expect(settings.depotPinConfirmed).toBe(false);
    expect(await prisma.user.count({ where: { email: "admin@example.com", role: "ADMIN" } })).toBe(
      1,
    );
    const drivers = await prisma.user.findMany({
      where: { role: "DRIVER" },
      orderBy: { username: "asc" },
    });
    expect(drivers.map((d) => d.locale).sort()).toEqual([
      "de",
      "de",
      "zh_Hans",
      "zh_Hant_HK",
      "zh_Hant_TW",
    ]);
    // Only `driver-new` shows the first-start language picker (NUD-050).
    expect(drivers.filter((d) => !d.localeChosen).map((d) => d.username)).toEqual(["driver-new"]);
    expect(await prisma.product.count()).toBe(before.products + 6);
    expect(await prisma.customer.count()).toBe(before.customers);
  });
});
