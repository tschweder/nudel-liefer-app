// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../test-db";
import { AuthorizationError, resolveActor } from "./actor";
import { authenticate } from "./authenticate";
import { hashSecret } from "./password";
import { LOGIN_WINDOW_MS } from "./rate-limit";

// Needs a real PostgreSQL (`DATABASE_URL`); skipped (not faked) otherwise.
describe.skipIf(!process.env.DATABASE_URL)(
  "authentication (integration)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let inactiveId: string;

    beforeAll(async () => {
      t = await createTestDb();
      const [pw, pin] = await Promise.all([hashSecret("correct horse"), hashSecret("123456")]);
      const mk = (data: Parameters<typeof t.prisma.user.create>[0]["data"]) =>
        t.prisma.user.create({ data });
      adminId = (
        await mk({
          role: "ADMIN",
          email: "Boss@Example.com",
          passwordHash: pw,
          displayName: "Boss",
        })
      ).id;
      driverId = (
        await mk({
          role: "DRIVER",
          username: "hk-driver",
          passwordHash: pin,
          displayName: "HK",
          locale: "zh_Hant_HK",
        })
      ).id;
      inactiveId = (
        await mk({
          role: "DRIVER",
          username: "gone",
          passwordHash: pin,
          displayName: "Gone",
          active: false,
        })
      ).id;
      await mk({ role: "DRIVER", username: "other", passwordHash: pin, displayName: "Other" });
      await mk({ role: "DRIVER", username: "limited", passwordHash: pin, displayName: "Limited" });
    }, 60_000);

    afterAll(async () => {
      await t?.teardown();
    });

    const run = (
      kind: "admin" | "driver",
      identifier: unknown,
      secret: unknown,
      extra: { ip?: string | null; now?: Date } = {},
    ) =>
      authenticate({
        db: t.prisma,
        kind,
        identifier,
        secret,
        ip: extra.ip ?? null,
        now: extra.now,
      });

    describe("credentials", () => {
      it("logs in an admin (email case-insensitive) and a driver with their locale", async () => {
        const a = await run("admin", "boss@example.com", "correct horse");
        expect(a).toMatchObject({ ok: true, user: { id: adminId, role: "ADMIN", locale: "de" } });
        const d = await run("driver", "HK-Driver", "123456");
        expect(d).toMatchObject({
          ok: true,
          user: { id: driverId, role: "DRIVER", locale: "zh-Hant-HK" },
        });
      });

      it("rejects wrong secrets, malformed PINs and the wrong account type", async () => {
        expect(await run("admin", "boss@example.com", "nope")).toEqual({
          ok: false,
          reason: "invalid",
        });
        expect(await run("driver", "other", "12345")).toEqual({ ok: false, reason: "invalid" });
        expect(await run("driver", "other", "abcdef")).toEqual({ ok: false, reason: "invalid" });
        expect(await run("driver", "other", undefined)).toEqual({ ok: false, reason: "invalid" });
        // a driver cannot use the admin form and an admin cannot use the driver form
        expect(await run("admin", "other", "123456")).toEqual({ ok: false, reason: "invalid" });
        expect(await run("driver", "Boss", "123456")).toEqual({ ok: false, reason: "invalid" });
      });

      it("rejects inactive users even with the correct PIN", async () => {
        expect(await run("driver", "gone", "123456")).toEqual({ ok: false, reason: "invalid" });
      });
    });

    describe("rate limiting", () => {
      it("rejects the 6th attempt within 15 minutes, even with the right PIN", async () => {
        const t0 = new Date("2026-10-17T08:00:00Z");
        for (let i = 0; i < 5; i++) {
          const r = await run("driver", "limited", "000000", {
            now: new Date(t0.getTime() + i * 1000),
          });
          expect(r).toEqual({ ok: false, reason: "invalid" });
        }
        const sixth = await run("driver", "limited", "123456", {
          now: new Date(t0.getTime() + 10_000),
        });
        expect(sixth).toEqual({ ok: false, reason: "rate_limited" });
        // other users are unaffected
        expect((await run("driver", "hk-driver", "123456", { now: t0 })).ok).toBe(true);
        // after the window the user can log in again
        const later = new Date(t0.getTime() + LOGIN_WINDOW_MS + 10_000);
        expect((await run("driver", "limited", "123456", { now: later })).ok).toBe(true);
      });

      it("applies the limit to unknown usernames too and a success resets the counter", async () => {
        const t0 = new Date("2026-10-18T08:00:00Z");
        for (let i = 0; i < 5; i++) await run("driver", "ghost", "000000", { now: t0 });
        expect(await run("driver", "ghost", "000000", { now: t0 })).toEqual({
          ok: false,
          reason: "rate_limited",
        });

        for (let i = 0; i < 4; i++) await run("admin", "boss@example.com", "bad", { now: t0 });
        expect((await run("admin", "boss@example.com", "correct horse", { now: t0 })).ok).toBe(
          true,
        );
        for (let i = 0; i < 4; i++) await run("admin", "boss@example.com", "bad", { now: t0 });
        expect((await run("admin", "boss@example.com", "correct horse", { now: t0 })).ok).toBe(
          true,
        );
      });

      it("limits an IP across usernames (20 per window)", async () => {
        const t0 = new Date("2026-10-19T08:00:00Z");
        for (let i = 0; i < 20; i++) {
          await run("driver", `u${i}`, "000000", { ip: "203.0.113.9", now: t0 });
        }
        expect(await run("driver", "hk-driver", "123456", { ip: "203.0.113.9", now: t0 })).toEqual({
          ok: false,
          reason: "rate_limited",
        });
        expect(
          (await run("driver", "hk-driver", "123456", { ip: "203.0.113.10", now: t0 })).ok,
        ).toBe(true);
      });
    });

    describe("resolveActor (requireRole core)", () => {
      it("allows the right role", async () => {
        await expect(resolveActor({ id: adminId }, ["ADMIN"], t.prisma)).resolves.toMatchObject({
          id: adminId,
          role: "ADMIN",
        });
      });

      it("rejects a driver for admin-only actions (FORBIDDEN)", async () => {
        await expect(resolveActor({ id: driverId }, ["ADMIN"], t.prisma)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      });

      it("rejects an admin for driver-only mutations", async () => {
        await expect(resolveActor({ id: adminId }, ["DRIVER"], t.prisma)).rejects.toBeInstanceOf(
          AuthorizationError,
        );
      });

      it("rejects anonymous, unknown and deactivated users (UNAUTHENTICATED)", async () => {
        for (const claims of [null, undefined, {}, { id: "does-not-exist" }, { id: inactiveId }]) {
          await expect(resolveActor(claims, ["ADMIN", "DRIVER"], t.prisma)).rejects.toMatchObject({
            code: "UNAUTHENTICATED",
          });
        }
      });

      it("uses the database role, not the token's", async () => {
        // token may claim ADMIN, but only the id is read: the driver stays a driver
        await expect(
          resolveActor({ id: driverId, role: "ADMIN" } as { id: string }, ["ADMIN"], t.prisma),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  },
);
