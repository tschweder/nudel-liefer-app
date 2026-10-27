// @vitest-environment node
import { describe, expect, it } from "vitest";

import { handleTileRequest, TILE_CACHE_MAX_AGE_MS } from "./tile-cache";

/** Minimal in-memory Cache that keeps insertion order like the real one. */
function fakeCache() {
  const map = new Map<string, Response>();
  return {
    map,
    async match(r: Request) {
      return map.get(r.url)?.clone();
    },
    async put(r: Request, res: Response) {
      map.set(r.url, res);
    },
    async delete(r: Request) {
      return map.delete(r.url);
    },
    async keys() {
      return [...map.keys()].map((u) => new Request(u));
    },
  };
}
const req = (n: number) => new Request(`https://t.example/1/${n}/0.png`);
const ok = () => new Response("png", { status: 200 });

describe("tile cache (opt-in)", () => {
  it("stores what was fetched and serves it without the network afterwards", async () => {
    const cache = fakeCache();
    let calls = 0;
    const fetchImpl = async () => (calls++, ok());
    await handleTileRequest(req(1), cache, fetchImpl, () => 1000);
    const again = await handleTileRequest(req(1), cache, fetchImpl, () => 2000);
    expect(calls).toBe(1);
    expect(await again.text()).toBe("png");
  });

  it("keeps at most `max` tiles, dropping the least recently used", async () => {
    const cache = fakeCache();
    const fetchImpl = async () => ok();
    for (let i = 1; i <= 3; i++) await handleTileRequest(req(i), cache, fetchImpl, () => 1, 3);
    await handleTileRequest(req(1), cache, fetchImpl, () => 2, 3); // 1 is used again
    await handleTileRequest(req(4), cache, fetchImpl, () => 3, 3);
    expect([...cache.map.keys()].map((u) => u.split("/")[4])).toEqual(["3", "1", "4"]);
  });

  it("never stores errors or opaque answers", async () => {
    const cache = fakeCache();
    await handleTileRequest(req(1), cache, async () => new Response("no", { status: 404 }));
    const opaque = ok();
    Object.defineProperty(opaque, "type", { value: "opaque" });
    await handleTileRequest(req(2), cache, async () => opaque);
    expect(cache.map.size).toBe(0);
  });

  it("refetches after 7 days, but falls back to the old tile when that fails", async () => {
    const cache = fakeCache();
    await handleTileRequest(
      req(1),
      cache,
      async () => ok(),
      () => 0,
    );
    const later = TILE_CACHE_MAX_AGE_MS + 1;
    let calls = 0;
    await handleTileRequest(
      req(1),
      cache,
      async () => (calls++, ok()),
      () => later,
    );
    expect(calls).toBe(1);
    const stale = fakeCache();
    await handleTileRequest(
      req(1),
      stale,
      async () => ok(),
      () => 0,
    );
    const res = await handleTileRequest(
      req(1),
      stale,
      async () => {
        throw new TypeError("offline");
      },
      () => later,
    );
    expect(await res.text()).toBe("png");
  });

  it("fails like the network when there is no copy", async () => {
    await expect(
      handleTileRequest(req(1), fakeCache(), async () => {
        throw new TypeError("offline");
      }),
    ).rejects.toThrow("offline");
  });
});
