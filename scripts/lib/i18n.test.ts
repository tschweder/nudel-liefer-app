import { describe, expect, it } from "vitest";

import { buildHant, type CheckInput, checkMessages, flatten, type MessageTree } from "./i18n";

const de: MessageTree = {
  a: { b: "Nudeln" },
  c: "Anzahl: {count, plural, one {# Stück} other {# Stück}}",
};
const hans: MessageTree = { a: { b: "意大利面" }, c: "数量：{count, plural, other {# 个}}" };
const noOverrides = { "zh-Hant-HK": {}, "zh-Hant-TW": {} };

function inputWith(overrides = noOverrides, patch: Partial<CheckInput> = {}): CheckInput {
  return {
    de,
    "zh-Hans": hans,
    "zh-Hant-HK": buildHant("zh-Hant-HK", hans, overrides["zh-Hant-HK"]),
    "zh-Hant-TW": buildHant("zh-Hant-TW", hans, overrides["zh-Hant-TW"]),
    overrides,
    ...patch,
  };
}

describe("buildHant", () => {
  it("converts via OpenCC and adds the generated header", () => {
    const tw = buildHant("zh-Hant-TW", hans, {});
    expect(tw._generated).toMatch(/DO NOT EDIT/);
    expect(flatten(tw)["a.b"]).toBe("義大利麵");
    expect(flatten(buildHant("zh-Hant-HK", hans, {}))["a.b"]).toBe("意大利麪");
  });

  it("lets override files win over OpenCC output", () => {
    const tw = buildHant("zh-Hant-TW", hans, { a: { b: "手工意麵" } });
    expect(flatten(tw)["a.b"]).toBe("手工意麵");
    expect(flatten(tw)["c"]).toContain("數量");
  });
});

describe("checkMessages", () => {
  it("passes for consistent files", () => {
    expect(checkMessages(inputWith())).toEqual([]);
  });

  it("fails when a key is removed from zh-Hans.json", () => {
    const errors = checkMessages(inputWith(noOverrides, { "zh-Hans": { a: { b: "意大利面" } } }));
    expect(errors).toContain('zh-Hans: missing key "c"');
  });

  it("fails on empty values and invalid ICU syntax", () => {
    const errors = checkMessages(
      inputWith(noOverrides, { de: { a: { b: " " }, c: "{count, plural, one {#" } }),
    );
    expect(errors.some((e) => e.includes('de: empty value for "a.b"'))).toBe(true);
    expect(errors.some((e) => e.includes('de: invalid ICU message "c"'))).toBe(true);
  });

  it("fails when a generated file is stale or hand-edited", () => {
    const stale = inputWith();
    stale["zh-Hant-TW"] = { ...stale["zh-Hant-TW"], a: { b: "手改" } };
    expect(
      checkMessages(stale).some((e) => e.includes("zh-Hant-TW: generated file is stale")),
    ).toBe(true);
  });

  it("fails on override keys that do not exist in zh-Hans", () => {
    const overrides = { "zh-Hant-HK": { nope: "x" }, "zh-Hant-TW": {} };
    expect(checkMessages(inputWith(overrides)).join("\n")).toContain(
      'overrides/zh-Hant-HK: unknown key "nope"',
    );
  });
});
