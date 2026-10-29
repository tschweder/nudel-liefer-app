-- NUD-171: a recurring order may carry more than one weekly pattern, a delivery window time, an end
-- condition, one skipped range and a per-weekday product list. Purely additive.

-- 1. New columns on RecurringOrder.
ALTER TABLE "RecurringOrder"
  ADD COLUMN "skipFrom" DATE,
  ADD COLUMN "skipTo" DATE,
  ADD COLUMN "monthlyRules" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "windowFromTime" TEXT,
  ADD COLUMN "windowToTime" TEXT,
  ADD COLUMN "endsOn" DATE,
  ADD COLUMN "maxDeliveries" INTEGER;

-- 2. Constraints that keep the JSON and the nullable pairs honest (same spirit as the NUD-149 checks).
ALTER TABLE "RecurringOrder"
  ADD CONSTRAINT "RecurringOrder_skip_range_check"
    CHECK (("skipFrom" IS NULL) = ("skipTo" IS NULL)
           AND ("skipFrom" IS NULL OR "skipFrom" <= "skipTo")),
  ADD CONSTRAINT "RecurringOrder_window_check"
    CHECK (("windowFromTime" IS NULL) = ("windowToTime" IS NULL)
           AND ("windowFromTime" IS NULL OR "windowFromTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
           AND ("windowToTime" IS NULL OR "windowToTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')),
  ADD CONSTRAINT "RecurringOrder_ends_check"
    CHECK ("endsOn" IS NULL OR "endsOn" >= "anchorDate"),
  ADD CONSTRAINT "RecurringOrder_max_deliveries_check"
    CHECK ("maxDeliveries" IS NULL OR ("maxDeliveries" >= 1 AND "maxDeliveries" <= 1000)),
  ADD CONSTRAINT "RecurringOrder_monthly_rules_check"
    CHECK (jsonb_typeof("monthlyRules") = 'array' AND jsonb_array_length("monthlyRules") <= 10);

-- 3. Per-weekday product overrides.
CREATE TABLE "RecurringOrderDayItem" (
  "id"               TEXT         NOT NULL,
  "recurringOrderId" TEXT         NOT NULL,
  "weekday"          INTEGER      NOT NULL,
  "productId"        TEXT         NOT NULL,
  "quantity"         INTEGER      NOT NULL,

  CONSTRAINT "RecurringOrderDayItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecurringOrderDayItem_weekday_check" CHECK ("weekday" >= 1 AND "weekday" <= 7),
  CONSTRAINT "RecurringOrderDayItem_quantity_check" CHECK ("quantity" >= 1 AND "quantity" <= 99999)
);

CREATE UNIQUE INDEX "RecurringOrderDayItem_recurringOrderId_weekday_productId_key"
  ON "RecurringOrderDayItem"("recurringOrderId", "weekday", "productId");
CREATE INDEX "RecurringOrderDayItem_recurringOrderId_weekday_idx"
  ON "RecurringOrderDayItem"("recurringOrderId", "weekday");
CREATE INDEX "RecurringOrderDayItem_productId_idx" ON "RecurringOrderDayItem"("productId");

ALTER TABLE "RecurringOrderDayItem"
  ADD CONSTRAINT "RecurringOrderDayItem_recurringOrderId_fkey"
    FOREIGN KEY ("recurringOrderId") REFERENCES "RecurringOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RecurringOrderDayItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. A rule may now be monthly-only (NUD-171): NUD-149 required at least one weekday. The union of
-- the weekly and the monthly patterns must not be empty, so the constraint accepts an empty weekday
-- array as long as `monthlyRules` carries at least one entry (the app validates the same rule).
ALTER TABLE "RecurringOrder" DROP CONSTRAINT "RecurringOrder_weekdays_check";
ALTER TABLE "RecurringOrder"
  ADD CONSTRAINT "RecurringOrder_weekdays_check"
    CHECK ("weekdays" <@ ARRAY[1,2,3,4,5,6,7]
           AND (cardinality("weekdays") >= 1 OR jsonb_array_length("monthlyRules") > 0));
