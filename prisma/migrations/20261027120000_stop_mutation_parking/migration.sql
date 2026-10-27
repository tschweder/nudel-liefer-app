-- A driver's new Parkplatz (NUD-144, D27) reuses the StopMutation table for idempotency by
-- clientMutationId. Nothing is migrated or deleted.
-- AlterEnum
ALTER TYPE "StopMutationKind" ADD VALUE 'PARKING';
