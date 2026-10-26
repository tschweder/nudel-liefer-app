// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthorizationError, resolveActor } from "./auth/actor";
import { authenticate } from "./auth/authenticate";
import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";
import {
  createAdmin,
  createDriver,
  generatePin,
  listUsers,
  resetDriverPin,
  setDriverLocale,
  setUserActive,
} from "./users";

describe("generatePin", () => {
  it("returns 6 digits, leading zeros allowed", () => {
    for (let i = 0; i < 200; i++) expect(generatePin()).toMatch(/^\d{6}$/);
  });
});

// Needs a real PostgreSQL (`DATABASE_URL`); skipped (not faked) otherwise.
describe.skipIf(!process.env.DATABASE_URL)(
  "user management (integration)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;

    beforeAll(async () => {
      t = await createTestDb();
      adminId = (
        await t.prisma.user.create({
          data: {
            role: "ADMIN",
            email: "boss@example.com",
            passwordHash: await hashSecret("correct horse"),
            displayName: "Boss",
          },
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      await t?.teardown();
    });

    const loginDriver = (username: string, secret: string) =>
      authenticate({ db: t.prisma, kind: "driver", identifier: username, secret, ip: null });

    it("creates a driver whose shown PIN logs in, and stores only a hash", async () => {
      const result = await createDriver(t.prisma, {
        displayName: " Li Wei ",
        username: "Li.Wei",
        locale: "cs",
      });
      if (!result.ok) throw new Error("expected ok");
      expect(result.pin).toMatch(/^\d{6}$/);
      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: result.id } });
      expect(row).toMatchObject({
        role: "DRIVER",
        username: "li.wei",
        displayName: "Li Wei",
        locale: "cs",
        active: true,
        lastLoginAt: null,
      });
      expect(row.passwordHash).not.toContain(result.pin);
      const login = await loginDriver("li.wei", result.pin);
      expect(login.ok).toBe(true);
      const after = await t.prisma.user.findUniqueOrThrow({ where: { id: result.id } });
      expect(after.lastLoginAt).toBeInstanceOf(Date);
    });

    it("rejects duplicate usernames (case-insensitive) and invalid input", async () => {
      expect(
        await createDriver(t.prisma, { displayName: "X", username: "LI.WEI", locale: "de" }),
      ).toEqual({
        ok: false,
        error: "username_taken",
      });
      for (const bad of [
        { displayName: "", username: "abc", locale: "de" },
        { displayName: "A", username: "a b", locale: "de" },
        { displayName: "A", username: "ab", locale: "de" },
        { displayName: "A", username: "abc", locale: "fr" },
        null,
        "x",
      ]) {
        expect(await createDriver(t.prisma, bad)).toEqual({ ok: false, error: "invalid" });
      }
    });

    it("reset PIN invalidates the old PIN immediately", async () => {
      const created = await createDriver(t.prisma, {
        displayName: "Reset",
        username: "reset-me",
        locale: "de",
      });
      if (!created.ok) throw new Error("expected ok");
      expect((await loginDriver("reset-me", created.pin)).ok).toBe(true);
      const reset = await resetDriverPin(t.prisma, created.id);
      if (!reset.ok) throw new Error("expected ok");
      const oldPinWorks = reset.pin === created.pin; // 1 in a million: regenerate in that case
      if (!oldPinWorks) expect((await loginDriver("reset-me", created.pin)).ok).toBe(false);
      expect((await loginDriver("reset-me", reset.pin)).ok).toBe(true);
    });

    it("reset PIN also lifts a rate-limit lock-out and refuses non-drivers / unknown ids", async () => {
      const created = await createDriver(t.prisma, {
        displayName: "Locked",
        username: "locked-out",
        locale: "de",
      });
      if (!created.ok) throw new Error("expected ok");
      const wrong = created.pin === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) await loginDriver("locked-out", wrong);
      expect(await loginDriver("locked-out", created.pin)).toEqual({
        ok: false,
        reason: "rate_limited",
      });
      const reset = await resetDriverPin(t.prisma, created.id);
      if (!reset.ok) throw new Error("expected ok");
      expect((await loginDriver("locked-out", reset.pin)).ok).toBe(true);
      expect(await resetDriverPin(t.prisma, adminId)).toEqual({ ok: false, error: "not_found" });
      expect(await resetDriverPin(t.prisma, "nope")).toEqual({ ok: false, error: "not_found" });
      expect(await resetDriverPin(t.prisma, 42)).toEqual({ ok: false, error: "invalid" });
    });

    it("deactivated drivers cannot log in and are rejected by the server-side actor check", async () => {
      const created = await createDriver(t.prisma, {
        displayName: "Gone",
        username: "gone-soon",
        locale: "de",
      });
      if (!created.ok) throw new Error("expected ok");
      await expect(resolveActor({ id: created.id }, ["DRIVER"], t.prisma)).resolves.toMatchObject({
        role: "DRIVER",
      });
      expect(await setUserActive(t.prisma, adminId, created.id, false)).toEqual({ ok: true });
      // existing session (valid JWT) -> next request fails
      await expect(resolveActor({ id: created.id }, ["DRIVER"], t.prisma)).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      await expect(resolveActor({ id: created.id }, ["DRIVER"], t.prisma)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      expect((await loginDriver("gone-soon", created.pin)).ok).toBe(false);
      // reactivation restores access
      expect(await setUserActive(t.prisma, adminId, created.id, true)).toEqual({ ok: true });
      expect((await loginDriver("gone-soon", created.pin)).ok).toBe(true);
    });

    it("an admin cannot deactivate himself; invalid ids/flags are rejected", async () => {
      expect(await setUserActive(t.prisma, adminId, adminId, false)).toEqual({
        ok: false,
        error: "self",
      });
      expect(await setUserActive(t.prisma, adminId, "missing", false)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await setUserActive(t.prisma, adminId, adminId, "yes")).toEqual({
        ok: false,
        error: "invalid",
      });
    });

    it("changes a driver's locale and validates it", async () => {
      const created = await createDriver(t.prisma, {
        displayName: "Loc",
        username: "loc-driver",
        locale: "de",
      });
      if (!created.ok) throw new Error("expected ok");
      expect(await setDriverLocale(t.prisma, created.id, "sr-Latn")).toEqual({ ok: true });
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: created.id } })).locale).toBe(
        "sr_Latn",
      );
      expect(await setDriverLocale(t.prisma, created.id, "xx")).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await setDriverLocale(t.prisma, adminId, "de")).toEqual({
        ok: false,
        error: "not_found",
      });
    });

    it("creates further admins (email + password) and rejects duplicates / weak passwords", async () => {
      const ok = await createAdmin(t.prisma, {
        displayName: "Second",
        email: " Second@Example.com ",
        password: "long-enough-pw",
      });
      expect(ok.ok).toBe(true);
      const row = await t.prisma.user.findFirstOrThrow({ where: { email: "second@example.com" } });
      expect(row.role).toBe("ADMIN");
      const login = await authenticate({
        db: t.prisma,
        kind: "admin",
        identifier: "second@example.com",
        secret: "long-enough-pw",
        ip: null,
      });
      expect(login.ok).toBe(true);
      expect(
        await createAdmin(t.prisma, {
          displayName: "D",
          email: "SECOND@example.com",
          password: "long-enough-pw",
        }),
      ).toEqual({
        ok: false,
        error: "email_taken",
      });
      expect(
        await createAdmin(t.prisma, {
          displayName: "D",
          email: "x@example.com",
          password: "short",
        }),
      ).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(
        await createAdmin(t.prisma, {
          displayName: "D",
          email: "not-an-email",
          password: "long-enough-pw",
        }),
      ).toEqual({
        ok: false,
        error: "invalid",
      });
    });

    it("lists users per role without secrets", async () => {
      const drivers = await listUsers(t.prisma, "DRIVER");
      expect(drivers.length).toBeGreaterThanOrEqual(4);
      expect(drivers.every((d) => d.role === "DRIVER")).toBe(true);
      expect(JSON.stringify(drivers)).not.toContain("passwordHash");
      const admins = await listUsers(t.prisma, "ADMIN");
      expect(admins.map((a) => a.email)).toContain("boss@example.com");
    });
  },
);
