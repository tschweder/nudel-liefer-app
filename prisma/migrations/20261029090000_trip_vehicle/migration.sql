-- Vehicle switch between trips (NUD-158): a driver who is back at the depot takes another, already
-- loaded vehicle instead of waiting for a reload. `Stop.vehicleId` is the vehicle of the stop's
-- trip when it differs from the tour's vehicle; NULL (every existing row) = the tour's vehicle.

-- AlterTable
ALTER TABLE "Stop" ADD COLUMN "vehicleId" TEXT;

-- CreateIndex
CREATE INDEX "Stop_vehicleId_idx" ON "Stop"("vehicleId");

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
