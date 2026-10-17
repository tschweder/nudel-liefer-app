import { afterEach, describe, expect, it, vi } from "vitest";

import { newClientMutationId } from "./client-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newClientMutationId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a v4 UUID", () => {
    expect(newClientMutationId()).toMatch(UUID_V4);
    expect(newClientMutationId()).not.toBe(newClientMutationId());
  });

  it("falls back to getRandomValues outside secure contexts", () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => crypto_fill(a) });
    expect(newClientMutationId()).toMatch(UUID_V4);
  });
});

function crypto_fill(a: Uint8Array): Uint8Array {
  for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 0xff;
  return a;
}
