-- NUD-137: quantities are whole numbers (D23).
--
-- 1. OrderItem.quantity Decimal(10,2) -> Integer. Existing values are rounded (half away from
--    zero) and never drop below 1; every row that was not a whole number is reported as a NOTICE
--    so the migration output shows what changed.
DO $$
DECLARE
  r RECORD;
  n INTEGER := 0;
BEGIN
  FOR r IN SELECT "id", "orderId", "productId", "quantity" FROM "OrderItem" WHERE "quantity" <> trunc("quantity") LOOP
    n := n + 1;
    RAISE NOTICE 'NUD-137: OrderItem % (order %, product %) had quantity %, rounded to %',
      r."id", r."orderId", r."productId", r."quantity", GREATEST(1, round(r."quantity"))::integer;
  END LOOP;
  RAISE NOTICE 'NUD-137: % OrderItem row(s) were not whole numbers', n;
END $$;

ALTER TABLE "OrderItem"
  ALTER COLUMN "quantity" TYPE INTEGER USING GREATEST(1, round("quantity"))::integer;

-- 2. JSON snapshots of quantities (Stop.items, Stop.previousItems, Tour.lastChange) stored
--    hundredths under `quantityCents` / `beforeCents` / `afterCents`. Rewrite them to whole
--    numbers under `quantity` / `before` / `after`. The audit log is append-only and keeps its
--    hundredths (the app converts on write and read).
CREATE FUNCTION pg_temp.nud137_units(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  result jsonb;
  k text;
  v jsonb;
BEGIN
  IF jsonb_typeof(j) = 'array' THEN
    SELECT COALESCE(jsonb_agg(pg_temp.nud137_units(e)), '[]'::jsonb) INTO result FROM jsonb_array_elements(j) AS e;
    RETURN result;
  ELSIF jsonb_typeof(j) = 'object' THEN
    result := '{}'::jsonb;
    FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
      IF k = 'quantityCents' THEN
        result := result || jsonb_build_object('quantity', to_jsonb(round((v #>> '{}')::numeric / 100)::integer));
      ELSIF k = 'previousQuantityCents' THEN
        result := result || jsonb_build_object('previousQuantity', CASE WHEN jsonb_typeof(v) = 'null' THEN 'null'::jsonb ELSE to_jsonb(round((v #>> '{}')::numeric / 100)::integer) END);
      ELSIF k = 'beforeCents' THEN
        result := result || jsonb_build_object('before', to_jsonb(round((v #>> '{}')::numeric / 100)::integer));
      ELSIF k = 'afterCents' THEN
        result := result || jsonb_build_object('after', to_jsonb(round((v #>> '{}')::numeric / 100)::integer));
      ELSE
        result := result || jsonb_build_object(k, pg_temp.nud137_units(v));
      END IF;
    END LOOP;
    RETURN result;
  END IF;
  RETURN j;
END
$fn$;

UPDATE "Stop" SET "items" = pg_temp.nud137_units("items"::jsonb) WHERE "items"::text LIKE '%Cents%';
UPDATE "Stop" SET "previousItems" = pg_temp.nud137_units("previousItems"::jsonb) WHERE "previousItems"::text LIKE '%Cents%';
UPDATE "Tour" SET "lastChange" = pg_temp.nud137_units("lastChange"::jsonb) WHERE "lastChange"::text LIKE '%Cents%';
