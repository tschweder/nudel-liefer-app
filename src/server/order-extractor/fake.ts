import {
  type CatalogProduct,
  type ExtractionAnswer,
  extractionAnswerSchema,
  matchProduct,
  unitHintFromLabel,
} from "@/domain/order-extraction";

import {
  type OrderExtractionContext,
  type OrderExtractionInput,
  type OrderExtractionResult,
  type OrderExtractor,
} from "./types";

/** German unit words the fake writes into its labels (matching needs a unit to tell products apart). */
const FAKE_UNIT_WORDS: Record<CatalogProduct["unit"], string> = {
  PACK: "Sackerl",
  CRATE: "Kiste",
  KG: "kg",
  PIECE: "Stück",
};

/** Words that ask for a part of a day; the fake resolves them to hours like a model would. */
const TIME_WORDS: ReadonlyArray<{
  words: readonly string[];
  fromTime: string;
  toTime: string;
}> = [
  { words: ["vormittag", "morgens", "上午", "早上"], fromTime: "08:00", toTime: "12:00" },
  { words: ["nachmittag", "下午"], fromTime: "13:00", toTime: "17:00" },
  { words: ["abend", "晚上"], fromTime: "17:00", toTime: "20:00" },
];

/** Relative days in German and Chinese; the longest word first ("uebermorgen" contains "morgen"). */
const DAY_WORDS: ReadonlyArray<{ words: readonly string[]; offset: number }> = [
  { words: ["übermorgen", "uebermorgen", "后天"], offset: 2 },
  { words: ["heute", "今天"], offset: 0 },
  { words: ["morgen", "明天"], offset: 1 },
];

/** Sentence and clause separators, plus the conjunctions that join two order lines. */
const CLAUSE_SPLIT = /[,;\n、，；。]+|\bund\b|\band\b|\bmit\b|和|及|加/;

/** `Nudeln Kiste` for a product and a unit; the label a real model would have transcribed. */
function labelFor(product: CatalogProduct, unit: CatalogProduct["unit"]): string {
  return `${product.name.de ?? product.id} ${FAKE_UNIT_WORDS[unit]}`.trim();
}

/**
 * Offline stand-in for the real model (NUD-150): it reads the same shapes a customer message has -
 * whole numbers, unit words, German or Chinese day words - without a network call and without an API
 * key. It is what the tests and the evaluation script use when no key is configured; it is
 * deliberately dumb and never invents a product (an unknown label stays unmatched).
 */
export class FakeOrderExtractor implements OrderExtractor {
  readonly kind = "fake" as const;

  async extract(
    input: OrderExtractionInput,
    context: OrderExtractionContext,
  ): Promise<OrderExtractionResult> {
    const text = (input.text ?? "").trim();
    if (text === "") {
      // A screenshot alone is exactly what a text-only stand-in cannot read.
      return { answer: extractionAnswerSchema.parse({ lines: [] }), raw: { fake: true }, model: "fake" };
    }
    const lines = this.lines(text, context.catalog);
    const window = this.window(text, context.today);
    const answer: ExtractionAnswer = extractionAnswerSchema.parse({
      lines,
      window,
      note: null,
      confidence: lines.length > 0 ? Math.min(...lines.map((line) => line.confidence)) : 0,
    });
    return { answer, raw: { fake: true, answer }, model: "fake" };
  }

  private lines(text: string, catalog: readonly CatalogProduct[]) {
    const lines: { label: string; quantity: number; confidence: number }[] = [];
    let last: CatalogProduct | null = null;
    for (const clause of text.split(CLAUSE_SPLIT)) {
      const number = /(\d{1,5})/.exec(clause);
      if (!number) continue;
      const quantity = Number(number[1]);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99_999) continue;
      const match = matchProduct(clause, catalog);
      const product = match && !match.ambiguous ? catalog.find((p) => p.id === match.productId) : null;
      if (product) last = product;
      if (!last) continue;
      // A bare quantity ("5 Beutel") keeps the product of the previous line but takes this clause's
      // unit, so "2 Karton Nudeln, 5 Beutel" stays two different products.
      const unit = unitHintFromLabel(clause) ?? last.unit;
      lines.push({
        label: labelFor(last, unit),
        quantity,
        confidence: product ? 0.9 : 0.6,
      });
    }
    return lines;
  }

  private window(text: string, today: string) {
    const normalized = text.toLowerCase();
    const day = DAY_WORDS.find((entry) => entry.words.some((word) => normalized.includes(word)));
    const part = TIME_WORDS.find((entry) => entry.words.some((word) => normalized.includes(word)));
    if (!day && !part) return null;
    const from = addDays(today, day?.offset ?? 0);
    return {
      from,
      to: from,
      fromTime: part?.fromTime ?? null,
      toTime: part?.toTime ?? null,
      confidence: day && part ? 0.8 : 0.5,
    };
  }
}

/** `YYYY-MM-DD` plus days, in UTC (the date is a calendar day, never a timestamp). */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
