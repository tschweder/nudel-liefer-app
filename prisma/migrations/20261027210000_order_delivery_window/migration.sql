-- NUD-148: requested delivery window; "deliveryDate" stays the PLANNED day.
ALTER TABLE "Order" ADD COLUMN "windowFrom" DATE;
ALTER TABLE "Order" ADD COLUMN "windowTo" DATE;
ALTER TABLE "Order" ADD COLUMN "windowFromTime" TEXT;
ALTER TABLE "Order" ADD COLUMN "windowToTime" TEXT;

-- Existing orders: the whole planned day is the window.
UPDATE "Order" SET "windowFrom" = "deliveryDate", "windowTo" = "deliveryDate";

ALTER TABLE "Order" ALTER COLUMN "windowFrom" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "windowTo" SET NOT NULL;

ALTER TABLE "Order" ADD CONSTRAINT "Order_window_order_check" CHECK ("windowFrom" <= "windowTo");
ALTER TABLE "Order" ADD CONSTRAINT "Order_window_time_check" CHECK (
  ("windowFromTime" IS NULL OR "windowFromTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  AND ("windowToTime" IS NULL OR "windowToTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

CREATE INDEX "Order_windowFrom_windowTo_idx" ON "Order"("windowFrom", "windowTo");
