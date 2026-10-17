// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES } from "@/lib/uploads";

import { type Actor, AuthorizationError, resolveActor, type Role } from "./auth/actor";
import { FakeStorage } from "./storage/fake";
import { handleCreateUpload } from "./uploads";

type FakeUser = { id: string; role: Role; active: boolean; locale: "de"; displayName: string };

const users: Record<string, FakeUser> = {
  admin: { id: "admin", role: "ADMIN", active: true, locale: "de", displayName: "A" },
  driver: { id: "driver", role: "DRIVER", active: true, locale: "de", displayName: "D" },
  gone: { id: "gone", role: "ADMIN", active: false, locale: "de", displayName: "G" },
};
const db = {
  user: { findUnique: async ({ where }: { where: { id: string } }) => users[where.id] ?? null },
};

/** Uses the real `resolveActor` so role / active-user rules are exercised, only the session is faked. */
function deps(sessionUserId: string | null, storage = new FakeStorage()) {
  return {
    storage: () => storage,
    requireRole: (...roles: Role[]): Promise<Actor> =>
      resolveActor(sessionUserId ? { id: sessionUserId } : null, roles, db as never),
  };
}

function post(body: unknown) {
  return new Request("http://localhost/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = { purpose: "customer-photo", contentType: "image/jpeg", size: 200_000 };

describe("POST /api/uploads", () => {
  let storage: FakeStorage;
  beforeEach(() => {
    storage = new FakeStorage();
  });

  it("rejects unauthenticated requests with 401 and never touches storage", async () => {
    const res = await handleCreateUpload(post(valid), deps(null, storage));
    expect(res.status).toBe(401);
  });

  it("rejects deactivated and unknown users with 401", async () => {
    expect((await handleCreateUpload(post(valid), deps("gone", storage))).status).toBe(401);
    expect((await handleCreateUpload(post(valid), deps("nobody", storage))).status).toBe(401);
  });

  it("rejects an unsupported content type with 400", async () => {
    for (const contentType of ["application/pdf", "image/svg+xml", "text/html", "image/gif"]) {
      const res = await handleCreateUpload(post({ ...valid, contentType }), deps("admin", storage));
      expect(res.status, contentType).toBe(400);
      expect(await res.json()).toMatchObject({ error: "UNSUPPORTED_CONTENT_TYPE" });
    }
  });

  it("rejects malformed bodies with 400", async () => {
    expect((await handleCreateUpload(post("not json"), deps("admin"))).status).toBe(400);
    expect((await handleCreateUpload(post({}), deps("admin"))).status).toBe(400);
    expect((await handleCreateUpload(post({ ...valid, size: -1 }), deps("admin"))).status).toBe(
      400,
    );
    expect((await handleCreateUpload(post({ ...valid, size: 1.5 }), deps("admin"))).status).toBe(
      400,
    );
    expect(
      (await handleCreateUpload(post({ ...valid, purpose: "../etc" }), deps("admin"))).status,
    ).toBe(400);
  });

  it("rejects files above 15 MB with 413 and accepts exactly 15 MB", async () => {
    const big = await handleCreateUpload(
      post({ ...valid, size: MAX_UPLOAD_BYTES + 1 }),
      deps("admin"),
    );
    expect(big.status).toBe(413);
    const ok = await handleCreateUpload(post({ ...valid, size: MAX_UPLOAD_BYTES }), deps("admin"));
    expect(ok.status).toBe(200);
  });

  it("authorization: a driver may upload customer photos but not order screenshots", async () => {
    const photo = await handleCreateUpload(post(valid), deps("driver"));
    expect(photo.status).toBe(200);
    const shot = await handleCreateUpload(
      post({ ...valid, purpose: "screenshot" }),
      deps("driver"),
    );
    expect(shot.status).toBe(403);
    const adminShot = await handleCreateUpload(
      post({ ...valid, purpose: "screenshot" }),
      deps("admin"),
    );
    expect(adminShot.status).toBe(200);
  });

  it("returns a server-chosen key, presigned target and no caching", async () => {
    const res = await handleCreateUpload(
      post({ ...valid, contentType: "image/webp" }),
      deps("admin", storage),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const grant = await res.json();
    expect(grant.storageKey).toMatch(/^customers\/[0-9a-f-]{36}\.webp$/);
    expect(grant).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/webp" } });
    expect(grant.uploadUrl).toContain(grant.storageKey);
    expect(new Date(grant.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const second = await (await handleCreateUpload(post(valid), deps("admin"))).json();
    expect(second.storageKey).not.toBe(grant.storageKey);
  });

  it("re-throws unexpected errors instead of reporting them as auth failures", async () => {
    const failing = {
      storage: () => storage,
      requireRole: async () => {
        throw new Error("db down");
      },
    };
    await expect(handleCreateUpload(post(valid), failing)).rejects.toThrow("db down");
    expect(new AuthorizationError("FORBIDDEN")).toBeInstanceOf(Error);
  });
});
