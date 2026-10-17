import type { CustomerListInput } from "@/server/customers";

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** URL search params of /admin/customers -> list input (unknown values fall back to defaults). */
export function parseCustomerListParams(raw: Raw): Required<CustomerListInput> {
  const status = first(raw.status);
  const page = Number.parseInt(first(raw.page) ?? "1", 10);
  return {
    q: (first(raw.q) ?? "").slice(0, 100),
    status: status === "archived" || status === "all" ? status : "active",
    photosMissing: first(raw.photos) === "missing",
    pinUnconfirmed: first(raw.pin) === "unconfirmed",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100_000) : 1,
    pageSize: 25,
  };
}

/** List input -> URL query (defaults omitted). */
export function customerListQuery(
  input: Pick<
    Required<CustomerListInput>,
    "q" | "status" | "photosMissing" | "pinUnconfirmed" | "page"
  >,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (input.q.trim()) query.q = input.q;
  if (input.status !== "active") query.status = input.status;
  if (input.photosMissing) query.photos = "missing";
  if (input.pinUnconfirmed) query.pin = "unconfirmed";
  if (input.page > 1) query.page = String(input.page);
  return query;
}
