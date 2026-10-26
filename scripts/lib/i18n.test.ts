import { describe, expect, it } from "vitest";

import { type CheckInput, checkMessages, expectedKeys, flatten, type MessageTree } from "./i18n";

const de: MessageTree = {
  common: { b: "Nudeln" },
  driver: { c: "Anzahl: {count, plural, one {# Stück} other {# Stück}}" },
  admin: { d: "Nur Büro" },
};
const en: MessageTree = {
  common: { b: "Noodles" },
  driver: { c: "Count: {count, plural, one {# piece} other {# pieces}}" },
  admin: { d: "Office only" },
};
const hans: MessageTree = {
  common: { b: "意大利面" },
  driver: { c: "数量：{count, plural, other {# 个}}" },
  admin: { d: "仅办公室" },
};
const sr: MessageTree = {
  common: { b: "Nudle" },
  driver: { c: "Broj: {count, plural, one {# komad} few {# komada} other {# komada}}" },
};
const cs: MessageTree = {
  common: { b: "Nudle" },
  driver: {
    c: "Počet: {count, plural, one {# kus} few {# kusy} many {# kusu} other {# kusů}}",
  },
};

function input(patch: Partial<CheckInput> = {}): CheckInput {
  return { de, en, "sr-Latn": sr, cs, "zh-Hans": hans, ...patch };
}

describe("expectedKeys", () => {
  it("full catalogs carry every key, driver-only languages the driver namespaces only", () => {
    const keys = Object.keys(flatten(de));
    expect(expectedKeys("en", keys)).toEqual(keys);
    expect(expectedKeys("sr-Latn", keys)).toEqual(["common.b", "driver.c"]);
    expect(expectedKeys("cs", keys)).toEqual(["common.b", "driver.c"]);
  });
});

describe("checkMessages", () => {
  it("passes for consistent files", () => {
    expect(checkMessages(input())).toEqual([]);
  });

  it("fails when a key is removed from zh-Hans.json", () => {
    const errors = checkMessages(
      input({ "zh-Hans": { common: { b: "意大利面" }, admin: hans.admin } }),
    );
    expect(errors).toContain('zh-Hans: missing key "driver.c"');
  });

  it("fails when a driver key is missing in Serbian or Czech", () => {
    const errors = checkMessages(input({ "sr-Latn": { common: { b: "Nudle" } }, cs: {} }));
    expect(errors).toContain('sr-Latn: missing key "driver.c"');
    expect(errors).toContain('cs: missing key "common.b"');
  });

  it("fails when a driver-only language carries an office key", () => {
    const errors = checkMessages(input({ cs: { ...cs, admin: { d: "Kancelář" } } }));
    expect(errors.some((e) => e.includes('cs: key "admin.d" does not belong'))).toBe(true);
  });

  it("fails on empty values and invalid ICU syntax", () => {
    const errors = checkMessages(
      input({ de: { ...de, common: { b: " " }, driver: { c: "{count, plural, one {#" } } }),
    );
    expect(errors.some((e) => e.includes('de: empty value for "common.b"'))).toBe(true);
    expect(errors.some((e) => e.includes('de: invalid ICU message "driver.c"'))).toBe(true);
  });

  it("fails when a placeholder differs from German", () => {
    const errors = checkMessages(
      input({ en: { ...en, driver: { c: "Total: {total, plural, other {# pieces}}" } } }),
    );
    expect(errors.join("\n")).toMatch(
      /en: placeholders of "driver\.c" differ from German \(missing: count; unexpected: total\)/,
    );
  });

  it("requires the plural categories of Czech (few, many) and Serbian (few)", () => {
    const errors = checkMessages(
      input({
        cs: { ...cs, driver: { c: "{count, plural, one {# kus} other {# kusů}}" } },
        "sr-Latn": { ...sr, driver: { c: "{count, plural, one {# komad} other {# komada}}" } },
      }),
    );
    expect(errors).toContain('cs: plural in "driver.c" lacks few, many');
    expect(errors).toContain('sr-Latn: plural in "driver.c" lacks few');
  });
});
