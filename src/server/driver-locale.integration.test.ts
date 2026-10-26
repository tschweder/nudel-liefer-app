// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
const cookieJar = new Map<string, string>();
vi.mock("./auth/auth", () => ({
  auth: async () => state.session,
  updateSession: async () => undefined,
}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string) => cookieJar.set(name, value) }),
}));
// `connection()` (NUD-097) only works inside a Next.js request scope.
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const { chooseDriverLocaleAction } = await import("./driver-locale-actions");
const { requirePageActor } = await import("./auth/page-guards");

describe.skipIf(!process.env.DATABASE_URL)(
  "driver first-start language picker",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let chosenDriverId: string;
    let inactiveDriverId: string;

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
        username: "new-drv",
        passwordHash: hash,
        displayName: "D",
      });
      chosenDriverId = await mk({
        role: "DRIVER",
        username: "old-drv",
        passwordHash: hash,
        displayName: "O",
        locale: "zh_Hans",
        localeChosen: true,
      });
      inactiveDriverId = await mk({
        role: "DRIVER",
        username: "off-drv",
        passwordHash: hash,
        displayName: "X",
        active: false,
      });
    }, 60_000);

    afterAll(async () => {
      await t?.teardown();
    });

    beforeEach(async () => {
      state.session = null;
      cookieJar.clear();
      await t.prisma.user.update({
        where: { id: driverId },
        data: { locale: "de", localeChosen: false },
      });
    });

    const userOf = (id: string) => t.prisma.user.findUniqueOrThrow({ where: { id } });

    it("saves locale and localeChosen for the logged-in driver, then opens his home", async () => {
      state.session = { user: { id: driverId } };
      await expect(chooseDriverLocaleAction("sr-Latn")).rejects.toThrow("REDIRECT:/sr-Latn/driver");
      const u = await userOf(driverId);
      expect(u.locale).toBe("sr_Latn");
      expect(u.localeChosen).toBe(true);
      expect(cookieJar.get("NEXT_LOCALE")).toBe("sr-Latn");
    });

    it("rejects invalid locales and changes nothing", async () => {
      state.session = { user: { id: driverId } };
      for (const bad of ["fr", "", "sr_Latn", "zh-Hant-TW", "../x"]) {
        await expect(chooseDriverLocaleAction(bad)).rejects.toThrow();
      }
      const u = await userOf(driverId);
      expect(u.locale).toBe("de");
      expect(u.localeChosen).toBe(false);
    });

    it("rejects anonymous, admin and deactivated callers before touching data", async () => {
      for (const session of [null, { user: { id: adminId } }, { user: { id: inactiveDriverId } }]) {
        state.session = session;
        await expect(chooseDriverLocaleAction("zh-Hans")).rejects.toThrow(
          /UNAUTHENTICATED|FORBIDDEN/,
        );
      }
      for (const id of [adminId, inactiveDriverId, driverId]) {
        expect((await userOf(id)).localeChosen).toBe(false);
        expect((await userOf(id)).locale).toBe("de");
      }
    });

    it("cannot be used to change another user's language (id comes from the session)", async () => {
      state.session = { user: { id: driverId } };
      await expect(chooseDriverLocaleAction("zh-Hans")).rejects.toThrow("REDIRECT:");
      expect((await userOf(chosenDriverId)).locale).toBe("zh_Hans");
      expect((await userOf(adminId)).locale).toBe("de");
    });

    describe("page guard", () => {
      it("sends a driver without a chosen language to the picker from every driver page", async () => {
        state.session = { user: { id: driverId } };
        await expect(requirePageActor("driver", "de")).rejects.toThrow("REDIRECT:/de/driver/start");
        await expect(requirePageActor("driver", "cs")).rejects.toThrow("REDIRECT:/cs/driver/start");
      });

      it("lets the picker page itself through, and drivers who chose skip the picker", async () => {
        state.session = { user: { id: driverId } };
        const actor = await requirePageActor("driver", "de", { allowUnchosen: true });
        expect(actor.localeChosen).toBe(false);
        state.session = { user: { id: chosenDriverId } };
        expect((await requirePageActor("driver", "zh-Hans")).localeChosen).toBe(true);
      });

      it("does not force admins (support view) through the picker", async () => {
        state.session = { user: { id: adminId } };
        expect((await requirePageActor("driver", "de")).role).toBe("ADMIN");
      });

      it("after choosing, the same page no longer redirects", async () => {
        state.session = { user: { id: driverId } };
        await expect(chooseDriverLocaleAction("zh-Hans")).rejects.toThrow("REDIRECT:");
        expect((await requirePageActor("driver", "zh-Hans")).locale).toBe("zh-Hans");
      });
    });
  },
);
