// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HAND_OFF } from "./index";

/**
 * Data-quality test of the hand-off search index (docs/handoff-vserver-deploy-and-help.md §8.4).
 *
 * The important guard is the label check: every `label`/`result` string must appear verbatim in
 * `messages/de.json`, so the help page can never invent a UI label that does not exist in the app.
 */

// Node environment on purpose (see the directive above): jsdom has no file system, and the path is
// resolved from the repository root, which is vitest's working directory.
const deMessages = readFileSync(path.join(process.cwd(), "messages", "de.json"), "utf8");

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Required coverage (§8.1): all 50 numbered topics plus the "does not exist" page (§12). */
const EXPECTED_IDS = [
  // Büro
  "produkt-anlegen",
  "produkt-namen-bearbeiten",
  "produkt-status-reihenfolge",
  "kunde-anlegen",
  "kartenpunkt-setzen-und-bestaetigen",
  "kundenfotos",
  "kunden-import",
  "pins-pruefen",
  "kunde-archivieren",
  "kunden-suchen-filtern",
  "bestellung-anlegen",
  "bestellung-screenshot",
  "bestellung-bearbeiten-kopieren",
  "bestellungen-filtern-summen",
  "tour-erstellen",
  "tour-umsortieren",
  "fahrer-zuweisen-freigeben",
  "erneut-freigeben-und-folgetour",
  "ladeliste-drucken",
  "fortschritt-beobachten",
  "fahrer-anlegen-pin",
  "fahrer-deaktivieren-sprache",
  "admin-anlegen",
  "einstellungen-depot-planung",
  "verlauf-lesen",
  "notizen-uebersetzen",
  // Anmeldung & Konto
  "buero-anmelden-abmelden",
  "fahrer-anmelden",
  "sprachauswahl-erststart",
  "sprache-wechseln-app",
  "fahrer-abmelden-offline-daten",
  // Fahrer
  "heutige-tour",
  "stopp-details",
  "navigation-starten",
  "geliefert-rueckgaengig",
  "problem-melden",
  "foto-aufnehmen",
  "tour-abschliessen",
  "offline-arbeiten",
  "app-installieren",
  // System & Fehler
  "fehler-etwas-ist-schiefgelaufen",
  "offline-nicht-verfuegbar",
  "karte-leer",
  "naeherungswerte",
  "tour-nicht-erstellbar",
  "kunde-nicht-in-tour",
  "betrieb-health-support",
  "funktionen-die-es-nicht-gibt",
  // Zusätzliche Themen (§8.1 Nr. 49/50 und Glossar)
  "ladeliste-lesen",
  "bedienung-bildschirm",
  "glossar",
] as const;

/** Everything a topic could match on, lowercased. */
function haystack(topic: (typeof HAND_OFF.topics)[number]): string {
  return [
    topic.title.de,
    topic.title.zh,
    topic.summary.de,
    topic.summary.zh,
    ...topic.search.de,
    ...topic.search.zh,
  ]
    .join("\n")
    .toLowerCase();
}

describe("hand-off content", () => {
  it("has topics and a non-empty glossary", () => {
    expect(HAND_OFF.topics.length).toBeGreaterThanOrEqual(45);
    expect(HAND_OFF.topics.length).toBeLessThanOrEqual(55);
    expect(HAND_OFF.glossary.length).toBeGreaterThan(0);
    for (const entry of HAND_OFF.glossary) {
      expect(entry.de.trim(), `glossary term "${entry.de}"`).not.toBe("");
      expect(entry.zh.trim(), `glossary term "${entry.de}"`).not.toBe("");
    }
  });

  it("uses unique kebab-case ids", () => {
    const ids = HAND_OFF.topics.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `id "${id}" is not kebab-case`).toMatch(KEBAB_CASE);
    }
  });

  it("covers the required topic ids of section 8.1", () => {
    const ids = new Set(HAND_OFF.topics.map((topic) => topic.id));
    for (const expected of EXPECTED_IDS) {
      expect(ids.has(expected), `missing topic id "${expected}"`).toBe(true);
    }
    expect(ids.size).toBe(EXPECTED_IDS.length);
  });

  it("fills every required field in both languages", () => {
    for (const topic of HAND_OFF.topics) {
      const where = topic.id;
      expect(topic.title.de.trim(), `${where}.title.de`).not.toBe("");
      expect(topic.title.zh.trim(), `${where}.title.zh`).not.toBe("");
      expect(topic.summary.de.trim(), `${where}.summary.de`).not.toBe("");
      expect(topic.summary.zh.trim(), `${where}.summary.zh`).not.toBe("");
      expect(topic.path.de.trim(), `${where}.path.de`).not.toBe("");
      expect(topic.path.zh.trim(), `${where}.path.zh`).not.toBe("");
      expect(topic.search.de.length, `${where}.search.de`).toBeGreaterThan(0);
      expect(topic.search.zh.length, `${where}.search.zh`).toBeGreaterThan(0);
      expect(topic.steps.length, `${where}.steps`).toBeGreaterThanOrEqual(2);
      expect(topic.steps.length, `${where}.steps`).toBeLessThanOrEqual(12);
      for (const term of topic.search.de) {
        expect(term.trim(), `${where}.search.de term`).not.toBe("");
      }
      for (const term of topic.search.zh) {
        expect(term.trim(), `${where}.search.zh term`).not.toBe("");
      }
      for (const [index, step] of topic.steps.entries()) {
        expect(step.text.de.trim(), `${where}.steps[${index}].text.de`).not.toBe("");
        expect(step.text.zh.trim(), `${where}.steps[${index}].text.zh`).not.toBe("");
      }
      if (topic.after) {
        expect(topic.after.de.trim(), `${where}.after.de`).not.toBe("");
        expect(topic.after.zh.trim(), `${where}.after.zh`).not.toBe("");
      }
    }
  });

  it("uses only UI labels that exist verbatim in messages/de.json", () => {
    for (const topic of HAND_OFF.topics) {
      for (const [index, step] of topic.steps.entries()) {
        if (step.label !== undefined) {
          expect(
            deMessages.includes(step.label),
            `${topic.id}.steps[${index}] label "${step.label}" is not in messages/de.json`,
          ).toBe(true);
        }
        if (step.result !== undefined) {
          expect(
            deMessages.includes(step.result),
            `${topic.id}.steps[${index}] result "${step.result}" is not in messages/de.json`,
          ).toBe(true);
        }
      }
    }
  });

  it("resolves the user's phrase 'waren typ hinzufügen' to exactly one topic", () => {
    const query = "waren typ hinzufügen";
    const matches = HAND_OFF.topics.filter((topic) => haystack(topic).includes(query));
    expect(matches.map((topic) => topic.id)).toEqual(["produkt-anlegen"]);
  });

  it("resolves '添加产品' to exactly one topic", () => {
    const matches = HAND_OFF.topics.filter((topic) => haystack(topic).includes("添加产品"));
    expect(matches.map((topic) => topic.id)).toEqual(["produkt-anlegen"]);
  });
});
