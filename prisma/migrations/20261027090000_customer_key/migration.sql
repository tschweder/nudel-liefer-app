-- Customer key (NUD-142, D27): whether the factory holds a key to the shop and its number.
-- "hasKey" NULL means unknown. Nothing is migrated or deleted. Changes are audited as "customer.key".
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "hasKey" BOOLEAN,
ADD COLUMN "keyNumber" TEXT,
ADD COLUMN "keyUpdatedById" TEXT,
ADD COLUMN "keyUpdatedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_keyUpdatedById_fkey" FOREIGN KEY ("keyUpdatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A driver's key entry reuses the StopMutation table for idempotency by clientMutationId.
-- AlterEnum
ALTER TYPE "StopMutationKind" ADD VALUE 'KEY';
