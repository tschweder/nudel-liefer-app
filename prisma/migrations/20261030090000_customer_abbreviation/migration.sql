-- Customer Abkürzung (NUD-164, D27): legacy internal code of the old system, free text, optional, NOT unique.
-- Temporary: dropped once the new system is adopted. Nothing is migrated or deleted. Audited as "customer.abbreviation".
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "abbreviation" TEXT,
ADD COLUMN "abbreviationUpdatedById" TEXT,
ADD COLUMN "abbreviationUpdatedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_abbreviationUpdatedById_fkey" FOREIGN KEY ("abbreviationUpdatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A driver's entry reuses the StopMutation table for idempotency by clientMutationId.
-- AlterEnum
ALTER TYPE "StopMutationKind" ADD VALUE 'ABBREVIATION';
