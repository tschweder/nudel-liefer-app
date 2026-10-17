-- Accent-insensitive customer search (NUD-013).
-- Works on plain PostgreSQL (Neon, embedded): no extension (unaccent / pg_trgm) needed.
-- `nudel_fold(text)` lower-cases and strips Latin diacritics; `Customer.searchText` holds the
-- folded searchable fields and is kept up to date by a trigger, so every writer (app, seed,
-- import) gets it for free. Queries fold the search term with the same SQL function.

CREATE FUNCTION "nudel_fold"(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT replace(replace(replace(
    translate(lower(input), 'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľłñńņňòóôõöøōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżž', 'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijkllllnnnnooooooooorrrsssstttuuuuuuuuuuwyyyzzz'),
    'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe')
$$;

ALTER TABLE "Customer" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

CREATE FUNCTION "customer_search_text_trigger"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := "nudel_fold"(concat_ws(' ',
    NEW."customerNumber", NEW."name", NEW."street", NEW."postalCode", NEW."city"));
  RETURN NEW;
END
$$;

CREATE TRIGGER "Customer_search_text"
BEFORE INSERT OR UPDATE ON "Customer"
FOR EACH ROW EXECUTE FUNCTION "customer_search_text_trigger"();

UPDATE "Customer" SET "id" = "id";
