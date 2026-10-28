import { assembleDraft, type CatalogProduct, type OrderDraft } from "@/domain/order-extraction";
import type { ExtractionAnswer } from "@/domain/order-extraction-answer";
import { localizedTextSchema } from "@/lib/localized-text";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads";

import { type OrderExtractor,OrderExtractorError } from "./order-extractor";
import { getActiveProducts } from "./products";
import type { Storage } from "./storage";

/**
 * AI order draft (NUD-150, D26): loads the catalog, hands the pasted message and/or the screenshot
 * to the configured `OrderExtractor` and maps its answer onto catalog products. Nothing here writes
 * to the database - the office still confirms the draft in the order form, and only saving the order
 * stores anything (backlog §1: correct quantities beat clever automation).
 */

export type OrderDraftFailure =
  | "invalid"
  | "not_configured"
  | "screenshot_unavailable"
  | "extraction_failed";

export type OrderDraftOutcome =
  | {
      ok: true;
      draft: OrderDraft;
      /** The raw answer, sent back with the saved order so the office can review it. */
      extraction: ExtractionAnswer;
      model: string;
    }
  | { ok: false; error: OrderDraftFailure };

export type OrderDraftDb = Parameters<typeof getActiveProducts>[0];

export type OrderDraftRequest = { text?: string | null; screenshotKey?: string | null };

export async function extractOrderDraft(
  db: OrderDraftDb,
  request: OrderDraftRequest,
  deps: {
    storage: Pick<Storage, "head" | "getReadUrl">;
    extractor: OrderExtractor;
    /** Today in the factory time zone, `YYYY-MM-DD`. */
    today: string;
    timezone: string;
    fetch?: typeof fetch;
  },
): Promise<OrderDraftOutcome> {
  const text = (request.text ?? "").trim();
  if (text === "" && !request.screenshotKey) return { ok: false, error: "invalid" };

  const catalog = await loadCatalog(db);
  let image: { bytes: Uint8Array; contentType: string } | undefined;
  if (request.screenshotKey) {
    const loaded = await loadScreenshot(request.screenshotKey, deps);
    if (!loaded) return { ok: false, error: "screenshot_unavailable" };
    image = loaded;
  }

  let result;
  try {
    result = await deps.extractor.extract(
      { text, image },
      { catalog, today: deps.today, timezone: deps.timezone },
    );
  } catch (error) {
    const code = error instanceof OrderExtractorError ? error.code : "NETWORK";
    // Never log the customer message itself.
    console.warn(`[order-extraction] extraction failed (${code})`);
    return { ok: false, error: code === "NOT_CONFIGURED" ? "not_configured" : "extraction_failed" };
  }

  return {
    ok: true,
    draft: assembleDraft(result.answer, catalog),
    extraction: result.answer,
    model: result.model,
  };
}

/** Active products with their per-locale names; the only products a draft may point at. */
export async function loadCatalog(db: OrderDraftDb): Promise<CatalogProduct[]> {
  const rows = await getActiveProducts(db);
  return rows.flatMap((row) => {
    const parsed = localizedTextSchema.safeParse(row.name);
    if (!parsed.success) return [];
    return [{ id: row.id, name: parsed.data, unit: row.unit as CatalogProduct["unit"] }];
  });
}

/** Fetches the uploaded screenshot through its short-lived signed URL (the bucket stays private). */
async function loadScreenshot(
  key: string,
  deps: { storage: Pick<Storage, "head" | "getReadUrl">; fetch?: typeof fetch },
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const head = await deps.storage.head(key).catch(() => null);
  if (!head || head.bytes <= 0 || head.bytes > MAX_UPLOAD_BYTES) return null;
  const url = await deps.storage.getReadUrl(key).catch(() => null);
  if (!url) return null;
  const fetchFn = deps.fetch ?? fetch;
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null;
    return { bytes, contentType: head.contentType ?? "image/jpeg" };
  } catch {
    return null;
  }
}
