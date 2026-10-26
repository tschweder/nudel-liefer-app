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
  en: "new-en",
  "sr-Latn": "novo-sr",
  cs: "nové-cs",
  "zh-Hans": "新-简",
};

const ALL_MACHINE = { en: true, "sr-Latn": true, cs: true, "zh-Hans": true } as const;

/** German source, all four translations machine-made. */
const allMachine = () =>
  createLocalizedText(
    { de: "alt", en: "old-en", "sr-Latn": "staro-sr", cs: "staré-cs", "zh-Hans": "旧-简" },
    "de",
    { machine: { ...ALL_MACHINE }, now: T0 },
  );

/** Czech edited by hand. */
const csManual = (): LocalizedText => {
  const text = allMachine();
  text.cs = "ručně-cs";
  delete text.meta.machine.cs;
  return text;
};

describe("describeTranslations", () => {
  it("labels source, machine, manual and empty versions", () => {
    const text = csManual();
    delete text["sr-Latn"];
    delete text.meta.machine["sr-Latn"];
    const rows = describeTranslations(text);
    expect(rows.map((r) => [r.locale, r.kind])).toEqual([
      ["de", "source"],
      ["en", "machine"],
      ["sr-Latn", "empty"],
      ["cs", "manual"],
      ["zh-Hans", "machine"],
    ]);
    expect(rows.every((r) => !r.stale)).toBe(true);
  });
});

describe("mergeSourceChange", () => {
  it("replaces machine versions, keeps hand-written ones and flags them stale", () => {
    const next = mergeSourceChange(csManual(), " neu ", fresh, T1);
    expect(next.de).toBe("neu");
    expect(next.en).toBe("new-en");
    expect(next["sr-Latn"]).toBe("novo-sr");
    expect(next["zh-Hans"]).toBe("新-简");
    expect(next.cs).toBe("ručně-cs");
    expect(next.meta.machine).toEqual({ en: true, "sr-Latn": true, "zh-Hans": true });
    expect(next.meta.stale).toEqual({ cs: true });
    expect(next.meta.updatedAt).toBe(T1.toISOString());
    expect(next.meta.pendingTranslation).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const stored = csManual();
    const copy = structuredClone(stored);
    mergeSourceChange(stored, "neu", fresh, T1);
    expect(stored).toEqual(copy);
  });

  it("empties machine versions and marks the text pending when the provider failed", () => {
    const next = mergeSourceChange(csManual(), "neu", null, T1);
    expect(next.en).toBeUndefined();
    expect(next["zh-Hans"]).toBeUndefined();
    expect(next.meta.machine).toEqual({});
    expect(next.cs).toBe("ručně-cs");
    expect(next.meta.pendingTranslation).toBe(true);
  });

  it("a locale the provider could not translate stays empty and pending", () => {
    const partial = { ...fresh };
    delete partial["sr-Latn"];
    const next = mergeSourceChange(allMachine(), "neu", partial, T1);
    expect(next["sr-Latn"]).toBeUndefined();
    expect(next.en).toBe("new-en");
    expect(next.meta.pendingTranslation).toBe(true);
  });

  it("clears an old stale flag of a machine-translated locale and keeps others", () => {
    const stored = csManual();
    stored.meta.stale = { cs: true, "zh-Hans": true };
    const next = mergeSourceChange(stored, "neu", fresh, T1);
    expect(next.meta.stale).toEqual({ cs: true });
  });

  it("fills empty versions with the fresh translation", () => {
    const stored = createLocalizedText({ de: "alt" }, "de", { now: T0 });
    const next = mergeSourceChange(stored, "neu", fresh, T1);
    expect(next["zh-Hans"]).toBe("新-简");
    expect(next.meta.machine).toEqual({ ...ALL_MACHINE });
    expect(next.meta.stale).toBeUndefined();
  });
});

describe("retranslateAll", () => {
  it("overwrites hand-written versions, clears stale and pending", () => {
    const stored = csManual();
    stored.meta.stale = { cs: true };
    stored.meta.pendingTranslation = true;
    const next = retranslateAll(stored, fresh, T1);
    expect(next.cs).toBe("nové-cs");
    expect(next.meta.machine).toEqual({ ...ALL_MACHINE });
    expect(next.meta.stale).toBeUndefined();
    expect(next.meta.pendingTranslation).toBeUndefined();
    expect(next.de).toBe("alt");
    expect(next.meta.updatedAt).toBe(T1.toISOString());
  });
});

describe("applyTranslationSave", () => {
  it("turns an edited machine version into a hand-written one (badge removed)", () => {
    const next = applyTranslationSave(allMachine(), { values: { cs: " změněno " } }, null, T1);
    expect(next.cs).toBe("změněno");
    expect(next.meta.machine).toEqual({ en: true, "sr-Latn": true, "zh-Hans": true });
    expect(next.meta.updatedAt).toBe(T1.toISOString());
  });

  it("leaves untouched versions alone, even when the form sends them back", () => {
    const stored = allMachine();
    const next = applyTranslationSave(
      stored,
      {
        values: {
          de: "alt",
          en: "old-en",
          "sr-Latn": "staro-sr",
          cs: "staré-cs",
          "zh-Hans": "旧-简",
        },
      },
      null,
      T1,
    );
    expect(next.meta.machine).toEqual(stored.meta.machine);
    expect(next["zh-Hans"]).toBe("旧-简");
  });

  it("editing a stale version clears its flag; 'reviewed' clears it without a change", () => {
    const stored = mergeSourceChange(csManual(), "neu", fresh, T0);
    expect(stored.meta.stale).toEqual({ cs: true });
    const edited = applyTranslationSave(stored, { values: { cs: "nová ruka" } }, null, T1);
    expect(edited.meta.stale).toBeUndefined();
    expect(edited.meta.machine.cs).toBeUndefined();
    const reviewed = applyTranslationSave(stored, { values: {}, reviewed: ["cs"] }, null, T1);
    expect(reviewed.meta.stale).toBeUndefined();
    expect(reviewed.cs).toBe("ručně-cs");
  });

  it("a changed German source is merged first; same-save edits are not flagged stale", () => {
    const stored = csManual();
    const next = applyTranslationSave(
      stored,
      {
        values: {
          de: "neu",
          en: "old-en",
          "sr-Latn": "moje-sr",
          cs: "ručně-cs",
          "zh-Hans": "旧-简",
        },
      },
      fresh,
      T1,
    );
    expect(next.de).toBe("neu");
    expect(next.en).toBe("new-en"); // untouched machine version follows the source
    expect(next["sr-Latn"]).toBe("moje-sr"); // edited in the same save
    expect(next.meta.machine).toEqual({ en: true, "zh-Hans": true });
    expect(next.meta.stale).toEqual({ cs: true });
  });

  it("clearing a version empties it", () => {
    const next = applyTranslationSave(allMachine(), { values: { "zh-Hans": "  " } }, null, T1);
    expect(next["zh-Hans"]).toBeUndefined();
    expect(next.meta.machine["zh-Hans"]).toBeUndefined();
  });

  it("clears pendingTranslation once all translated versions are filled by hand", () => {
    const stored = createLocalizedText({ de: "alt" }, "de", { pendingTranslation: true, now: T0 });
    const partly = applyTranslationSave(stored, { values: { en: "a" } }, null, T1);
    expect(partly.meta.pendingTranslation).toBe(true);
    const all = applyTranslationSave(
      stored,
      { values: { en: "a", "sr-Latn": "b", cs: "c", "zh-Hans": "简" } },
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
