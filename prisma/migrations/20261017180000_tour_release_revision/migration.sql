-- NUD-043: release revisions, change markers and the released quantities per stop
CREATE TYPE "StopChange" AS ENUM ('ADDED', 'CHANGED');

ALTER TABLE "Tour" ADD COLUMN "releaseRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tour" ADD COLUMN "reReleasedAt" TIMESTAMP(3);
ALTER TABLE "Tour" ADD COLUMN "lastChange" JSONB;

ALTER TABLE "Stop" ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Stop" ADD COLUMN "previousItems" JSONB;
ALTER TABLE "Stop" ADD COLUMN "changeKind" "StopChange";
ALTER TABLE "Stop" ADD COLUMN "changedInRevision" INTEGER;

-- Existing stops: snapshot the quantities of their linked orders as they are now.
UPDATE "Stop" s SET "items" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('productId', t."productId", 'quantityCents', t."cents") ORDER BY t."productId")
  FROM (
    SELECT oi."productId", ROUND(SUM(oi."quantity") * 100)::int AS "cents"
    FROM "StopOrder" so JOIN "OrderItem" oi ON oi."orderId" = so."orderId"
    WHERE so."stopId" = s."id"
    GROUP BY oi."productId"
  ) t
), '[]'::jsonb);

-- Tours that were already released count as revision 1.
UPDATE "Tour" SET "releaseRevision" = 1 WHERE "status" IN ('RELEASED', 'IN_PROGRESS', 'COMPLETED');
