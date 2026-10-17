// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./test-db";
import { createTourService } from "./tour-service";

const DAY = new Date("2099-07-01T00:00:00Z");
const OTHER_DAY = new Date("2099-07-02T00:00:00Z");

describe.skipIf(!process.env.DATABASE_URL)("tourService.markOutdatedForDate", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  }, 60_000);
  afterAll(async () => {
    await t?.teardown();
  });
  beforeEach(async () => {
    await t.prisma.tour.deleteMany();
  });

  const tour = (date: Date, status: "DRAFT" | "RELEASED" | "COMPLETED" = "DRAFT") =>
    t.prisma.tour.create({ data: { date, status, depotSnapshot: {} } }).then((x) => x.id);
  const outdated = async (id: string) =>
    (await t.prisma.tour.findUniqueOrThrow({ where: { id } })).isOutdated;

  it("flags every open tour of that date and no other date", async () => {
    const a = await tour(DAY);
    const b = await tour(DAY, "RELEASED");
    const other = await tour(OTHER_DAY);
    const service = createTourService(t.prisma);
    expect(await service.markOutdatedForDate(DAY)).toBe(2);
    expect(await outdated(a)).toBe(true);
    expect(await outdated(b)).toBe(true);
    expect(await outdated(other)).toBe(false);
  });

  it("leaves completed tours alone and does nothing when there is no tour", async () => {
    const done = await tour(DAY, "COMPLETED");
    const service = createTourService(t.prisma);
    expect(await service.markOutdatedForDate(DAY)).toBe(0);
    expect(await outdated(done)).toBe(false);
    expect(await service.markOutdatedForDate(OTHER_DAY)).toBe(0);
  });

  it("is idempotent", async () => {
    await tour(DAY);
    const service = createTourService(t.prisma);
    expect(await service.markOutdatedForDate(DAY)).toBe(1);
    expect(await service.markOutdatedForDate(DAY)).toBe(0);
  });
});
