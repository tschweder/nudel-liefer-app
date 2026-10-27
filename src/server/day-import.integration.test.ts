// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { runDayImport } from "../../scripts/import-day-orders";
import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

vi.mock("next/cache", () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

const DAY = "2099-06-15";
const HEADER = "customerNumber;menge;Karton;notizen";
const enc = (text: string) => new TextEncoder().encode(text);

describe.skipIf(!process.env.DATABASE_URL)(
  "one-off day import (NUD-155)",
  { timeout: 120_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    const ids: Record<string, string> = {};

    /** Runs the CLI against the test database with the given file content. */
    async function run(csv: string | Uint8Array, ...args: string[]) {
      const out: string[] = [];
      const err: string[] = [];
      const bytes = typeof csv === "string" ? enc(csv) : csv;
      const code = await runDayImport(["file.csv", ...args], {
        db: t.prisma,
        out: (l) => out.push(l),
        err: (l) => err.push(l),
        readFile: () => bytes,
        env: {},
      });
      return { code, out: out.join("\n"), err: err.join("\n") };
    }

    const orders = () =>
      t.prisma.order.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          items: { include: { product: { select: { sku: true } } } },
          customer: { select: { customerNumber: true } },
        },
      });
    const noteDe = async (number: string) => {
      const c = await t.prisma.customer.findUniqueOrThrow({ where: { customerNumber: number } });
      return (c.notes as { de?: string } | null)?.de ?? null;
    };

    beforeAll(async () => {
      t = await createTestDb();
      adminId = (
        await t.prisma.user.create({
          data: {
            role: "ADMIN",
            email: "admin@example.com",
            passwordHash: await hashSecret("123456"),
            displayName: "A",
          },
        })
      ).id;
      // The migrations already seed the real catalog (NUDELN-KARTON / NUDELN-BEUTEL).
      const base = { street: "Hauptstraße 1", postalCode: "1010", city: "Wien" };
      const mk = async (customerNumber: string, extra: Record<string, unknown> = {}) => {
        const c = await t.prisma.customer.create({
          data: {
            customerNumber,
            name: `Kunde ${customerNumber}`,
            ...base,
            lat: 48.2,
            lng: 16.37,
            ...extra,
          },
        });
        ids[customerNumber] = c.id;
      };
      await mk("1006");
      await mk("1049", {
        lat: null,
        lng: null,
        notes: {
          de: "Hintereingang",
          meta: { source: "de", machine: {}, updatedAt: new Date().toISOString() },
        },
      });
      await mk("1073");
      await mk("1100", { active: false });
    }, 120_000);

    afterAll(async () => {
      await t?.teardown();
    });

    const file = (rows: string[]) => `﻿${[HEADER, ...rows].join("\r\n")}\r\n`;

    it("dry run prints the table and writes nothing", async () => {
      const csv = file(["1006;3;ja;R · 35 €", "1049;4;nein;", "1073;6;nein;bar 6 €"]);
      const r = await run(csv, "--date", DAY);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Kunde 1006");
      expect(r.out).toContain("Karton 10 kg");
      expect(r.out).toContain("Would create:  3 confirmed orders for 3 customers");
      expect(r.out).toContain("DRY RUN: nothing was written");
      expect(r.out).toMatch(/WARNING row 3: no address point and no Parkplatz/);
      expect(await orders()).toHaveLength(0);
      expect(await noteDe("1006")).toBeNull();
      expect(await t.prisma.auditLog.count()).toBe(0);
    });

    it("apply creates confirmed whole-day orders, sets / keeps notes and attributes the admin", async () => {
      const csv = file(["1006;3;ja;R · 35 €", "1049;4;nein;", "1073;6;nein;bar 6 €"]);
      const r = await run(csv, "--date", DAY, "--apply");
      expect(r.code).toBe(0);
      expect(r.out).toContain("Orders created:  3");
      expect(r.out).toContain("Notes changed:   2");
      expect(r.out).toContain("Touren > Freigeben");

      const rows = await orders();
      expect(rows).toHaveLength(3);
      const byNumber = Object.fromEntries(rows.map((o) => [o.customer.customerNumber, o]));
      for (const o of rows) {
        expect(o.status).toBe("CONFIRMED");
        expect(o.deliveryDate.toISOString().slice(0, 10)).toBe(DAY);
        expect(o.windowFrom.toISOString().slice(0, 10)).toBe(DAY);
        expect(o.windowTo.toISOString().slice(0, 10)).toBe(DAY);
        expect(o.windowFromTime).toBeNull();
        expect(o.windowToTime).toBeNull();
        expect(o.createdById).toBe(adminId);
        expect(o.internalNote).toMatch(/^CSV day import [0-9a-f]{16} 2099-06-15 row \d+$/);
        expect(o.items).toHaveLength(1);
      }
      expect(byNumber["1006"]!.items[0]).toMatchObject({
        quantity: 3,
        product: { sku: "NUDELN-KARTON" },
      });
      expect(byNumber["1049"]!.items[0]).toMatchObject({
        quantity: 4,
        product: { sku: "NUDELN-BEUTEL" },
      });
      expect(byNumber["1073"]!.items[0]).toMatchObject({
        quantity: 6,
        product: { sku: "NUDELN-BEUTEL" },
      });
      for (const o of rows) expect(r.out).toContain(o.id);

      expect(await noteDe("1006")).toBe("R · 35 €");
      expect(await noteDe("1049")).toBe("Hintereingang");
      expect(await noteDe("1073")).toBe("bar 6 €");
      // The translation pipeline: German only, pending for the retry job.
      const c = await t.prisma.customer.findUniqueOrThrow({ where: { customerNumber: "1006" } });
      expect((c.notes as { meta: { pendingTranslation?: boolean } }).meta.pendingTranslation).toBe(
        true,
      );

      const audits = await t.prisma.auditLog.findMany({ where: { action: "order.create" } });
      expect(audits).toHaveLength(3);
      expect(audits.every((a) => a.actorId === adminId)).toBe(true);
    });

    it("refuses to apply the same file and day twice, but allows another day", async () => {
      const csv = file(["1006;3;ja;R · 35 €", "1049;4;nein;", "1073;6;nein;bar 6 €"]);
      const before = (await orders()).length;
      const again = await run(csv, "--date", DAY, "--apply");
      expect(again.code).toBe(2);
      expect(again.err).toContain("already imported");
      const dry = await run(csv, "--date", DAY);
      expect(dry.out).toContain("already imported");
      expect((await orders()).length).toBe(before);

      const otherDay = await run(csv, "--date", "2099-06-16", "--apply");
      expect(otherDay.code).toBe(0);
      expect((await orders()).length).toBe(before + 3);
      // Same notes again: nothing is appended twice.
      expect(await noteDe("1006")).toBe("R · 35 €");
    });

    it("warns about customers that already have a confirmed order that day", async () => {
      const r = await run(file(["1006;1;nein;"]), "--date", DAY);
      expect(r.out).toMatch(/already has 1 confirmed order\(s\)/);
    });

    it("refuses rows with errors; --skip-errors leaves them out; dry run exits 2", async () => {
      const day = "2099-07-01";
      const csv = file([
        "1006;2;ja;",
        "9999;1;ja;",
        "1073;2,5;ja;",
        "1073;1;vielleicht;",
        "1100;1;ja;",
        "1073;1;nein;",
      ]);
      const dry = await run(csv, "--date", day);
      expect(dry.code).toBe(2);
      expect(dry.out).toContain("Unknown customerNumber 9999");
      expect(dry.out).toContain("Customer is deactivated");
      const count = (await orders()).length;

      const refused = await run(csv, "--date", day, "--apply");
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("REFUSED");
      expect((await orders()).length).toBe(count);

      const ok = await run(csv, "--date", day, "--apply", "--skip-errors");
      expect(ok.code).toBe(0);
      expect(ok.out).toContain("Rows left out:   3, 4, 5, 6");
      expect((await orders()).length).toBe(count + 2);
    });

    it("several rows of one customer give several orders and the note is added once per distinct text", async () => {
      const day = "2099-07-02";
      const r = await run(
        file(["1073;1;ja;Tor offen", "1073;2;nein;Tor offen", "1073;3;nein;"]),
        "--date",
        day,
        "--apply",
      );
      expect(r.code).toBe(0);
      const mine = (await orders()).filter((o) => o.deliveryDate.toISOString().startsWith(day));
      expect(mine).toHaveLength(3);
      expect(await noteDe("1073")).toBe("bar 6 € | Tor offen");
    });

    it("appends to an existing note, and --replace-notes overwrites it", async () => {
      const append = await run(file(["1049;1;nein;R · 20 €"]), "--date", "2099-07-03", "--apply");
      expect(append.code).toBe(0);
      expect(await noteDe("1049")).toBe("Hintereingang | R · 20 €");
      const replace = await run(
        file(["1049;1;nein;nur bar"]),
        "--date",
        "2099-07-04",
        "--apply",
        "--replace-notes",
      );
      expect(replace.code).toBe(0);
      expect(await noteDe("1049")).toBe("nur bar");
    });

    it("--resume creates only the rows that have no order after an interrupted run", async () => {
      const day = "2099-08-01";
      const csv = file(["1006;1;ja;", "1049;2;nein;", "1073;3;nein;"]);
      expect((await run(csv, "--date", day, "--apply")).code).toBe(0);
      const lost = (await orders()).find(
        (o) => o.deliveryDate.toISOString().startsWith(day) && o.customer.customerNumber === "1073",
      )!;
      await t.prisma.order.delete({ where: { id: lost.id } });

      const refused = await run(csv, "--date", day, "--apply");
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("--resume");
      const resumed = await run(csv, "--date", day, "--apply", "--resume");
      expect(resumed.code).toBe(0);
      expect(resumed.out).toContain("Orders created:  1");
      expect(resumed.out).toContain("Skipped (done earlier): 2");
      const mine = (await orders()).filter((o) => o.deliveryDate.toISOString().startsWith(day));
      expect(mine).toHaveLength(3);
    });

    it("fatal problems exit 1 and write nothing", async () => {
      const count = (await orders()).length;
      expect((await run("customerNumber,menge\n1,1", "--apply")).code).toBe(1);
      expect((await run(Uint8Array.from([0x31, 0x3b, 0xe4, 0x3b]), "--apply")).err).toContain(
        "UTF-8",
      );
      expect((await run(file(["1006;1;ja;"]), "--date", "2001-01-01", "--apply")).err).toContain(
        "past",
      );
      expect((await run(file(["1006;1;ja;"]), "--date", "31.12.2099")).code).toBe(1);
      expect(
        (await run(file(["1006;1;ja;"]), "--actor", "nobody@example.com", "--date", DAY)).code,
      ).toBe(1);
      expect((await run(file(["1006;1;ja;"]), "--translate-now")).code).toBe(1);
      expect((await run(file(["1006;1;ja;"]), "--bogus")).code).toBe(1);
      expect((await orders()).length).toBe(count);
    });

    it("uses today in Europe/Vienna by default", async () => {
      const r = await runDayImport(["f.csv"], {
        db: t.prisma,
        out: () => undefined,
        err: () => undefined,
        readFile: () => enc(file(["1006;1;ja;"])),
        now: new Date("2099-12-31T23:30:00Z"),
        env: {},
      });
      expect(r).toBe(0);
      const lines: string[] = [];
      await runDayImport(["f.csv"], {
        db: t.prisma,
        out: (l) => lines.push(l),
        err: () => undefined,
        readFile: () => enc(file(["1006;1;ja;"])),
        now: new Date("2099-12-31T23:30:00Z"),
        env: {},
      });
      expect(lines.join("\n")).toContain("Delivery day:  2100-01-01");
    });
  },
);
