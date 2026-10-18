// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildRecords,
  planImport,
  suggestMapping,
  summarizePlan,
} from "../src/domain/customer-import";
import { parseCsv } from "../src/domain/import-file";
import { parseImportFile } from "../src/server/customer-import-upload";
import { fixtureCsv } from "./generate-import-fixtures";

const dir = path.join(process.cwd(), "tests", "fixtures");

describe("committed import fixtures", () => {
  it("customers-150.csv is what the generator writes (run scripts/generate-import-fixtures.ts)", () => {
    expect(readFileSync(path.join(dir, "customers-150.csv"), "utf8")).toBe(fixtureCsv());
  });

  it.each(["customers-150.csv", "customers-150.xlsx"])(
    "%s imports 147 rows and reports 3, with the same data in both formats",
    async (file) => {
      const bytes = new Uint8Array(readFileSync(path.join(dir, file)));
      const { table } = await parseImportFile(bytes, file);
      const csvTable = parseCsv(fixtureCsv());
      // An XLSX row ends at its last filled cell: pad to the header width before comparing.
      const width = csvTable.rows[0]!.length;
      const padded = table.rows.map((r) => [...r, ...Array<string>(width - r.length).fill("")]);
      expect(padded).toEqual(csvTable.rows);
      const records = buildRecords(table, suggestMapping(table.rows[0]!));
      expect(summarizePlan(planImport(records, new Map()))).toEqual({
        create: 147,
        update: 0,
        unchanged: 0,
        error: 3,
      });
    },
  );
});
