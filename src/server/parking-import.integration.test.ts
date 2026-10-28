// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isCustomerPhotoKey } from "@/lib/uploads";

import { hashSecret } from "./auth/password";
import { type ImportEntry, importParkingSpots, storageKeyFor } from "./parking-import";
import { FakeStorage } from "./storage/fake";
import { createTestDb, type TestDb } from "./test-db";

/**
 * The parking import writes to production, so its rules are pinned down here: a dry run must
 * touch nothing, an apply must create exactly one spot and one photo per customer, a second run
 * must be a no-op, and an existing spot or an existing photo must never be overwritten.
 */
describe.skipIf(!process.env.DATABASE_URL)("parking import", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let storage: FakeStorage;
  let n = 0;

  const mkCustomer = async (street = "TeststraÃŸe 1", postalCode = "1010") =>
    (
      await t.prisma.customer.create({
        data: {
          customerNumber: `PI-${++n}`,
          name: `Kunde ${n}`,
          street,
          postalCode,
          city: "Wien",
          lat: 48.2082,
          lng: 16.3738,
        },
      })
    ).id;

  const entry = (unitId: string, customerIds: string[], window = 0): ImportEntry => ({
    unitId,
    action: "create",
    spot: { lat: 48.2082 + window, lng: 16.3738 + window },
    customerIds,
  });

  /** Stands in for the presigned-PUT upload the CLI performs against the real bucket. */
  const uploadToFake: Parameters<typeof importParkingSpots>[2]["uploadPhoto"] = async ({
    key,
    bytes,
    contentType,
  }) => {
    storage.put(key, new Uint8Array(bytes), contentType);
  };

  const run = (
    entries: ImportEntry[],
    options: {
      apply: boolean;
      photos?: Map<string, { file: string; width: number; height: number; sha256: string }>;
      ledger?: Parameters<typeof importParkingSpots>[2]["ledger"];
    },
  ) =>
    importParkingSpots(t.prisma, storage, {
      actorId: adminId,
      entries,
      photos: options.photos ?? new Map(),
      readPhoto: async () => Buffer.from("fake-jpeg-bytes"),
      uploadPhoto: uploadToFake,
      ledger: options.ledger,
      label: "Imported 2026-10",
      apply: options.apply,
    });

  const photoFor = (unitId: string) => ({
    file: `upload/${unitId}.jpg`,
    width: 1600,
    height: 1200,
    sha256: "0".repeat(64),
  });

  const auditFor = (customerId: string) =>
    t.prisma.auditLog.findMany({
      where: { entity: "Customer", entityId: customerId },
      orderBy: { createdAt: "asc" },
    });

  beforeAll(async () => {
    t = await createTestDb();
    adminId = (
      await t.prisma.user.create({
        data: {
          role: "ADMIN",
          email: "importer@example.com",
          passwordHash: await hashSecret("123456"),
          displayName: "Importer",
        },
      })
    ).id;
    storage = new FakeStorage();
  }, 60_000);

  afterAll(async () => {
    await t?.teardown();
  });

  it("derives a storage key the photo contract accepts", () => {
    const key = storageKeyFor("u07", "cmvph28dz0035o6jxlau7c682");
    expect(isCustomerPhotoKey(key)).toBe(true);
    // Deterministic: a retry reuses the object instead of orphaning a new one.
    expect(storageKeyFor("u07", "cmvph28dz0035o6jxlau7c682")).toBe(key);
    expect(storageKeyFor("u08", "cmvph28dz0035o6jxlau7c682")).not.toBe(key);
  });

  it("writes nothing on a dry run", async () => {
    const customerId = await mkCustomer();
    const summary = await run([entry("u-dry", [customerId])], {
      apply: false,
      photos: new Map([["u-dry", photoFor("u-dry")]]),
    });

    expect(summary.apply).toBe(false);
    expect(summary.rows[0]!.spotOutcome).toBe("spot_created");
    expect(summary.rows[0]!.photoOutcome).toBe("photo_added");
    expect(await t.prisma.parkingSpot.count({ where: { customerId } })).toBe(0);
    expect(await t.prisma.photo.count({ where: { customerId } })).toBe(0);
    expect(await auditFor(customerId)).toHaveLength(0);
    expect(summary.ledger).toHaveLength(0);
  });

  it("creates one spot and one photo per customer and audits both", async () => {
    const customerId = await mkCustomer();
    const summary = await run([entry("u01", [customerId])], {
      apply: true,
      photos: new Map([["u01", photoFor("u01")]]),
    });

    expect(summary.failures).toBe(0);
    expect(summary.spotsCreated).toBe(1);
    expect(summary.photosAdded).toBe(1);

    const spots = await t.prisma.parkingSpot.findMany({ where: { customerId } });
    expect(spots).toHaveLength(1);
    expect(spots[0]!.lat).toBeCloseTo(48.2082, 5);
    expect(spots[0]!.label).toBe("Imported 2026-10");

    const photos = await t.prisma.photo.findMany({ where: { customerId } });
    expect(photos).toHaveLength(1);
    expect(photos[0]!.kind).toBe("PARKING");
    expect(photos[0]!.isCurrent).toBe(true);
    expect(photos[0]!.width).toBe(1600);
    expect(isCustomerPhotoKey(photos[0]!.storageKey)).toBe(true);
    expect(storage.has(photos[0]!.storageKey)).toBe(true);

    const actions = (await auditFor(customerId)).map((row) => row.action);
    expect(actions).toEqual(["parking.create", "photo.add"]);

    const ledger = summary.ledger[0]!;
    expect(ledger.spotId).toBe(spots[0]!.id);
    expect(ledger.photoId).toBe(photos[0]!.id);
  });

  it("is idempotent: a second apply with the ledger changes nothing", async () => {
    const customerId = await mkCustomer();
    const first = await run([entry("u02", [customerId])], {
      apply: true,
      photos: new Map([["u02", photoFor("u02")]]),
    });
    const auditsAfterFirst = await auditFor(customerId);

    const second = await run([entry("u02", [customerId])], {
      apply: true,
      photos: new Map([["u02", photoFor("u02")]]),
      ledger: first.ledger,
    });

    expect(second.spotsCreated).toBe(0);
    expect(second.spotsExisting).toBe(1);
    expect(second.photosAdded).toBe(0);
    expect(second.photosKept).toBe(1);
    expect(second.rows[0]!.photoOutcome).toBe("photo_already_ours");
    expect(await t.prisma.parkingSpot.count({ where: { customerId } })).toBe(1);
    expect(await t.prisma.photo.count({ where: { customerId } })).toBe(1);
    expect(await auditFor(customerId)).toHaveLength(auditsAfterFirst.length);
  });

  it("leaves an existing spot within 5 m alone but still adds a missing photo", async () => {
    const customerId = await mkCustomer();
    await t.prisma.parkingSpot.create({
      data: {
        customerId,
        lat: 48.20821,
        lng: 16.37381,
        createdById: adminId,
        label: "vom BÃ¼ro",
      },
    });

    const summary = await run([entry("u03", [customerId])], {
      apply: true,
      photos: new Map([["u03", photoFor("u03")]]),
    });

    expect(summary.rows[0]!.spotOutcome).toBe("spot_exists");
    expect(summary.rows[0]!.photoOutcome).toBe("photo_added");
    const spots = await t.prisma.parkingSpot.findMany({ where: { customerId } });
    expect(spots).toHaveLength(1);
    expect(spots[0]!.label).toBe("vom BÃ¼ro");
    expect(await t.prisma.photo.count({ where: { customerId } })).toBe(1);
  });

  it("creates a second spot when the existing one is further than 5 m away", async () => {
    const customerId = await mkCustomer();
    await t.prisma.parkingSpot.create({
      data: { customerId, lat: 48.21, lng: 16.38, createdById: adminId },
    });
    const summary = await run([entry("u04", [customerId])], { apply: true });
    expect(summary.rows[0]!.spotOutcome).toBe("spot_created");
    expect(await t.prisma.parkingSpot.count({ where: { customerId } })).toBe(2);
  });

  it("never replaces a current PARKING photo it did not store", async () => {
    const customerId = await mkCustomer();
    const existingKey = "customers/11111111-1111-1111-1111-111111111111.jpg";
    storage.put(existingKey, new Uint8Array([1, 2, 3]), "image/jpeg");
    await t.prisma.photo.create({
      data: {
        customerId,
        kind: "PARKING",
        storageKey: existingKey,
        width: 800,
        height: 600,
        bytes: 3,
        uploadedById: adminId,
        isCurrent: true,
      },
    });

    const summary = await run([entry("u05", [customerId])], {
      apply: true,
      photos: new Map([["u05", photoFor("u05")]]),
    });

    expect(summary.rows[0]!.photoOutcome).toBe("photo_exists");
    const photos = await t.prisma.photo.findMany({ where: { customerId } });
    expect(photos).toHaveLength(1);
    expect(photos[0]!.storageKey).toBe(existingKey);
    expect((await auditFor(customerId)).some((row) => row.action === "photo.replace")).toBe(false);
  });

  it("gives every customer of one address group the same pin", async () => {
    const a = await mkCustomer("Geteilte Gasse 5", "1100");
    const b = await mkCustomer("Geteilte Gasse 5", "1100");
    const summary = await run([entry("u06", [a, b])], {
      apply: true,
      photos: new Map([["u06", photoFor("u06")]]),
    });

    expect(summary.rows).toHaveLength(2);
    expect(summary.spotsCreated).toBe(2);
    expect(summary.photosAdded).toBe(2);
    const spots = await t.prisma.parkingSpot.findMany({ where: { customerId: { in: [a, b] } } });
    expect(spots).toHaveLength(2);
    // One object per customer: `storageKey` is unique across photos.
    const photos = await t.prisma.photo.findMany({ where: { customerId: { in: [a, b] } } });
    expect(new Set(photos.map((p) => p.storageKey)).size).toBe(2);
  });

  it("reports an unknown customer instead of failing the whole run", async () => {
    const customerId = await mkCustomer();
    const summary = await run([entry("u07", ["does-not-exist", customerId])], { apply: true });
    expect(summary.rows[0]!.spotOutcome).toBe("customer_missing");
    expect(summary.rows[1]!.spotOutcome).toBe("spot_created");
    expect(summary.failures).toBe(1);
  });

  it("imports nothing for pins that still need a human or already exist", async () => {
    const customerId = await mkCustomer();
    const summary = await run(
      [
        {
          unitId: "u08",
          action: "review",
          spot: { lat: 48.1, lng: 16.1 },
          customerIds: [customerId],
        },
        {
          unitId: "u09",
          action: "exists",
          spot: { lat: 48.1, lng: 16.1 },
          customerIds: [customerId],
        },
      ],
      { apply: true },
    );
    expect(summary.entriesSkipped).toBe(2);
    expect(summary.rows).toHaveLength(0);
    expect(await t.prisma.parkingSpot.count({ where: { customerId } })).toBe(0);
  });
});
