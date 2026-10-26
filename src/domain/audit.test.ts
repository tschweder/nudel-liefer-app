import { describe, expect, it } from "vitest";

import {
  AUDIT_LIST_MAX,
  AUDIT_TEXT_MAX,
  diffOrderLines,
  diffOrderUpdate,
  isAuditAction,
  sanitizeAuditDiff,
  truncateText,
} from "./audit";

describe("sanitizeAuditDiff", () => {
  it("drops secrets and signed URLs by key name, at any depth", () => {
    const out = sanitizeAuditDiff({
      status: "DRAFT",
      passwordHash: "x",
      nested: { token: "t", signedUrl: "https://s3/x?X-Amz-Signature=1", driverId: "d1" },
      list: [{ secret: "s", ok: 1 }],
      assignedDriver: "kept",
    });
    expect(out).toEqual({
      status: "DRAFT",
      nested: { driverId: "d1" },
      list: [{ ok: 1 }],
      assignedDriver: "kept",
    });
  });

  it("truncates long text and caps lists", () => {
    const long = "a".repeat(AUDIT_TEXT_MAX + 50);
    const out = sanitizeAuditDiff({
      note: long,
      ids: Array.from({ length: 500 }, (_, i) => i),
    }) as {
      note: string;
      ids: number[];
    };
    expect(out.note).toHaveLength(AUDIT_TEXT_MAX);
    expect(out.note.endsWith("…")).toBe(true);
    expect(out.ids).toHaveLength(AUDIT_LIST_MAX);
  });

  it("makes values JSON-safe", () => {
    expect(
      sanitizeAuditDiff({ at: new Date("2099-01-01T00:00:00Z"), n: NaN, u: undefined, z: null }),
    ).toEqual({ at: "2099-01-01T00:00:00.000Z", n: null, z: null });
  });

  it("truncateText leaves short text alone", () => {
    expect(truncateText("  hi  ")).toBe("hi");
  });
});

describe("order diffs", () => {
  it("reports changed, added and removed lines in the audit encoding (hundredths)", () => {
    expect(
      diffOrderLines(
        [
          { productId: "a", quantity: 3 },
          { productId: "b", quantity: 1 },
          { productId: "c", quantity: 4 },
        ],
        [
          { productId: "a", quantity: 9 },
          { productId: "c", quantity: 4 },
          { productId: "d", quantity: 3 },
        ],
      ),
    ).toEqual([
      { productId: "a", before: 300, after: 900 },
      { productId: "d", before: null, after: 300 },
      { productId: "b", before: 100, after: null },
    ]);
  });

  const base = {
    status: "CONFIRMED",
    deliveryDate: "2099-06-15",
    internalNote: null,
    items: [{ productId: "a", quantity: 2 }],
  };

  it("returns null when nothing changed", () => {
    expect(diffOrderUpdate(base, { ...base, internalNote: "  " })).toBeNull();
  });

  it("lists only the fields that differ", () => {
    expect(
      diffOrderUpdate(base, {
        ...base,
        status: "DRAFT",
        internalNote: "x",
        items: [{ productId: "a", quantity: 3 }],
      }),
    ).toEqual({
      status: { from: "CONFIRMED", to: "DRAFT" },
      internalNote: { from: null, to: "x" },
      lines: [{ productId: "a", before: 200, after: 300 }],
    });
  });
});

describe("isAuditAction", () => {
  it("knows the vocabulary", () => {
    expect(isAuditAction("order.update")).toBe(true);
    expect(isAuditAction("order.delete")).toBe(false);
  });
});
