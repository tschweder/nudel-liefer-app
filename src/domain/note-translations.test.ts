import { describe, expect, it } from "vitest";

import { createLocalizedText, type LocalizedText } from "@/lib/localized-text";

import {
  applyTranslationSave,
  changesSource,
  describeTranslations,
  type FreshTranslations,
  mergeSourceChange,
  retranslateAll,
} from "./note-translations";

const T0 = new Date("2026-10-18T08:00:00.000Z");
const T1 = new Date("2026-10-18T09:00:00.000Z");

const fresh: FreshTranslations = {
  "zh-Hans": "新-简",
  "zh-Hant-HK": "新-港",
  "zh-Hant-TW": "新-台",
};

/** German source, all Chinese versions machine-made. */
const allMachine = () =>
  createLocalizedText(
    { de: "alt", "zh-Hans": "旧-简", "zh-Hant-HK": "旧-港", "zh-Hant-TW": "旧-台" },
    "de",
    {
      machine: { "zh-Hans": true, "zh-Hant-HK": true, "zh-Hant-TW": true },
      now: T0,
    },
  );

/** HK edited by hand. */
const hkManual = (): LocalizedText => {
  const text = allMachine();
  text["zh-Hant-HK"] = "手写-港";
  delete text.meta.machine["zh-Hant-HK"];
  return text;
};

describe("describeTranslations", () => {
  it("labels source, machine, manual and empty versions", () => {
    const text = hkManual();
    delete text["zh-Hant-TW"];
    delete text.meta.machine["zh-Hant-TW"];
    const rows = describeTranslations(text);
    expect(rows.map((r) => [r.locale, r.kind])).toEqual([
      ["de", "source"],
      ["zh-Hans", "machine"],
      ["zh-Hant-HK", "manual"],
      ["zh-Hant-TW", "empty"],
    ]);
    expect(rows.every((r) => !r.stale)).toBe(true);
  });
});

describe("mergeSourceChange", () => {
  it("replaces machine versions, keeps hand-written ones and flags them stale", () => {
    const next = mergeSourceChange(hkManual(), " neu ", fresh, T1);
    expect(next.de).toBe("neu");
    expect(next["zh-Hans"]).toBe("新-简");
    expect(next["zh-Hant-TW"]).toBe("新-台");
    expect(next["zh-Hant-HK"]).toBe("手写-港");
    expect(next.meta.machine).toEqual({ "zh-Hans": true, "zh-Hant-TW": true });
    expect(next.meta.stale).toEqual({ "zh-Hant-HK": true });
    expect(next.meta.updatedAt).toBe(T1.toISOString());
    expect(next.meta.pendingTranslation).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const stored = hkManual();
    const copy = structuredClone(stored);
    mergeSourceChange(stored, "neu", fresh, T1);
    expect(stored).toEqual(copy);
  });

  it("empties machine versions and marks the text pending when the provider failed", () => {
    const next = mergeSourceChange(hkManual(), "neu", null, T1);
    expect(next["zh-Hans"]).toBeUndefined();
    expect(next["zh-Hant-TW"]).toBeUndefined();
    expect(next.meta.machine).toEqual({});
    expect(next["zh-Hant-HK"]).toBe("手写-港");
    expect(next.meta.pendingTranslation).toBe(true);
  });

  it("clears an old stale flag of a machine-translated locale and keeps others", () => {
    const stored = hkManual();
    stored.meta.stale = { "zh-Hant-HK": true, "zh-Hans": true };
    const next = mergeSourceChange(stored, "neu", fresh, T1);
    expect(next.meta.stale).toEqual({ "zh-Hant-HK": true });
  });

  it("fills empty Chinese versions with the fresh translation", () => {
    const stored = createLocalizedText({ de: "alt" }, "de", { now: T0 });
    const next = mergeSourceChange(stored, "neu", fresh, T1);
    expect(next["zh-Hans"]).toBe("新-简");
    expect(next.meta.machine).toEqual({
      "zh-Hans": true,
      "zh-Hant-HK": true,
      "zh-Hant-TW": true,
    });
    expect(next.meta.stale).toBeUndefined();
  });
});

describe("retranslateAll", () => {
  it("overwrites hand-written versions, clears stale and pending", () => {
    const stored = hkManual();
    stored.meta.stale = { "zh-Hant-HK": true };
    stored.meta.pendingTranslation = true;
    const next = retranslateAll(stored, fresh, T1);
    expect(next["zh-Hant-HK"]).toBe("新-港");
    expect(next.meta.machine).toEqual({
      "zh-Hans": true,
      "zh-Hant-HK": true,
      "zh-Hant-TW": true,
    });
    expect(next.meta.stale).toBeUndefined();
    expect(next.meta.pendingTranslation).toBeUndefined();
    expect(next.de).toBe("alt");
    expect(next.meta.updatedAt).toBe(T1.toISOString());
  });
});

describe("applyTranslationSave", () => {
  it("turns an edited machine version into a hand-written one (badge removed)", () => {
    const stored = allMachine();
    const next = applyTranslationSave(stored, { values: { "zh-Hant-HK": " 改了 " } }, null, T1);
    expect(next["zh-Hant-HK"]).toBe("改了");
    expect(next.meta.machine).toEqual({ "zh-Hans": true, "zh-Hant-TW": true });
    expect(next.meta.updatedAt).toBe(T1.toISOString());
  });

  it("leaves untouched versions alone, even when the form sends them back", () => {
    const stored = allMachine();
    const next = applyTranslationSave(
      stored,
      { values: { de: "alt", "zh-Hans": "旧-简", "zh-Hant-HK": "旧-港", "zh-Hant-TW": "旧-台" } },
      null,
      T1,
    );
    expect(next.meta.machine).toEqual(stored.meta.machine);
    expect(next["zh-Hans"]).toBe("旧-简");
  });

  it("editing a stale version clears its flag; 'reviewed' clears it without a change", () => {
    const stored = mergeSourceChange(hkManual(), "neu", fresh, T0);
    expect(stored.meta.stale).toEqual({ "zh-Hant-HK": true });
    const edited = applyTranslationSave(stored, { values: { "zh-Hant-HK": "新手写" } }, null, T1);
    expect(edited.meta.stale).toBeUndefined();
    expect(edited.meta.machine["zh-Hant-HK"]).toBeUndefined();
    const reviewed = applyTranslationSave(
      stored,
      { values: {}, reviewed: ["zh-Hant-HK"] },
      null,
      T1,
    );
    expect(reviewed.meta.stale).toBeUndefined();
    expect(reviewed["zh-Hant-HK"]).toBe("手写-港");
  });

  it("a changed German source is merged first; same-save edits are not flagged stale", () => {
    const stored = hkManual();
    const next = applyTranslationSave(
      stored,
      {
        values: { de: "neu", "zh-Hans": "旧-简", "zh-Hant-HK": "手写-港", "zh-Hant-TW": "台改" },
      },
      fresh,
      T1,
    );
    expect(next.de).toBe("neu");
    expect(next["zh-Hans"]).toBe("新-简"); // untouched machine version follows the source
    expect(next["zh-Hant-TW"]).toBe("台改"); // edited in the same save
    expect(next.meta.machine).toEqual({ "zh-Hans": true });
    expect(next.meta.stale).toEqual({ "zh-Hant-HK": true });
  });

  it("clearing a Chinese version empties it", () => {
    const next = applyTranslationSave(allMachine(), { values: { "zh-Hans": "  " } }, null, T1);
    expect(next["zh-Hans"]).toBeUndefined();
    expect(next.meta.machine["zh-Hans"]).toBeUndefined();
  });

  it("clears pendingTranslation once all Chinese versions are filled by hand", () => {
    const stored = createLocalizedText({ de: "alt" }, "de", { pendingTranslation: true, now: T0 });
    const partly = applyTranslationSave(stored, { values: { "zh-Hans": "简" } }, null, T1);
    expect(partly.meta.pendingTranslation).toBe(true);
    const all = applyTranslationSave(
      stored,
      { values: { "zh-Hans": "简", "zh-Hant-HK": "港", "zh-Hant-TW": "台" } },
      null,
      T1,
    );
    expect(all.meta.pendingTranslation).toBeUndefined();
    expect(all.meta.machine).toEqual({});
  });
});

describe("changesSource", () => {
  it("compares the trimmed German text with the stored one", () => {
    const stored = allMachine();
    expect(changesSource(stored, { de: " alt " })).toBe(false);
    expect(changesSource(stored, {})).toBe(false);
    expect(changesSource(stored, { de: "neu" })).toBe(true);
  });
});
