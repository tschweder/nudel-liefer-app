import { describe, expect, it, vi } from "vitest";

import type { OutboxNotice } from "./outbox";
import { createPhotoOutboxController } from "./photo-outbox-controller";
import { createMemoryPhotoStore } from "./photo-outbox-store";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Call = { url: string; method: string; body: unknown };

/**
 * A fake server: `/api/uploads` hands out keys, the "storage" PUT stores the key, the register
 * endpoint is scripted per test. `online=false` makes every request fail like a dead network.
 */
function setup(
  options: {
    register?: (body: Record<string, string>, call: number) => Response | Promise<Response>;
    uploads?: () => Response | undefined;
    put?: (call: number) => Response | undefined;
  } = {},
) {
  const store = createMemoryPhotoStore();
  const notices: OutboxNotice[] = [];
  const cached: string[] = [];
  const calls: Call[] = [];
  const registered = new Map<string, Record<string, string>>();
  const uploadedKeys = new Set<string>();
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let online = true;
  let clock = Date.parse("2099-07-02T08:00:00.000Z");
  let ids = 0;
  let keys = 0;
  let registerCalls = 0;
  let putCalls = 0;

  const defaultRegister = (body: Record<string, string>) => {
    registered.set(body.clientMutationId!, body);
    return json({
      outcome: "applied",
      kind: body.kind,
      customerId: "c1",
      photo: {
        id: `photo-${body.clientMutationId}`,
        url: "https://s3.test/r",
        width: 1600,
        height: 1200,
      },
    });
  };

  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ url, method, body });
    if (!online) throw new TypeError("Failed to fetch");
    if (url === "/api/uploads") {
      const fixed = options.uploads?.();
      if (fixed) return fixed;
      const storageKey = `customers/key-${++keys}.jpg`;
      return json({
        storageKey,
        uploadUrl: `https://s3.test/put/${storageKey}`,
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        expiresAt: "2099-07-02T08:05:00.000Z",
      });
    }
    if (url.startsWith("https://s3.test/put/")) {
      const refused = options.put?.(++putCalls);
      if (refused) return refused;
      uploadedKeys.add(url.slice("https://s3.test/put/".length));
      return new Response(null, { status: 200 });
    }
    if (url === "/api/driver/photos") {
      registerCalls += 1;
      return (options.register ?? defaultRegister)(body as Record<string, string>, registerCalls);
    }
    throw new Error(`unexpected request ${url}`);
  }) as unknown as typeof fetch;

  const controller = createPhotoOutboxController({
    store,
    putNotice: async (n) => void notices.push(n),
    cachePhoto: async (id) => void cached.push(id),
    fetchImpl,
    now: () => new Date(clock),
    newId: () => `id-${++ids}`,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => undefined,
  });
  return {
    store,
    notices,
    cached,
    calls,
    registered,
    uploadedKeys,
    timers,
    controller,
    setOnline: (value: boolean) => void (online = value),
    tick: (ms: number) => void (clock += ms),
  };
}

const photo = (extra: Record<string, unknown> = {}) => ({
  stopId: "s1",
  customerId: "c1",
  customerName: "Trattoria",
  kind: "STORE" as const,
  blob: new Blob(["jpeg"], { type: "image/jpeg" }),
  width: 1600,
  height: 1200,
  ...extra,
});

const posts = (calls: Call[], url: string) => calls.filter((c) => c.url === url);

describe("offline capture", () => {
  it("keeps the blob on the device while the network is down, sends nothing, then delivers once", async () => {
    const t = setup();
    await t.controller.start("u1");
    t.setOnline(false);
    const entry = await t.controller.enqueue(photo());
    const result = await t.controller.flush();
    expect(result).toMatchObject({ kind: "ran", failure: "network" });
    expect(t.controller.getState().entries).toHaveLength(1);
    expect(t.store.entryRows.get(entry.clientMutationId)?.blob.size).toBe(4);
    expect(t.registered.size).toBe(0);
    expect(t.timers.length).toBeGreaterThan(0); // backoff retry scheduled

    t.setOnline(true);
    const sent = await t.controller.flush({ force: true });
    expect(sent).toMatchObject({ kind: "ran", failure: null });
    expect(t.registered.size).toBe(1);
    expect(t.registered.get(entry.clientMutationId)).toMatchObject({
      stopId: "s1",
      kind: "STORE",
      storageKey: "customers/key-1.jpg",
    });
    expect(t.uploadedKeys.size).toBe(1);
    expect(t.controller.getState().entries).toHaveLength(0);
    expect(t.cached).toEqual([`photo-${entry.clientMutationId}`]);
    expect(t.controller.getState().confirmed["c1:STORE"]?.id).toBe(
      `photo-${entry.clientMutationId}`,
    );
  });

  it("does not send the register request with a client-chosen customer", async () => {
    const t = setup();
    await t.controller.start("u1");
    await t.controller.enqueue(photo());
    await t.controller.flush();
    const body = posts(t.calls, "/api/driver/photos")[0]!.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["clientMutationId", "height", "kind", "storageKey", "stopId", "width"].sort(),
    );
  });
});

describe("retries are idempotent", () => {
  it("a lost register answer: the retry registers again with the same id and does not upload again", async () => {
    let first = true;
    const t = setup({
      register: (body) => {
        t.registered.set(body.clientMutationId!, body);
        if (first) {
          first = false;
          throw new TypeError("connection dropped after the server saw it");
        }
        return json({
          outcome: "replayed",
          kind: body.kind,
          customerId: "c1",
          photo: { id: "photo-1", url: "https://s3.test/r", width: 1, height: 1 },
        });
      },
    });
    await t.controller.start("u1");
    const entry = await t.controller.enqueue(photo());
    expect(await t.controller.flush()).toMatchObject({ failure: "network" });
    // the entry kept the key of the finished upload
    expect(t.store.entryRows.get(entry.clientMutationId)?.storageKey).toBe("customers/key-1.jpg");

    expect(await t.controller.flush({ force: true })).toMatchObject({ failure: null });
    const registerCalls = posts(t.calls, "/api/driver/photos");
    expect(registerCalls).toHaveLength(2);
    expect(
      new Set(registerCalls.map((c) => (c.body as Record<string, string>).clientMutationId)).size,
    ).toBe(1);
    expect(
      new Set(registerCalls.map((c) => (c.body as Record<string, string>).storageKey)).size,
    ).toBe(1);
    expect(posts(t.calls, "/api/uploads")).toHaveLength(1);
    expect(t.uploadedKeys.size).toBe(1);
    expect(t.controller.getState().entries).toHaveLength(0);
  });

  it("a refused storage PUT (expired signature) keeps no key; the retry asks for a fresh grant", async () => {
    const t = setup({ put: (n) => (n === 1 ? new Response(null, { status: 403 }) : undefined) });
    await t.controller.start("u1");
    const entry = await t.controller.enqueue(photo());
    expect(await t.controller.flush()).toMatchObject({ failure: "server" });
    expect(t.store.entryRows.get(entry.clientMutationId)?.storageKey).toBeUndefined();
    expect(t.registered.size).toBe(0);

    expect(await t.controller.flush({ force: true })).toMatchObject({ failure: null });
    expect(posts(t.calls, "/api/uploads")).toHaveLength(2);
    expect(t.registered.get(entry.clientMutationId)?.storageKey).toBe("customers/key-2.jpg");
    expect(t.uploadedKeys).toEqual(new Set(["customers/key-2.jpg"]));
  });

  it("server 5xx keeps the photo queued and backs off", async () => {
    const t = setup({ register: () => json({ error: "x" }, 503) });
    await t.controller.start("u1");
    await t.controller.enqueue(photo());
    expect(await t.controller.flush()).toMatchObject({ failure: "server" });
    expect(t.controller.getState().entries).toHaveLength(1);
    // inside the backoff window a normal trigger does nothing, a forced one tries
    const before = t.calls.length;
    await t.controller.flush();
    expect(t.calls.length).toBe(before);
    await t.controller.flush({ force: true });
    expect(t.calls.length).toBeGreaterThan(before);
  });

  it("401 / 403 keeps the photo for the next login", async () => {
    const t = setup({ uploads: () => json({ error: "unauthenticated" }, 401) });
    await t.controller.start("u1");
    await t.controller.enqueue(photo());
    expect(await t.controller.flush()).toMatchObject({ failure: "unauthorized" });
    expect(t.controller.getState().entries).toHaveLength(1);
    expect(t.notices).toHaveLength(0);
  });
});

describe("answers that can never succeed", () => {
  it("a rejected photo is removed and leaves a notice", async () => {
    const t = setup({ register: () => json({ outcome: "rejected", error: "not_found" }) });
    await t.controller.start("u1");
    const entry = await t.controller.enqueue(photo());
    const outcome = await t.controller.flush();
    expect(outcome).toMatchObject({ kind: "ran", rejected: 1, failure: null });
    expect(t.controller.getState().entries).toHaveLength(0);
    expect(t.notices).toEqual([
      expect.objectContaining({
        id: entry.clientMutationId,
        type: "photo",
        error: "not_found",
        customerName: "Trattoria",
        stopId: "s1",
      }),
    ]);
    expect(t.cached).toHaveLength(0);
  });

  it("a blob the upload endpoint refuses is dropped with a notice, the next photo still goes", async () => {
    let n = 0;
    const t = setup({ uploads: () => (++n === 1 ? json({ error: "TOO_LARGE" }, 413) : undefined) });
    await t.controller.start("u1");
    await t.controller.enqueue(photo({ customerId: "c1" }));
    t.tick(1000);
    await t.controller.enqueue(photo({ customerId: "c2", stopId: "s2" }));
    await t.controller.flush();
    expect(t.notices.map((x) => x.error)).toEqual(["invalid"]);
    expect(t.registered.size).toBe(1);
    expect(t.controller.getState().entries).toHaveLength(0);
  });

  it("object_missing: uploads again, and gives up after three misses", async () => {
    const t = setup({ register: () => json({ outcome: "rejected", error: "object_missing" }) });
    await t.controller.start("u1");
    await t.controller.enqueue(photo());
    await t.controller.flush();
    expect(posts(t.calls, "/api/uploads")).toHaveLength(3);
    expect(t.notices).toHaveLength(1);
    expect(t.controller.getState().entries).toHaveLength(0);
  });
});

describe("queue management", () => {
  it("a newer photo of the same slot replaces an unsent older one; other slots stay", async () => {
    const t = setup();
    await t.controller.start("u1");
    t.setOnline(false);
    await t.controller.enqueue(photo());
    t.tick(1000);
    await t.controller.enqueue(photo({ kind: "PARKING" }));
    t.tick(1000);
    const newest = await t.controller.enqueue(photo());
    const entries = t.controller.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.kind).sort()).toEqual(["PARKING", "STORE"]);
    expect(entries.find((e) => e.kind === "STORE")?.clientMutationId).toBe(newest.clientMutationId);
  });

  it("sends photos oldest first", async () => {
    const t = setup();
    await t.controller.start("u1");
    t.setOnline(false);
    const a = await t.controller.enqueue(photo({ customerId: "c1", stopId: "s1" }));
    t.tick(1000);
    const b = await t.controller.enqueue(photo({ customerId: "c2", stopId: "s2" }));
    t.setOnline(true);
    await t.controller.flush({ force: true });
    expect(
      posts(t.calls, "/api/driver/photos").map(
        (c) => (c.body as Record<string, string>).clientMutationId,
      ),
    ).toEqual([a.clientMutationId, b.clientMutationId]);
  });

  it("only the photos of the logged-in driver are sent; a stranger's are dropped after 3 days", async () => {
    const t = setup();
    const stranger = (id: string, createdAt: string) => ({
      clientMutationId: id,
      userId: "u2",
      stopId: "sx",
      customerId: "cx",
      customerName: "X",
      kind: "STORE" as const,
      blob: new Blob(["x"], { type: "image/jpeg" }),
      width: 1,
      height: 1,
      createdAt,
      seq: 1,
    });
    t.store.entryRows.set("old", stranger("old", "2099-06-28T08:00:00.000Z"));
    t.store.entryRows.set("young", stranger("young", "2099-07-02T07:00:00.000Z"));
    await t.controller.start("u1");
    expect([...t.store.entryRows.keys()]).toEqual(["young"]);
    expect(t.controller.getState().entries).toHaveLength(0);
    await t.controller.flush({ force: true });
    expect(t.calls).toHaveLength(0);
  });

  it("patches the stored tour copy so a reload offline shows the photo", async () => {
    const t = setup();
    t.store.tourRows.set("u1", {
      userId: "u1",
      data: {
        tour: {
          stops: [{ id: "s1", customerId: "c1", photos: { STORE: null, PARKING: null } }],
        },
      },
    });
    await t.controller.start("u1");
    const entry = await t.controller.enqueue(photo());
    await t.controller.flush();
    const row = t.store.tourRows.get("u1") as {
      data: { tour: { stops: Array<{ photos: { STORE: { id: string } | null } }> } };
    };
    expect(row.data.tour.stops[0]!.photos.STORE?.id).toBe(`photo-${entry.clientMutationId}`);
  });
});
