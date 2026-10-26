// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalizedText, type LocalizedText } from "@/lib/localized-text";

import { createTestDb, type TestDb } from "./test-db";
import { PENDING_SOURCES } from "./translation-pending";
import { retryPendingTranslations } from "./translation-retry";
import { FakeTranslator } from "./translator/fake";
import { localize } from "./translator/localize";
import { type Translator, TranslatorError } from "./translator/types";

const NOW = new Date("2026-10-17T10:00:00Z");
const LATER = new Date("2026-10-17T10:10:00Z");
const NOTE = "Hintereingang benutzen, nach 10 Uhr klingeln";

/** The provider is down until `up` is set. */
function flaky(inner: Translator) {
  const state = { up: false, calls: 0 };
  const translator: Translator = {
    kind: "deepl",
    async translate(text, from, to) {
      state.calls++;
      if (!state.up) throw new TranslatorError("outage", "HTTP", 503);
      return inner.translate(text, from, to);
    },
  };
  return { state, translator };
}

describe.skipIf(!process.env.DATABASE_URL)("translation retry job", { timeout: 60_000 }, () => {
  let t: TestDb;
  let tourId: string;
  let n = 0;

  const makeCustomer = (notes: LocalizedText | null) =>
    t.prisma.customer
      .create({
        data: {
          customerNumber: `C-${++n}`,
          name: `Kunde ${n}`,
          street: "Hauptstr. 1",
          postalCode: "1010",
          city: "Wien",
          ...(notes ? { notes: notes as never } : {}),
        },
      })
      .then((c) => c.id);
  const makeStop = async (problemNote: LocalizedText | null, sequence: number) => {
    const customerId = await makeCustomer(null);
    return t.prisma.stop
      .create({
        data: {
          tourId,
          customerId,
          sequence,
          ...(problemNote ? { problemNote: problemNote as never } : {}),
        },
      })
      .then((s) => s.id);
  };
  const notes = async (id: string) =>
    (await t.prisma.customer.findUniqueOrThrow({ where: { id } })).notes as LocalizedText;
  const problem = async (id: string) =>
    (await t.prisma.stop.findUniqueOrThrow({ where: { id } })).problemNote as LocalizedText;
  const run = (translator: Translator, extra: object = {}) =>
    retryPendingTranslations({ db: t.prisma, translator, now: () => LATER, ...extra });

  beforeAll(async () => {
    t = await createTestDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The migration leaves the catalog product names pending; settle them so only test data counts.
    await retryPendingTranslations({ db: t.prisma, translator: new FakeTranslator() });
    tourId = (
      await t.prisma.tour.create({
        data: { date: new Date("2099-01-01"), depotSnapshot: {} },
      })
    ).id;
  });
  afterAll(async () => {
    await t.teardown();
  });
  beforeEach(async () => {
    await t.prisma.stop.deleteMany();
    await t.prisma.customer.deleteMany();
  });

  it("registers every column that stores a LocalizedText", () => {
    expect(PENDING_SOURCES.map((s) => s.name)).toEqual([
      "Customer.notes",
      "Stop.problemNote",
      "Product.name",
    ]);
  });

  it("outage: the record is saved with the source only, a later run fills it in", async () => {
    const { state, translator } = flaky(new FakeTranslator());
    // Saving never fails, even though the provider is down.
    const saved = await localize(NOTE, "de", { translator, now: NOW });
    expect(saved.meta.pendingTranslation).toBe(true);
    const id = await makeCustomer(saved);
    expect((await notes(id)).meta.pendingTranslation).toBe(true);

    const down = await run(translator);
    expect(down).toMatchObject({ translated: 0, failed: 1, stoppedEarly: "provider_error" });
    expect((await notes(id)).meta.pendingTranslation).toBe(true);
    expect((await notes(id))["zh-Hans"]).toBeUndefined();

    state.up = true;
    const up = await run(translator);
    expect(up).toMatchObject({ translated: 1, failed: 0 });
    const done = await notes(id);
    expect(done.de).toBe(NOTE);
    expect(done["zh-Hans"]).toBe(`[zh-Hans] ${NOTE}`);
    expect(done.en).toBe(`[en] ${NOTE}`);
    expect(done["sr-Latn"]).toBe(`[sr-Latn] ${NOTE}`);
    expect(done.cs).toBe(`[cs] ${NOTE}`);
    expect(done.meta.pendingTranslation).toBeUndefined();
    expect(done.meta.machine).toEqual({
      en: true,
      "sr-Latn": true,
      cs: true,
      "zh-Hans": true,
    });
    expect(done.meta.updatedAt).toBe(LATER.toISOString());

    // Nothing pending any more: the next run does not call the provider.
    const calls = state.calls;
    expect(await run(translator)).toMatchObject({ translated: 0, failed: 0, skipped: 0 });
    expect(state.calls).toBe(calls);
  });

  it("finds pending texts in every registered column, in the driver's own language", async () => {
    const customerId = await makeCustomer(
      createLocalizedText({ de: NOTE }, "de", { now: NOW, pendingTranslation: true }),
    );
    const stopId = await makeStop(
      createLocalizedText({ cs: "Obchod je zavřený" }, "cs", {
        now: NOW,
        pendingTranslation: true,
      }),
      1,
    );
    const report = await run(new FakeTranslator());
    expect(report.sources).toEqual({
      "Customer.notes": { translated: 1, failed: 0, skipped: 0 },
      "Stop.problemNote": { translated: 1, failed: 0, skipped: 0 },
      "Product.name": { translated: 0, failed: 0, skipped: 0 },
    });
    expect((await notes(customerId))["zh-Hans"]).toBe(`[zh-Hans] ${NOTE}`);
    const p = await problem(stopId);
    // Problem notes are only translated into German for the office (NUD-140).
    expect(p.de).toBe("[de] Obchod je zavřený");
    expect(p.en).toBeUndefined();
    expect(p.meta.source).toBe("cs");
    expect(p.meta.machine.cs).toBeUndefined();
    expect(p.meta.machine.de).toBe(true);
    expect(p.meta.pendingTranslation).toBeUndefined();
  });

  it("leaves finished texts, texts without a flag and empty columns alone", async () => {
    const done = await localize(NOTE, "de", { translator: new FakeTranslator(), now: NOW });
    const a = await makeCustomer(done);
    const b = await makeCustomer(createLocalizedText({ de: "nur deutsch" }, "de", { now: NOW }));
    const c = await makeCustomer(null);
    const t0 = (await t.prisma.customer.findMany({ select: { id: true, updatedAt: true } })).map(
      (r) => r.updatedAt.getTime(),
    );
    const report = await run(new FakeTranslator());
    expect(report).toMatchObject({ translated: 0, failed: 0, skipped: 0 });
    expect((await notes(a)).meta.updatedAt).toBe(NOW.toISOString());
    expect((await notes(b))["zh-Hans"]).toBeUndefined();
    expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c } })).notes).toBeNull();
    expect(
      (await t.prisma.customer.findMany({ select: { updatedAt: true } })).map((r) =>
        r.updatedAt.getTime(),
      ),
    ).toEqual(t0);
  });

  it("keeps a hand-written locale that was added while the text was pending", async () => {
    const id = await makeCustomer({
      ...createLocalizedText({ de: NOTE, cs: "Zadní vchod, zvonit po 10. hodině" }, "de", {
        now: NOW,
        pendingTranslation: true,
      }),
    });
    await run(new FakeTranslator());
    const done = await notes(id);
    expect(done.cs).toBe("Zadní vchod, zvonit po 10. hodině");
    expect(done["zh-Hans"]).toBe(`[zh-Hans] ${NOTE}`);
    expect(done.meta.pendingTranslation).toBeUndefined();
  });

  it("does not overwrite an edit made between read and write", async () => {
    const id = await makeCustomer(
      createLocalizedText({ de: NOTE }, "de", { now: NOW, pendingTranslation: true }),
    );
    const racing: Translator = {
      kind: "deepl",
      async translate(text, from, to) {
        // The office saves a new version while the provider call is in flight.
        await t.prisma.customer.update({
          where: { id },
          data: {
            notes: createLocalizedText({ de: "Neue Notiz", "zh-Hans": "新备注" }, "de", {
              now: new Date("2026-10-17T10:05:00Z"),
            }) as never,
          },
        });
        return new FakeTranslator().translate(text, from, to);
      },
    };
    const report = await run(racing);
    expect(report).toMatchObject({ translated: 0, skipped: 1 });
    const stored = await notes(id);
    expect(stored.de).toBe("Neue Notiz");
    expect(stored["zh-Hans"]).toBe("新备注");
  });

  it("a text the provider refuses is counted as failed and does not block the others", async () => {
    const bad = await makeCustomer(
      createLocalizedText({ de: "schlecht" }, "de", { now: NOW, pendingTranslation: true }),
    );
    const good = await makeCustomer(
      createLocalizedText({ de: "gut" }, "de", { now: NOW, pendingTranslation: true }),
    );
    const picky: Translator = {
      kind: "deepl",
      async translate(text, from, to) {
        if (text === "schlecht") throw new TranslatorError("refused", "INVALID_INPUT");
        return new FakeTranslator().translate(text, from, to);
      },
    };
    const report = await run(picky);
    expect(report).toMatchObject({ translated: 1, failed: 1 });
    expect(report.stoppedEarly).toBeUndefined();
    expect((await notes(bad)).meta.pendingTranslation).toBe(true);
    expect((await notes(good)).meta.pendingTranslation).toBeUndefined();
  });

  it("skips (and reports) a pending value that is not a valid LocalizedText", async () => {
    const id = await makeCustomer({ meta: { pendingTranslation: true } } as never);
    const report = await run(new FakeTranslator());
    expect(report).toMatchObject({ translated: 0, skipped: 1 });
    expect(((await notes(id)) as unknown as { meta: object }).meta).toEqual({
      pendingTranslation: true,
    });
  });

  it("works through at most `limit` records per source and run", async () => {
    for (let i = 0; i < 3; i++) {
      await makeCustomer(
        createLocalizedText({ de: `Text ${i}` }, "de", { now: NOW, pendingTranslation: true }),
      );
    }
    expect(await run(new FakeTranslator(), { limit: 2 })).toMatchObject({ translated: 2 });
    expect(await run(new FakeTranslator(), { limit: 2 })).toMatchObject({ translated: 1 });
  });

  it("stops starting new records when the time budget is used up", async () => {
    await makeCustomer(
      createLocalizedText({ de: "a" }, "de", { now: NOW, pendingTranslation: true }),
    );
    const report = await run(new FakeTranslator(), { timeBudgetMs: -1 });
    expect(report).toMatchObject({ translated: 0, stoppedEarly: "time_budget" });
  });
});
