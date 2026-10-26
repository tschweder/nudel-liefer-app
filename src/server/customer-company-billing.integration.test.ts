// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCustomer, getCustomerDetail, updateCustomer } from "./customer-admin";
import { commitImport } from "./customer-import";
import { listCustomers } from "./customers";
import { createTestDb, type TestDb } from "./test-db";
import { FakeTranslator } from "./translator/fake";

/** NUD-136: company name, VAT id and billing address on the customer (form + import + search). */
describe.skipIf(!process.env.DATABASE_URL)(
  "customer company and billing data",
  { timeout: 120_000 },
  () => {
    let t: TestDb;
    const translator = new FakeTranslator();

    beforeAll(async () => {
      t = await createTestDb();
    }, 60_000);
    afterAll(async () => {
      await t?.teardown();
    });

    const base = {
      customerNumber: "K-1",
      name: "099 wok",
      street: "Testgasse 1",
      postalCode: "1150",
      city: "Wien",
    };

    it("the form stores, shows and clears the office fields; the search finds the company", async () => {
      const created = await createCustomer(
        t.prisma,
        {
          ...base,
          companyName: "Wok Muster GmbH",
          vatId: "ATU12345678",
          billingStreet: "",
          billingCity: " ",
        },
        { translator },
      );
      expect(created.ok).toBe(true);
      const id = (created as { id: string }).id;
      expect(await getCustomerDetail(t.prisma, id)).toMatchObject({
        companyName: "Wok Muster GmbH",
        vatId: "ATU12345678",
        billingStreet: null,
        billingCity: null,
      });

      const hits = await listCustomers(t.prisma, { q: "muster gmbh" });
      expect(hits.rows.map((r) => r.id)).toEqual([id]);
      expect((await listCustomers(t.prisma, { q: "ATU12345678" })).total).toBe(1);

      const updated = await updateCustomer(
        t.prisma,
        id,
        {
          ...base,
          companyName: "",
          vatId: "ATU12345678",
          billingStreet: "Rechnungsweg 2",
          billingPostalCode: "1010",
          billingCity: "Wien",
        },
        { translator },
      );
      expect(updated.ok).toBe(true);
      expect(await getCustomerDetail(t.prisma, id)).toMatchObject({
        companyName: null,
        billingStreet: "Rechnungsweg 2",
        billingPostalCode: "1010",
      });
      expect((await listCustomers(t.prisma, { q: "muster gmbh" })).total).toBe(0);
    });

    it("imports the factory list without numbers and re-imports it unchanged", async () => {
      await t.prisma.customer.deleteMany({});
      const records = [
        {
          line: 2,
          values: {
            name: "Bipa",
            companyName: "Asia Bistro GmbH",
            street: "Naschmarkt",
            houseNumber: "11",
            postalCode: "1040",
            city: "Wien",
            vatId: "atu 6124 5913",
            deliveryAddress: "",
          },
        },
        {
          line: 3,
          values: {
            name: "Edo",
            companyName: "Edo GmbH",
            street: "Goldschmiedgasse",
            houseNumber: "9/1/3a",
            postalCode: "1010",
            city: "Wien",
            vatId: "",
            deliveryAddress: "Schönbrunnerstrasse 230/E101120 Wien",
          },
        },
      ];
      const first = await commitImport(t.prisma, { records });
      expect(first).toMatchObject({ ok: true, created: 2, failed: [] });
      const rows = await t.prisma.customer.findMany({ orderBy: { customerNumber: "asc" } });
      expect(rows.map((r) => [r.customerNumber, r.name])).toEqual([
        ["1001", "Bipa"],
        ["1002", "Edo"],
      ]);
      expect(rows[0]).toMatchObject({
        street: "Naschmarkt 11",
        vatId: "ATU61245913",
        companyName: "Asia Bistro GmbH",
        billingStreet: null,
        pinConfirmed: false,
      });
      expect(rows[1]).toMatchObject({
        street: "Schönbrunnerstrasse 230/E10",
        postalCode: "1120",
        billingStreet: "Goldschmiedgasse 9/1/3a",
        billingPostalCode: "1010",
        billingCity: "Wien",
      });

      const second = await commitImport(t.prisma, { records });
      expect(second).toMatchObject({ ok: true, created: 0, updated: 0, unchanged: 2 });
      expect(await t.prisma.customer.count()).toBe(2);
    });
  },
);
