import {
  decodeText,
  detectFileKind,
  IMPORT_LIMITS,
  ImportFileError,
  type ImportFileErrorCode,
  parseCsv,
  type ParsedTable,
} from "@/domain/import-file";

import { type Actor, authErrorStatus, type Role } from "./auth/actor";
import { rejectCrossOrigin } from "./csrf";
import { readXlsx } from "./import-xlsx";

export type ParsedUpload = {
  kind: "csv" | "xlsx";
  filename: string;
  /** Header row first. */
  table: ParsedTable;
  sheetName: string | null;
  sheetCount: number;
};

export type UploadParseDeps = { requireRole: (...roles: Role[]) => Promise<Actor> };

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Multipart framing around the file. */
const MULTIPART_OVERHEAD = 64 * 1024;

const json = (body: unknown, status: number) => Response.json(body, { status, headers: NO_STORE });

const STATUS: Record<ImportFileErrorCode, number> = {
  too_large: 413,
  empty: 422,
  unsupported_type: 415,
  too_many_rows: 422,
  too_many_columns: 422,
  cell_too_long: 422,
  bad_csv: 422,
  bad_xlsx: 422,
  zip_bomb: 422,
};

/** Reads at most `limit` bytes of the body; `null` when it is larger. */
async function readLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Turns the bytes of an uploaded file into a table of text cells (header row first). */
export async function parseImportFile(bytes: Uint8Array, filename: string): Promise<ParsedUpload> {
  if (bytes.byteLength === 0) throw new ImportFileError("empty");
  if (bytes.byteLength > IMPORT_LIMITS.maxBytes) throw new ImportFileError("too_large");
  const kind = detectFileKind(bytes, filename);
  if (!kind) throw new ImportFileError("unsupported_type");
  let table: ParsedTable;
  let sheetName: string | null = null;
  let sheetCount = 1;
  if (kind === "csv") {
    table = parseCsv(decodeText(bytes));
  } else {
    const sheet = await readXlsx(bytes);
    table = sheet;
    sheetName = sheet.sheetName;
    sheetCount = sheet.sheetCount;
  }
  if (table.rows.length < 2) throw new ImportFileError("empty");
  return { kind, filename, table, sheetName, sheetCount };
}

/**
 * `POST /api/admin/customers/import/parse` (NUD-090): multipart upload with one `file` field. ADMIN
 * only (role checked first, before the body is read), size limited while reading (5 MB), parsed on
 * the server (CSV or XLSX). Answers `{ upload: ParsedUpload }` or `{ error: code }`. Nothing is
 * stored: the browser keeps the table and sends the mapped rows to the import actions, which
 * validate them again.
 */
export async function handleParseUpload(
  request: Request,
  deps: UploadParseDeps,
): Promise<Response> {
  try {
    await deps.requireRole("ADMIN");
  } catch (error) {
    const status = authErrorStatus(error);
    if (status) return json({ error: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" }, status);
    throw error;
  }
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return json({ error: "unsupported_type" }, 415);
  }
  const body = await readLimited(request, IMPORT_LIMITS.maxBytes + MULTIPART_OVERHEAD);
  if (!body) return json({ error: "too_large" }, 413);

  let file: FormDataEntryValue | null;
  try {
    const form = await new Response(body as BodyInit, {
      headers: { "content-type": contentType },
    }).formData();
    file = form.get("file");
  } catch {
    return json({ error: "invalid" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "invalid" }, 400);
  try {
    const upload = await parseImportFile(new Uint8Array(await file.arrayBuffer()), file.name);
    return json({ upload }, 200);
  } catch (error) {
    if (error instanceof ImportFileError) return json({ error: error.code }, STATUS[error.code]);
    throw error;
  }
}
