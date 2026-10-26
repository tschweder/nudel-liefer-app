-- Customer master data from the factory's customer list (NUD-136): legal entity ("Firma"),
-- VAT id ("UID") and a billing address that is stored only when it differs from the delivery
-- address. All optional; the delivery address (street / postalCode / city) stays the one that is
-- geocoded, routed and shown to the driver.
ALTER TABLE "Customer" ADD COLUMN "companyName" TEXT;
ALTER TABLE "Customer" ADD COLUMN "vatId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingStreet" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingPostalCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingCity" TEXT;

-- The office searches by company name and VAT id too (NUD-013 search column).
CREATE OR REPLACE FUNCTION "customer_search_text_trigger"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := "nudel_fold"(concat_ws(' ',
    NEW."customerNumber", NEW."name", NEW."street", NEW."postalCode", NEW."city",
    NEW."companyName", NEW."vatId"));
  RETURN NEW;
END
$$;

UPDATE "Customer" SET "id" = "id";
