-- NUD-053: idempotency log of driver stop-status mutations
CREATE TYPE "StopMutationKind" AS ENUM ('COMPLETE', 'UNDO');

CREATE TABLE "StopMutation" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "kind" "StopMutationKind" NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StopMutation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StopMutation_stopId_idx" ON "StopMutation"("stopId");

ALTER TABLE "StopMutation" ADD CONSTRAINT "StopMutation_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
