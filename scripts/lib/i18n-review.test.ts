// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkMessages, flatten, type MessageTree } from "./i18n";
import { readSources } from "./i18n-files";
import {
  exportReview,
  importReview,
  parseCsv,
  placeholderNames,
  REVIEW_COLUMNS,
  toCsv,
} from "./i18n-review";
import { ROUTE_HINTS, routeHint } from "./i18n-routes";

const realMessages = path.join(process.cwd(), "messages");
const LOCALE_FILES = ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "i18n-review-"));
  cpSync(realMessages, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function readAll(d: string) {
  const read = (rel: string) => flatten(JSON.parse(readFileSync(path.join(d, rel), "utf8")));
  return {
    de: read("de.json"),
    "zh-Hans": read("zh-Hans.json"),
    "zh-Hant-HK": read("zh-Hant-HK.json"),
    "zh-Hant-TW": read("zh-Hant-TW.json"),
    "ov-HK": read("overrides/zh-Hant-HK.json"),
    "ov-TW": read("overrides/zh-Hant-TW.json"),
  };
}

function changedKeys(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
}

/** Fills correction cells in an exported CSV and returns the new CSV text. */
function editCsv(
  csv: string,
  edits: Record<string, Partial<Record<"hans" | "hk" | "tw" | "comment", string>>>,
  delimiter = ",",
): string {
  const rows = parseCsv(csv);
  const idx = (name: string) => rows[0].indexOf(name);
  for (const row of rows.slice(1)) {
    const edit = edits[row[0]];
    if (!edit) continue;
    if (edit.hans !== undefined) row[idx("corrected_zh-Hans")] = edit.hans;
    if (edit.hk !== undefined) row[idx("corrected_zh-Hant-HK")] = edit.hk;
    if (edit.tw !== undefined) row[idx("corrected_zh-Hant-TW")] = edit.tw;
    if (edit.comment !== undefined) row[idx("reviewer_comment")] = edit.comment;
  }
  return toCsv(rows, delimiter);
}

describe("CSV", () => {
  const tricky = [
    ["a,b", 'say "hi"', "line1\nline2", "{count, plural, other {# 个}}", "繁體中文（台灣）", ""],
    ["x", "y;z", "tab\there", "crlf\r\nrow", "", "last"],
  ];

  it("round-trips quoting, newlines, ICU braces, CJK and empty cells", () => {
    for (const delimiter of [",", ";", "\t"]) {
      const csv = toCsv([["k1", "k2", "k3", "k4", "k5", "k6"], ...tricky], delimiter);
      expect(parseCsv(csv)).toEqual([["k1", "k2", "k3", "k4", "k5", "k6"], ...tricky]);
    }
  });

  it("starts with a UTF-8 BOM so Excel detects the encoding, and tolerates its absence", () => {
    const csv = toCsv([["key"], ["a"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(parseCsv(csv.slice(1))).toEqual([["key"], ["a"]]);
  });

  it("accepts LF line endings and ignores blank trailing lines", () => {
    expect(parseCsv("key,x\na,1\n\n,\n")).toEqual([
      ["key", "x"],
      ["a", "1"],
    ]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCsv('key\n"abc')).toThrow(/unterminated/);
  });
});

describe("placeholderNames", () => {
  it("collects arguments inside plural / select / tags", () => {
    const names = placeholderNames(
      "{n, plural, one {# <b>{who}</b>} other {{kind, select, a {x} other {y}}}}",
      "en",
    );
    expect([...names].sort()).toEqual(["b", "kind", "n", "who"]);
  });
});

describe("route hints", () => {
  it("covers every message key", () => {
    const { withoutHint } = exportReview(dir);
    expect(withoutHint).toEqual([]);
  });

  it("has no stale prefixes (each matches at least one key)", () => {
    const keys = Object.keys(flatten(readSources(dir).de));
    for (const [prefix] of ROUTE_HINTS) {
      expect(
        keys.some((k) => k === prefix || k.startsWith(`${prefix}.`)),
        `route hint prefix "${prefix}" matches no key`,
      ).toBe(true);
    }
  });

  it("uses the longest matching prefix", () => {
    expect(routeHint("admin.orders.form.title")).toBe("/admin/orders/new");
    expect(routeHint("admin.orders.title")).toBe("/admin/orders");
    expect(routeHint("nonexistent.key")).toBe("");
  });
});

describe("export", () => {
  it("writes one row per key with the documented columns and generated Hant text", () => {
    const { csv, rows } = exportReview(dir);
    const table = parseCsv(csv);
    expect(table[0]).toEqual([...REVIEW_COLUMNS]);
    expect(table).toHaveLength(rows + 1);
    const all = readAll(dir);
    expect(rows).toBe(Object.keys(all.de).length);
    const save = table.find((r) => r[0] === "common.actions.save")!;
    expect(save.slice(1, 5)).toEqual([
      all.de["common.actions.save"],
      all["zh-Hans"]["common.actions.save"],
      all["zh-Hant-HK"]["common.actions.save"],
      all["zh-Hant-TW"]["common.actions.save"],
    ]);
    expect(save[5]).toBe("(shared: buttons on many screens)");
    expect(save.slice(6)).toEqual(["", "", "", ""]);
  });
});

describe("import", () => {
  it("changes nothing for an unedited export", () => {
    const before = LOCALE_FILES.map((l) => readFileSync(path.join(dir, `${l}.json`), "utf8"));
    const result = importReview(dir, exportReview(dir).csv);
    expect(result).toMatchObject({ ok: true, changes: [], written: false });
    expect(LOCALE_FILES.map((l) => readFileSync(path.join(dir, `${l}.json`), "utf8"))).toEqual(
      before,
    );
  });

  it("round trip: export, edit, import changes exactly the edited keys", () => {
    const before = readAll(dir);
    const csv = editCsv(exportReview(dir).csv, {
      "common.actions.save": { hans: "储存", comment: "sounds more natural" },
      "common.actions.delete": { hk: "刪走" },
      "common.actions.search": { tw: "查找" },
      "common.itemsCount": { comment: "only a comment, no correction" },
    });
    const result = importReview(dir, csv);
    expect(result.ok).toBe(true);
    expect(result.comments).toBe(2);
    const after = readAll(dir);

    // hand-edited sources
    expect(changedKeys(before.de, after.de)).toEqual([]);
    expect(changedKeys(before["zh-Hans"], after["zh-Hans"])).toEqual(["common.actions.save"]);
    expect(after["zh-Hans"]["common.actions.save"]).toBe("储存");
    expect(changedKeys(before["ov-HK"], after["ov-HK"])).toEqual(["common.actions.delete"]);
    expect(changedKeys(before["ov-TW"], after["ov-TW"])).toEqual(["common.actions.search"]);
    // generated files: the edited key itself (+ the key derived from the zh-Hans edit)
    expect(changedKeys(before["zh-Hant-HK"], after["zh-Hant-HK"])).toEqual([
      "common.actions.delete",
      "common.actions.save",
    ]);
    // (TW phrase conversion already maps both 保存 and 储存 to 儲存, so only the override differs)
    expect(before["zh-Hant-TW"]["common.actions.save"]).toBe("儲存");
    expect(changedKeys(before["zh-Hant-TW"], after["zh-Hant-TW"])).toEqual([
      "common.actions.search",
    ]);
    expect(after["zh-Hant-HK"]["common.actions.delete"]).toBe("刪走");
    expect(after["zh-Hant-TW"]["common.actions.search"]).toBe("查找");
    expect(after["zh-Hant-TW"]["common.actions.save"]).toBe("儲存");

    // the result passes the same checks as `pnpm i18n:check`
    const s = readSources(dir);
    const read = (l: string) =>
      JSON.parse(readFileSync(path.join(dir, `${l}.json`), "utf8")) as MessageTree;
    expect(
      checkMessages({
        de: s.de,
        "zh-Hans": s.hans,
        "zh-Hant-HK": read("zh-Hant-HK"),
        "zh-Hant-TW": read("zh-Hant-TW"),
        overrides: s.overrides,
      }),
    ).toEqual([]);
  });

  it("accepts a semicolon separated file (German Excel) with edited multi-line cells", () => {
    const csv = editCsv(
      exportReview(dir, ";").csv,
      { "common.actions.save": { hans: "储存" } },
      ";",
    );
    const result = importReview(dir, csv);
    expect(result.changes.map((c) => c.key)).toEqual(["common.actions.save"]);
  });

  it("is a no-op when the correction equals the current text", () => {
    const csv = editCsv(exportReview(dir).csv, {
      "common.actions.save": { hans: "保存", hk: "保存" },
    });
    expect(importReview(dir, csv)).toMatchObject({ ok: true, changes: [], written: false });
  });

  it("removes an override that equals the automatic conversion", () => {
    importReview(dir, editCsv(exportReview(dir).csv, { "common.actions.search": { tw: "查找" } }));
    expect(readAll(dir)["ov-TW"]["common.actions.search"]).toBe("查找");
    const plain = "搜尋";
    const result = importReview(
      dir,
      editCsv(exportReview(dir).csv, { "common.actions.search": { tw: plain } }),
    );
    expect(result.changes).toEqual([
      { file: "overrides/zh-Hant-TW.json", key: "common.actions.search", from: "查找", to: null },
    ]);
    expect(readAll(dir)["ov-TW"]).toEqual({});
    expect(readAll(dir)["zh-Hant-TW"]["common.actions.search"]).toBe(plain);
  });

  it("dry run reports changes but writes nothing", () => {
    const csv = editCsv(exportReview(dir).csv, { "common.actions.save": { hans: "储存" } });
    const before = readAll(dir);
    const result = importReview(dir, csv, { dryRun: true });
    expect(result.changes).toHaveLength(1);
    expect(result.written).toBe(false);
    expect(readAll(dir)).toEqual(before);
  });

  describe("refuses (and writes nothing)", () => {
    const attempt = (mutate: (csv: string) => string, edits = {}) => {
      const before = readAll(dir);
      const csv = mutate(editCsv(exportReview(dir).csv, edits));
      const result = importReview(dir, csv);
      expect(result.ok).toBe(false);
      expect(readAll(dir)).toEqual(before);
      return result.errors.join("\n");
    };

    it("unknown keys", () => {
      const errors = attempt((csv) => `${csv}no.such.key,,,,,,,x,,\r\n`, {
        "common.actions.save": { hans: "储存" },
      });
      expect(errors).toMatch(/unknown key "no\.such\.key"/);
    });

    it("duplicate keys", () => {
      const errors = attempt((csv) => `${csv}common.actions.save,,,,,,,,,\r\n`);
      expect(errors).toMatch(/duplicate key/);
    });
  });

  it("refuses invalid ICU syntax", () => {
    const before = readAll(dir);
    const csv = editCsv(exportReview(dir).csv, {
      "common.itemsCount": { hans: "{count, plural, other {# 个}" },
    });
    const result = importReview(dir, csv);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/invalid ICU syntax/);
    expect(readAll(dir)).toEqual(before);
  });

  it("refuses a changed placeholder set", () => {
    const csv = editCsv(exportReview(dir).csv, {
      "common.itemsCount": { hans: "{total, plural, other {# 个}}" },
    });
    const result = importReview(dir, csv);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(
      /placeholders differ from German \(missing: count; unexpected: total\)/,
    );
  });

  it("refuses when the repository text changed since the export unless --force", () => {
    const csv = editCsv(exportReview(dir).csv, { "common.actions.save": { hans: "储存" } });
    const stale = csv
      .replace("\r\ncommon.actions.save,", "\r\ncommon.actions.save,")
      .replace(",保存,", ",保存 ,");
    expect(importReview(dir, stale, { dryRun: true }).errors.join()).toMatch(
      /changed in the repository/,
    );
    expect(importReview(dir, stale, { dryRun: true, force: true }).ok).toBe(true);
  });

  it("refuses a file that is not an export", () => {
    expect(importReview(dir, "a,b\n1,2\n").errors.join()).toMatch(/missing "key" column/);
    expect(importReview(dir, "key,de\nx,y\n").errors.join()).toMatch(/no "corrected_/);
  });
});
