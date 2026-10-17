// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { listCustomersQuery } = await import("./customer-queries");

// Authorization test: the customer list is admin-only.
describe.skipIf(!process.env.DATABASE_URL)(
  "customer queries authorization",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let inactiveAdminId: string;

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      const hash = await hashSecret("123456");
      const mk = (data: Parameters<typeof t.prisma.user.create>[0]["data"]) =>
        t.prisma.user.create({ data }).then((u) => u.id);
      adminId = await mk({
        role: "ADMIN",
        email: "a@example.com",
        passwordHash: hash,
        displayName: "A",
      });
      driverId = await mk({
        role: "DRIVER",
        username: "drv",
        passwordHash: hash,
        displayName: "D",
      });
      inactiveAdminId = await mk({
        role: "ADMIN",
        email: "i@example.com",
        passwordHash: hash,
        displayName: "I",
        active: false,
      });
      await t.prisma.customer.create({
        data: {
          customerNumber: "K-1",
          name: "Müller",
          street: "S 1",
          postalCode: "1010",
          city: "Wien",
        },
      });
    }, 60_000);

    afterAll(async () => {
      await t?.teardown();
    });

    beforeEach(() => {
      state.session = null;
    });

    it("rejects anonymous callers", async () => {
      await expect(listCustomersQuery({})).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    });

    it("rejects drivers", async () => {
      state.session = { user: { id: driverId } };
      await expect(listCustomersQuery({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects deactivated admins", async () => {
      state.session = { user: { id: inactiveAdminId } };
      await expect(listCustomersQuery({})).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    });

    it("lets an admin read", async () => {
      state.session = { user: { id: adminId } };
      const result = await listCustomersQuery({ q: "muller" });
      expect(result.rows.map((r) => r.customerNumber)).toEqual(["K-1"]);
    });
  },
);
