-- Vehicles with a capacity in kg and one vehicle per tour (NUD-146, D24). Additive: nothing is
-- migrated or deleted; existing tours simply have no vehicle. Vehicles are never hard-deleted.
-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT,
    "capacityKg" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_capacityKg_positive" CHECK ("capacityKg" > 0);

-- AlterTable
ALTER TABLE "Tour" ADD COLUMN "vehicleId" TEXT;

-- CreateIndex
CREATE INDEX "Tour_vehicleId_idx" ON "Tour"("vehicleId");

-- AddForeignKey
ALTER TABLE "Tour" ADD CONSTRAINT "Tour_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
