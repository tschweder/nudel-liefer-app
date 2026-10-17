// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { FakeGeocoder, setGeocoderForTests } from "./geocoder";
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

const { geocodeAddressAction } = await import("./geocode-actions");

describe.skipIf(!process.env.DATABASE_URL)(
  "geocodeAddressAction authorization",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      setGeocoderForTests(new FakeGeocoder());
      const hash = await hashSecret("123456");
      adminId = (
        await t.prisma.user.create({
          data: { role: "ADMIN", email: "a@example.com", passwordHash: hash, displayName: "A" },
        })
      ).id;
      driverId = (
        await t.prisma.user.create({
          data: { role: "DRIVER", username: "drv", passwordHash: hash, displayName: "D" },
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      setGeocoderForTests(undefined);
      await t?.teardown();
    });

    beforeEach(() => {
      state.session = null;
    });

    it("rejects anonymous callers", async () => {
      await expect(geocodeAddressAction("Graben 1, Wien")).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    });

    it("rejects drivers", async () => {
      state.session = { user: { id: driverId } };
      await expect(geocodeAddressAction("Graben 1, Wien")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("lets an admin geocode and validates the input", async () => {
      state.session = { user: { id: adminId } };
      const ok = await geocodeAddressAction("Graben 1, Wien");
      expect(ok).toMatchObject({ ok: true });
      if (ok.ok) expect(ok.candidates.length).toBeGreaterThan(0);
      expect(await geocodeAddressAction("   ")).toEqual({ ok: false, error: "invalid" });
      expect(await geocodeAddressAction("x".repeat(400))).toEqual({ ok: false, error: "invalid" });
      expect(await geocodeAddressAction(42)).toEqual({ ok: false, error: "invalid" });
    });
  },
);
