// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const actions = await import("./user-actions");

// Authorization tests: every new mutation rejects non-admins before touching data.
describe.skipIf(!process.env.DATABASE_URL)(
  "user actions authorization",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let inactiveAdminId: string;

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      const hash = await hashSecret("123456");
      const mk = (data: Parameters<typeof t.prisma.user.create>[0]["data"]) =>
        t.prisma.user.create({ data }).then((u) => u.id);
      adminId = await mk({
        role: "ADMIN",
        email: "a@example.com",
        passwordHash: hash,
        displayName: "A",
      });
      driverId = await mk({
        role: "DRIVER",
        username: "drv",
        passwordHash: hash,
        displayName: "D",
      });
      inactiveAdminId = await mk({
        role: "ADMIN",
        email: "i@example.com",
        passwordHash: hash,
        displayName: "I",
        active: false,
      });
    }, 60_000);

    afterAll(async () => {
      await t?.teardown();
    });

    beforeEach(() => {
      state.session = null;
    });

    const calls: Array<[string, () => Promise<unknown>]> = [
      [
        "createDriverAction",
        () => actions.createDriverAction({ displayName: "N", username: "newdrv", locale: "de" }),
      ],
      [
        "createAdminAction",
        () =>
          actions.createAdminAction({
            displayName: "N",
            email: "n@example.com",
            password: "long-enough-pw",
          }),
      ],
      ["resetDriverPinAction", () => actions.resetDriverPinAction(driverId)],
      ["setUserActiveAction", () => actions.setUserActiveAction(driverId, false)],
      ["setDriverLocaleAction", () => actions.setDriverLocaleAction(driverId, "zh-Hans")],
    ];

    it.each(calls)("%s rejects anonymous callers (UNAUTHENTICATED)", async (_name, call) => {
      await expect(call()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    });

    it.each(calls)("%s rejects drivers (FORBIDDEN)", async (_name, call) => {
      state.session = { user: { id: driverId } };
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects a deactivated admin with a still-valid session", async () => {
      state.session = { user: { id: inactiveAdminId } };
      await expect(actions.resetDriverPinAction(driverId)).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    });

    it("nothing was changed by the rejected calls", async () => {
      expect(await t.prisma.user.count()).toBe(3);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: driverId } })).active).toBe(
        true,
      );
    });

    it("an admin can use the actions, and cannot deactivate himself", async () => {
      state.session = { user: { id: adminId } };
      const created = await actions.createDriverAction({
        displayName: "N",
        username: "newdrv",
        locale: "de",
      });
      expect(created.ok).toBe(true);
      expect(await actions.setUserActiveAction(adminId, false)).toEqual({
        ok: false,
        error: "self",
      });
      expect(await actions.setUserActiveAction(driverId, false)).toEqual({ ok: true });
    });
  },
);
