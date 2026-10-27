-- NUD-149: recurring orders (Dauerbestellungen, D25).
ALTER TABLE "Settings" ADD COLUMN "recurringLeadDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_recurringLeadDays_check" CHECK ("recurringLeadDays" BETWEEN 1 AND 60);

CREATE TABLE "RecurringOrder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "everyNWeeks" INTEGER NOT NULL DEFAULT 1,
    "anchorDate" DATE NOT NULL,
    "seasonFrom" TEXT,
    "seasonTo" TEXT,
    "exceptions" DATE[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pausedByCustomer" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecurringOrder_every_check" CHECK ("everyNWeeks" BETWEEN 1 AND 52),
    CONSTRAINT "RecurringOrder_weekdays_check" CHECK (cardinality("weekdays") >= 1 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7]),
    CONSTRAINT "RecurringOrder_season_check" CHECK (
      ("seasonFrom" IS NULL AND "seasonTo" IS NULL)
      OR ("seasonFrom" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND "seasonTo" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
    )
);

CREATE TABLE "RecurringOrderItem" (
    "id" TEXT NOT NULL,
    "recurringOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "RecurringOrderItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecurringOrderItem_quantity_check" CHECK ("quantity" >= 1)
);

ALTER TABLE "Order" ADD COLUMN "recurringOrderId" TEXT;
ALTER TABLE "Order" ADD COLUMN "recurringDate" DATE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_recurring_pair_check" CHECK (("recurringOrderId" IS NULL) = ("recurringDate" IS NULL));

CREATE INDEX "RecurringOrder_customerId_active_idx" ON "RecurringOrder"("customerId", "active");
CREATE INDEX "RecurringOrderItem_recurringOrderId_idx" ON "RecurringOrderItem"("recurringOrderId");
CREATE INDEX "RecurringOrderItem_productId_idx" ON "RecurringOrderItem"("productId");
CREATE UNIQUE INDEX "Order_recurringOrderId_recurringDate_key" ON "Order"("recurringOrderId", "recurringDate");

ALTER TABLE "RecurringOrder" ADD CONSTRAINT "RecurringOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringOrder" ADD CONSTRAINT "RecurringOrder_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringOrderItem" ADD CONSTRAINT "RecurringOrderItem_recurringOrderId_fkey" FOREIGN KEY ("recurringOrderId") REFERENCES "RecurringOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringOrderItem" ADD CONSTRAINT "RecurringOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_recurringOrderId_fkey" FOREIGN KEY ("recurringOrderId") REFERENCES "RecurringOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
