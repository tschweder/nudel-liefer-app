-- Optional departure checklist (NUD-151): the driver's loading start and departure times per tour
-- and the fixed checklist items the office maintains in the settings. Nothing is migrated or deleted.

-- AlterTable
ALTER TABLE "Tour" ADD COLUMN "loadingStartedAt" TIMESTAMP(3),
ADD COLUMN "departedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "departureChecklist" JSONB NOT NULL DEFAULT '[]';

-- The driver's two new queued actions reuse StopMutation for idempotency by clientMutationId.
-- AlterEnum
ALTER TYPE "StopMutationKind" ADD VALUE 'LOADING';
ALTER TYPE "StopMutationKind" ADD VALUE 'DEPART';
