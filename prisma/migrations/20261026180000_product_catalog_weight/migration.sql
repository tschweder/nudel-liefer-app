-- NUD-138: the catalog holds the owner's three real products, each with a weight per unit.
--
-- 1. Product.weightKgPerUnit Decimal(6,2), required and > 0. Existing rows get the weight of their
--    unit (Beutel 3 kg, Karton 10 kg, piece 5 kg, anything else 1 kg); admins can edit it later.
ALTER TABLE "Product" ADD COLUMN "weightKgPerUnit" DECIMAL(6,2);
UPDATE "Product" SET "weightKgPerUnit" = CASE "unit"
  WHEN 'PACK' THEN 3
  WHEN 'CRATE' THEN 10
  WHEN 'PIECE' THEN 5
  ELSE 1
END;
ALTER TABLE "Product" ALTER COLUMN "weightKgPerUnit" SET NOT NULL;
ALTER TABLE "Product" ADD CONSTRAINT "Product_weightKgPerUnit_positive" CHECK ("weightKgPerUnit" > 0);

-- 2. The three products (idempotent: the seed creates the same SKUs with `upsert`).
INSERT INTO "Product" ("id", "sku", "name", "unit", "weightKgPerUnit", "active", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, v.sku,
  jsonb_build_object(
    'de', v.de, 'zh-Hans', v.hans, 'zh-Hant-HK', v.hant, 'zh-Hant-TW', v.hant,
    'meta', jsonb_build_object(
      'source', 'de',
      'machine', jsonb_build_object('zh-Hant-HK', true, 'zh-Hant-TW', true),
      'updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  v.unit::"Unit", v.weight, true, v.sort, now()
FROM (VALUES
  ('NUDELN-BEUTEL', 'Nudeln', '面条', '麵條', 'PACK', 3::numeric, 0),
  ('NUDELN-KARTON', 'Nudeln', '面条', '麵條', 'CRATE', 10::numeric, 1),
  ('WANTAN-TEIG', 'Wantan-Teig', '馄饨皮', '餛飩皮', 'PIECE', 5::numeric, 2)
) AS v(sku, de, hans, hant, unit, weight, sort)
ON CONFLICT ("sku") DO NOTHING;

-- 3. Existing demo order lines move onto the matching new product (orders are never deleted).
--    Only the eight demo SKUs are touched; kilogram demo lines (Ravioli) become Beutel.
--    If an order then holds the same product twice, the lines are merged into one.
CREATE TEMP TABLE nud138_map AS
SELECT p."id" AS old_id,
  (SELECT n."id" FROM "Product" n WHERE n."sku" = CASE
     WHEN p."unit" = 'CRATE' THEN 'NUDELN-KARTON'
     WHEN p."unit" = 'PIECE' THEN 'WANTAN-TEIG'
     ELSE 'NUDELN-BEUTEL' END) AS new_id
FROM "Product" p
WHERE p."sku" IN ('SPAG-5','PENN-5','TAGL-3','FUSI-5','LASA-2','RAVI-KG','RIGA-5','GNOC-2');

UPDATE "OrderItem" i SET "productId" = m.new_id FROM nud138_map m WHERE i."productId" = m.old_id;

WITH sums AS (
  SELECT "orderId", "productId", min("id") AS keep_id, sum("quantity")::integer AS total, count(*) AS n
  FROM "OrderItem" GROUP BY "orderId", "productId" HAVING count(*) > 1
), upd AS (
  UPDATE "OrderItem" i SET "quantity" = LEAST(s.total, 99999) FROM sums s WHERE i."id" = s.keep_id RETURNING i."id"
)
DELETE FROM "OrderItem" i USING sums s
WHERE i."orderId" = s."orderId" AND i."productId" = s."productId" AND i."id" <> s.keep_id;

-- 4. Every other product is archived (soft delete, rows stay for old orders and stop snapshots).
UPDATE "Product" SET "active" = false
WHERE "sku" NOT IN ('NUDELN-BEUTEL', 'NUDELN-KARTON', 'WANTAN-TEIG');

-- Keep the three products at the top of the admin list.
UPDATE "Product" SET "sortOrder" = CASE "sku"
  WHEN 'NUDELN-BEUTEL' THEN 0 WHEN 'NUDELN-KARTON' THEN 1 WHEN 'WANTAN-TEIG' THEN 2 END
WHERE "sku" IN ('NUDELN-BEUTEL', 'NUDELN-KARTON', 'WANTAN-TEIG');
UPDATE "Product" SET "sortOrder" = "sortOrder" + 10
WHERE "sku" NOT IN ('NUDELN-BEUTEL', 'NUDELN-KARTON', 'WANTAN-TEIG');
