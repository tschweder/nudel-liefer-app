// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { escapeLike, listCustomers, searchTerms } from "./customers";
import { createTestDb, type TestDb } from "./test-db";
import { seedTestCustomers } from "./testing/seed-customers";

describe("search helpers", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  });
  it("splits terms and caps their number", () => {
    expect(searchTerms("  a   b ")).toEqual(["a", "b"]);
    expect(searchTerms("1 2 3 4 5 6 7 8 9 10")).toHaveLength(8);
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "customer list (PostgreSQL)",
  { timeout: 120_000 },
  () => {
    let t: TestDb;
    let userId: string;

    const base = { street: "Teststraße 1", postalCode: "1010", city: "Wien" };
    const numbers = (r: { rows: { customerNumber: string }[] }) =>
      r.rows.map((c) => c.customerNumber).sort();

    beforeAll(async () => {
      t = await createTestDb();
      userId = (
        await t.prisma.user.create({
          data: { role: "ADMIN", email: "a@example.com", passwordHash: "x", displayName: "A" },
        })
      ).id;
    }, 60_000);
    afterAll(async () => {
      await t?.teardown();
    });

    it("finds accented / umlaut / sharp-s names without accents and in any case", async () => {
      await t.prisma.customer.createMany({
        data: [
          { customerNumber: "A-1", name: "Gasthaus Müller", ...base },
          { customerNumber: "A-2", name: "Café Österreich", ...base, street: "Hauptstraße 5" },
          { customerNumber: "A-3", name: "Pizzeria Šarić", ...base, city: "Zürich" },
          { customerNumber: "A-4", name: "Trattoria Bella", ...base },
          { customerNumber: "A-5", name: "北京饭店 Peking", ...base },
        ],
      });
      const find = async (q: string) => numbers(await listCustomers(t.prisma, { q }));
      expect(await find("muller")).toEqual(["A-1"]);
      expect(await find("MÜLLER")).toEqual(["A-1"]);
      expect(await find("cafe osterreich")).toEqual(["A-2"]);
      expect(await find("strasse")).toEqual(expect.arrayContaining(["A-2"]));
      expect(await find("saric")).toEqual(["A-3"]);
      expect(await find("zurich")).toEqual(["A-3"]);
      expect(await find("a-4")).toEqual(["A-4"]);
      expect(await find("北京")).toEqual(["A-5"]);
      expect(await find("nomatch")).toEqual([]);
      // all terms must match (AND)
      expect(await find("gasthaus bella")).toEqual([]);
      expect(await find("gasthaus muller wien")).toEqual(["A-1"]);
    });

    it("treats % _ and \\ literally", async () => {
      expect((await listCustomers(t.prisma, { q: "%" })).total).toBe(0);
      expect((await listCustomers(t.prisma, { q: "_" })).total).toBe(0);
      expect((await listCustomers(t.prisma, { q: "\\" })).total).toBe(0);
      expect((await listCustomers(t.prisma, { q: '\'; DROP TABLE "Customer"; --' })).total).toBe(0);
      expect((await listCustomers(t.prisma, {})).total).toBeGreaterThan(0);
    });

    it("keeps the search text current when a customer is edited", async () => {
      await t.prisma.customer.update({
        where: { customerNumber: "A-4" },
        data: { street: "Löwengasse 9" },
      });
      expect(numbers(await listCustomers(t.prisma, { q: "lowengasse" }))).toEqual(["A-4"]);
      expect(numbers(await listCustomers(t.prisma, { q: "teststrasse bella" }))).toEqual([]);
    });

    it("status filter: active by default, archived, all", async () => {
      await t.prisma.customer.update({ where: { customerNumber: "A-5" }, data: { active: false } });
      expect(numbers(await listCustomers(t.prisma, { q: "peking" }))).toEqual([]);
      const archived = await listCustomers(t.prisma, { q: "peking", status: "archived" });
      expect(numbers(archived)).toEqual(["A-5"]);
      expect(archived.rows[0]!.active).toBe(false);
      expect(numbers(await listCustomers(t.prisma, { q: "peking", status: "all" }))).toEqual([
        "A-5",
      ]);
    });

    it("photo filter shows exactly customers lacking a current STORE or PARKING photo", async () => {
      const mk = async (customerNumber: string) =>
        (
          await t.prisma.customer.create({
            data: { customerNumber, name: customerNumber, ...base },
          })
        ).id;
      const photo = (customerId: string, kind: "STORE" | "PARKING", isCurrent = true) =>
        t.prisma.photo.create({
          data: {
            customerId,
            kind,
            storageKey: `k/${customerId}/${kind}/${isCurrent}`,
            width: 1,
            height: 1,
            bytes: 1,
            uploadedById: userId,
            isCurrent,
          },
        });
      const none = await mk("P-NONE");
      const storeOnly = await mk("P-STORE");
      const parkingOnly = await mk("P-PARK");
      const both = await mk("P-BOTH");
      const oldBoth = await mk("P-OLD"); // both photos exist but are replaced (not current)
      const mixed = await mk("P-MIXED"); // current store + replaced parking
      await photo(storeOnly, "STORE");
      await photo(parkingOnly, "PARKING");
      await photo(both, "STORE");
      await photo(both, "PARKING");
      await photo(oldBoth, "STORE", false);
      await photo(oldBoth, "PARKING", false);
      await photo(mixed, "STORE");
      await photo(mixed, "PARKING", false);
      expect(none).toBeTruthy();

      const missing = await listCustomers(t.prisma, { q: "P-", photosMissing: true });
      expect(numbers(missing)).toEqual(["P-MIXED", "P-NONE", "P-OLD", "P-PARK", "P-STORE"]);
      expect(missing.rows.every((r) => r.photosMissing)).toBe(true);
      const all = await listCustomers(t.prisma, { q: "P-" });
      expect(all.rows.find((r) => r.customerNumber === "P-BOTH")!.photosMissing).toBe(false);
    });

    it("Parkplatz filter and flag (NUD-141)", async () => {
      const withSpot = await t.prisma.customer.create({
        data: { customerNumber: "C-PARK", name: "Parked", ...base },
      });
      await t.prisma.customer.create({
        data: { customerNumber: "C-NOPARK", name: "Parked without", ...base },
      });
      await t.prisma.parkingSpot.create({
        data: { customerId: withSpot.id, lat: 48.2, lng: 16.3, createdById: userId },
      });
      const missing = await listCustomers(t.prisma, { q: "parked", parkingMissing: true });
      expect(missing.rows.map((r) => r.customerNumber)).toEqual(["C-NOPARK"]);
      const all = await listCustomers(t.prisma, { q: "parked" });
      expect(Object.fromEntries(all.rows.map((r) => [r.customerNumber, r.parkingMissing]))).toEqual(
        {
          "C-PARK": false,
          "C-NOPARK": true,
        },
      );
      // A removed spot no longer counts.
      await t.prisma.parkingSpot.updateMany({
        where: { customerId: withSpot.id },
        data: { active: false },
      });
      expect((await listCustomers(t.prisma, { q: "parked", parkingMissing: true })).total).toBe(2);
    });

    it("rejects invalid input", async () => {
      await expect(listCustomers(t.prisma, { page: 0 })).rejects.toThrow();
      await expect(listCustomers(t.prisma, { status: "x" })).rejects.toThrow();
      await expect(listCustomers(t.prisma, { pageSize: 1000 })).rejects.toThrow();
    });

    it("paginates and finds a name part in < 300 ms with 500 seeded customers", async () => {
      const inserted = await seedTestCustomers(t.prisma, {
        count: 500,
        prefix: "S-",
        uploadedById: userId,
      });
      expect(inserted).toBe(500);

      const page1 = await listCustomers(t.prisma, { q: "s-", status: "all" });
      expect(page1.total).toBe(500);
      expect(page1.rows).toHaveLength(25);
      expect(page1.pageCount).toBe(20);
      const page20 = await listCustomers(t.prisma, { q: "s-", status: "all", page: 20 });
      expect(page20.rows).toHaveLength(25);
      const beyond = await listCustomers(t.prisma, { q: "s-", status: "all", page: 99 });
      expect(beyond.rows).toHaveLength(0);
      expect(beyond.total).toBe(500);

      // Warm up (connection, plan), then take the slowest of several runs.
      await listCustomers(t.prisma, { q: "muller" });
      const queries = ["muller", "osterreicher", "trattoria", "bahnhofstrasse wien", "gro", "m"];
      const timings: number[] = [];
      for (const q of queries) {
        const start = performance.now();
        const result = await listCustomers(t.prisma, { q, status: "all" });
        timings.push(performance.now() - start);
        expect(result.total).toBeGreaterThan(0);
      }
      const accented = await listCustomers(t.prisma, { q: "Müller", status: "all" });
      const plain = await listCustomers(t.prisma, { q: "muller", status: "all" });
      expect(accented.total).toBe(plain.total);
      console.log(`customer search timings (ms): ${timings.map((x) => x.toFixed(1)).join(", ")}`);
      expect(Math.max(...timings)).toBeLessThan(300);
    });
  },
);
