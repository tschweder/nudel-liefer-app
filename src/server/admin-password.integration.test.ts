// @vitest-environment node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetAdminPassword } from "./admin-password";
import { authenticate } from "./auth/authenticate";
import { hashSecret } from "./auth/password";
import { createPrismaClient } from "./db";

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const OLD = "old-admin-password-1";
const NEW = "brand-new-Passw0rd!";

describe.skipIf(!process.env.DATABASE_URL)(
  "admin password reset (database)",
  { timeout: 120_000 },
  () => {
    const base = process.env.DATABASE_URL!;
    const dbName = `adm_${randomBytes(4).toString("hex")}`;
    const url = (() => {
      const u = new URL(base);
      u.pathname = `/${dbName}`;
      return u.toString();
    })();
    let admin: Client;
    let db: ReturnType<typeof createPrismaClient>;

    beforeAll(async () => {
      admin = new Client({ connectionString: base });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${dbName}"`);
      const c = new Client({ connectionString: url });
      await c.connect();
      for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()) {
        await c.query(readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8"));
      }
      const hash = await hashSecret(OLD);
      await c.query(
        `INSERT INTO "User" (id, role, email, "passwordHash", locale, "localeChosen", "displayName", active, "updatedAt") VALUES
       ('a1','ADMIN','Boss@Example.com',$1,'de',true,'Boss',true,now()),
       ('a2','ADMIN','gone@example.com',$1,'de',true,'Gone',false,now()),
       ('d1','DRIVER',NULL,$1,'de',true,'Driver',true,now())`,
        [hash],
      );
      await c.query(`UPDATE "User" SET username='driver1' WHERE id='d1'`);
      await c.end();
      db = createPrismaClient(url);
    }, 120_000);

    afterAll(async () => {
      await db?.$disconnect();
      await admin?.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      await admin?.end();
    });

    const login = (identifier: string, secret: string) =>
      authenticate({ db, kind: "admin", identifier, secret, ip: null });

    it("changes the password (old one stops working), clears the lock-out and ignores letter case", async () => {
      for (let i = 0; i < 5; i++) await login("boss@example.com", "wrong-password-xx");
      expect((await login("boss@example.com", OLD)).ok).toBe(false); // rate limited now
      const result = await resetAdminPassword(db, { email: "BOSS@example.com", password: NEW });
      expect(result).toEqual({ ok: true, id: "a1", reactivated: false });
      expect((await login("boss@example.com", NEW)).ok).toBe(true);
      expect((await login("boss@example.com", OLD)).ok).toBe(false);
    });

    it("refuses weak passwords, unknown addresses, drivers and (without the flag) deactivated admins", async () => {
      expect(
        await resetAdminPassword(db, { email: "boss@example.com", password: "short" }),
      ).toEqual({ ok: false, error: "weak_password" });
      expect(await resetAdminPassword(db, { email: "nobody@example.com", password: NEW })).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await resetAdminPassword(db, { email: "", password: NEW })).toEqual({
        ok: false,
        error: "invalid_input",
      });
      expect(await resetAdminPassword(db, { email: "gone@example.com", password: NEW })).toEqual({
        ok: false,
        error: "inactive",
      });
      const reactivated = await resetAdminPassword(db, {
        email: "gone@example.com",
        password: NEW,
        reactivate: true,
      });
      expect(reactivated).toEqual({ ok: true, id: "a2", reactivated: true });
      expect((await login("gone@example.com", NEW)).ok).toBe(true);
    });

    it("the CLI resets via stdin without ever printing the password, and refuses unsafe use", () => {
      const run = (args: string[], input: string | undefined, env: Record<string, string> = {}) =>
        spawnSync(TSX, ["scripts/admin-reset-password.ts", ...args], {
          input,
          encoding: "utf8",
          env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: "", ...env },
          timeout: 60_000,
        });
      const pw = "cli-secret-Passw0rd-42";
      const ok = run(["--email", "boss@example.com", "--yes"], `${pw}\n`);
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout + ok.stderr).not.toContain(pw);
      expect(ok.stdout).toContain("Password updated for boss@example.com");

      // Without --yes a non-interactive run is refused and changes nothing.
      const refused = run(["--email", "boss@example.com"], "another-pass-word-99\n");
      expect(refused.status).toBe(1);
      expect(refused.stderr).toMatch(/--yes/);

      // A password argument is rejected before anything else happens, and not echoed.
      const forbidden = run(
        ["--email", "boss@example.com", "--password", "leaky-pass-word-1", "--yes"],
        undefined,
      );
      expect(forbidden.status).toBe(1);
      expect(forbidden.stdout + forbidden.stderr).not.toContain("leaky-pass-word-1");

      // A too short password from the environment is rejected.
      const weak = run(["--email", "boss@example.com", "--yes"], undefined, {
        ADMIN_NEW_PASSWORD: "tiny",
      });
      expect(weak.status).toBe(1);
      expect(weak.stdout + weak.stderr).not.toContain("tiny");

      return login("boss@example.com", pw).then((r) => expect(r.ok).toBe(true));
    });
  },
);
