-- Driver working time and utilization (NUD-152, D28). Additive: nothing is migrated or deleted.
-- `WorkSchedule` holds the working days and hours of a driver (one row per ISO weekday, soft delete
-- via `active`); `Settings.defaultLoadingMinutes` is the loading time assumed when the driver skipped
-- the departure checklist. A driver without rows has no schedule at all (no shift-end warning).

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- A shift stays inside one calendar day: 1 (Monday) .. 7 (Sunday) and 00:00 <= start < end <= 23:59.
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7);
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_minutes_range" CHECK (
    "startMinutes" >= 0 AND "endMinutes" <= 1439 AND "startMinutes" < "endMinutes"
);

-- One row per driver and weekday; a weekday is switched off with `active = false`, never deleted.
-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_driverId_weekday_key" ON "WorkSchedule"("driverId", "weekday");

-- CreateIndex
CREATE INDEX "WorkSchedule_driverId_idx" ON "WorkSchedule"("driverId");

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "defaultLoadingMinutes" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_defaultLoadingMinutes_range" CHECK (
    "defaultLoadingMinutes" BETWEEN 0 AND 180
);
