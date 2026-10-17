// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { photosMissing } from "@/domain/photos";

import { hashSecret } from "./auth/password";
import { FakeStorage } from "./storage/fake";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("next/cache", () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { addCustomerPhotoAction } = await import("./customer-actions");
const { customerPhotosQuery, getCustomerQuery } = await import("./customer-queries");
const { listCustomers } = await import("./customers");
const { setStorageForTests } = await import("./storage");
const { AuthorizationError } = await import("./auth/actor");

let seq = 0;
const newKey = (ext = "jpg") =>
  `customers/${(++seq).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000.${ext}`;

describe.skipIf(!process.env.DATABASE_URL)("customer photos", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let inactiveAdminId: string;
  let storage: FakeStorage;

  const base = { street: "Teststraße 1", postalCode: "1010", city: "Wien" };
  const mkCustomer = async (customerNumber: string) =>
    (await t.prisma.customer.create({ data: { customerNumber, name: customerNumber, ...base } }))
      .id;
  /** Simulates a finished browser upload: the object exists in storage under the issued key. */
  const uploaded = (key = newKey(), bytes = 1234) => {
    storage.put(key, new Uint8Array(bytes), "image/jpeg");
    return key;
  };
  const input = (customerId: string, kind: "STORE" | "PARKING", storageKey: string) => ({
    customerId,
    kind,
    storageKey,
    width: 1600,
    height: 1067,
  });
  const asAdmin = () => {
    state.session = { user: { id: adminId } };
  };

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
    driverId = await mk({ role: "DRIVER", username: "drv", passwordHash: hash, displayName: "D" });
    inactiveAdminId = await mk({
      role: "ADMIN",
      email: "i@example.com",
      passwordHash: hash,
      displayName: "I",
      active: false,
    });
  }, 60_000);
  afterAll(async () => {
    setStorageForTests(undefined);
    await t?.teardown();
  });
  beforeEach(() => {
    state.session = null;
    storage = new FakeStorage();
    setStorageForTests(storage);
  });

  describe("authorization", () => {
    it("rejects anonymous, driver and deactivated callers before touching anything", async () => {
      const customerId = await mkCustomer("AUTH-1");
      const key = uploaded();
      const sessions = [null, { user: { id: driverId } }, { user: { id: inactiveAdminId } }];
      for (const session of sessions) {
        state.session = session;
        await expect(
          addCustomerPhotoAction(input(customerId, "STORE", key)),
          JSON.stringify(session),
        ).rejects.toBeInstanceOf(AuthorizationError);
        await expect(customerPhotosQuery(customerId)).rejects.toBeInstanceOf(AuthorizationError);
      }
      expect(await t.prisma.photo.count({ where: { customerId } })).toBe(0);
    });
  });

  describe("storage key validation", () => {
    it("rejects keys the server did not issue", async () => {
      const customerId = await mkCustomer("KEY-1");
      asAdmin();
      const good = "11111111-2222-4333-8444-555555555555";
      const bad = [
        "",
        "customers/../secret.jpg",
        `customers/${good}.jpg/../../x.jpg`,
        `screenshots/${good}.jpg`,
        `customers/${good}.gif`,
        `customers/${good}.JPG`,
        `customers/${good}`,
        `/customers/${good}.jpg`,
        `customers/other/${good}.jpg`,
        `https://evil.example/customers/${good}.jpg`,
        "customers/not-a-uuid.jpg",
        `customers/${good}.jpg `,
      ];
      for (const key of bad) {
        storage.put(key, new Uint8Array(10), "image/jpeg"); // even if such an object exists
        expect(await addCustomerPhotoAction(input(customerId, "STORE", key)), key).toEqual({
          ok: false,
          error: "invalid",
        });
      }
      expect(await addCustomerPhotoAction({ ...input(customerId, "STORE", 5 as never) })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await t.prisma.photo.count({ where: { customerId } })).toBe(0);
    });

    it("rejects invalid input and objects that were never uploaded", async () => {
      const customerId = await mkCustomer("KEY-2");
      asAdmin();
      const key = uploaded();
      const invalid: Record<string, unknown>[] = [
        { ...input(customerId, "STORE", key), kind: "OTHER" },
        { ...input(customerId, "STORE", key), width: 0 },
        { ...input(customerId, "STORE", key), height: 1.5 },
        { ...input(customerId, "STORE", key), width: 99_999 },
        { ...input(customerId, "STORE", key), customerId: "" },
        { kind: "STORE" },
      ];
      for (const bad of invalid) {
        expect(await addCustomerPhotoAction(bad), JSON.stringify(bad)).toEqual({
          ok: false,
          error: "invalid",
        });
      }
      expect(await addCustomerPhotoAction("nope")).toEqual({ ok: false, error: "invalid" });
      expect(await addCustomerPhotoAction(input(customerId, "STORE", newKey()))).toEqual({
        ok: false,
        error: "object_missing",
      });
      expect(await addCustomerPhotoAction(input("does-not-exist", "STORE", key))).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await t.prisma.photo.count({ where: { customerId } })).toBe(0);
    });

    it("takes the size from the stored object, never from the client, and refuses reuse of a key", async () => {
      const a = await mkCustomer("KEY-3");
      const b = await mkCustomer("KEY-4");
      asAdmin();
      const key = uploaded(newKey(), 4321);
      const res = await addCustomerPhotoAction({ ...input(a, "STORE", key), bytes: 1 });
      expect(res.ok).toBe(true);
      const row = await t.prisma.photo.findFirstOrThrow({ where: { customerId: a } });
      expect(row).toMatchObject({ bytes: 4321, uploadedById: adminId, isCurrent: true });
      expect(await addCustomerPhotoAction(input(b, "PARKING", key))).toEqual({
        ok: false,
        error: "key_in_use",
      });
      expect(await addCustomerPhotoAction(input(a, "STORE", key))).toEqual({
        ok: false,
        error: "key_in_use",
      });
      expect(await t.prisma.photo.count({ where: { storageKey: key } })).toBe(1);
    });
  });

  describe("upload, replace and the photos-missing flag", () => {
    it("upload makes the photo current and visible with a server-signed URL", async () => {
      const customerId = await mkCustomer("UP-1");
      asAdmin();
      expect((await customerPhotosQuery(customerId)).STORE).toBeNull();
      const key = uploaded();
      expect((await addCustomerPhotoAction(input(customerId, "STORE", key))).ok).toBe(true);
      const photos = await customerPhotosQuery(customerId);
      expect(photos.PARKING).toBeNull();
      expect(photos.STORE).toMatchObject({ width: 1600, height: 1067 });
      expect(photos.STORE!.url).toBe(await storage.getReadUrl(key));
      expect((await getCustomerQuery(customerId))!).toMatchObject({
        hasStorePhoto: true,
        hasParkingPhoto: false,
      });
    });

    it("replace keeps the old row as history (isCurrent=false); exactly one current per kind", async () => {
      const customerId = await mkCustomer("REP-1");
      asAdmin();
      const first = uploaded();
      const second = uploaded();
      const third = uploaded();
      const parking = uploaded();
      await addCustomerPhotoAction(input(customerId, "STORE", first));
      await addCustomerPhotoAction(input(customerId, "PARKING", parking));
      await addCustomerPhotoAction(input(customerId, "STORE", second));
      await addCustomerPhotoAction(input(customerId, "STORE", third));

      const rows = await t.prisma.photo.findMany({ where: { customerId } });
      const state = Object.fromEntries(rows.map((r) => [r.storageKey, [r.kind, r.isCurrent]]));
      expect(state).toEqual({
        [first]: ["STORE", false],
        [second]: ["STORE", false],
        [third]: ["STORE", true],
        [parking]: ["PARKING", true],
      });
      const photos = await customerPhotosQuery(customerId);
      expect(photos.STORE!.url).toBe(await storage.getReadUrl(third));
      expect(photos.PARKING!.url).toBe(await storage.getReadUrl(parking));
      // History objects stay in storage: nothing is hard-deleted.
      expect([first, second, third, parking].every((k) => storage.has(k))).toBe(true);
    });

    it("concurrent uploads for one slot never leave two current photos", async () => {
      const customerId = await mkCustomer("REP-2");
      asAdmin();
      const keys = [uploaded(), uploaded(), uploaded(), uploaded()];
      const results = await Promise.all(
        keys.map((k) => addCustomerPhotoAction(input(customerId, "PARKING", k))),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      const rows = await t.prisma.photo.findMany({ where: { customerId } });
      expect(rows).toHaveLength(4);
      expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    });

    it("the flag disappears when both photos exist, consistently in detail and list filter", async () => {
      const customerId = await mkCustomer("FLAG-1");
      asAdmin();
      const flagged = async () => {
        const detail = (await getCustomerQuery(customerId))!;
        const fromDetail = photosMissing([
          ...(detail.hasStorePhoto ? (["STORE"] as const) : []),
          ...(detail.hasParkingPhoto ? (["PARKING"] as const) : []),
        ]);
        const list = await listCustomers(t.prisma, { q: "FLAG-1", photosMissing: true });
        const inFilter = list.rows.some((r) => r.customerNumber === "FLAG-1");
        const row = (await listCustomers(t.prisma, { q: "FLAG-1" })).rows[0];
        expect(row.photosMissing).toBe(fromDetail);
        expect(inFilter).toBe(fromDetail);
        return fromDetail;
      };
      expect(await flagged()).toBe(true);
      await addCustomerPhotoAction(input(customerId, "STORE", uploaded()));
      expect(await flagged()).toBe(true);
      await addCustomerPhotoAction(input(customerId, "PARKING", uploaded()));
      expect(await flagged()).toBe(false);
      await addCustomerPhotoAction(input(customerId, "STORE", uploaded())); // replace keeps it off
      expect(await flagged()).toBe(false);
    });
  });
});
