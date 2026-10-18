-- NUD-083: idempotency key of a photo captured by a driver (offline queue retries).
ALTER TABLE "Photo" ADD COLUMN "clientMutationId" TEXT;
CREATE UNIQUE INDEX "Photo_clientMutationId_key" ON "Photo"("clientMutationId");
