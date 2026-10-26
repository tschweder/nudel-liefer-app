-- NUD-140 (D21): languages are de, en, sr-Latn, cs, zh-Hans. Traditional Chinese is removed.
--
-- 1. Enum "Locale": new values en, sr-Latn, cs; zh-Hant-HK and zh-Hant-TW are gone. Users who had a
--    Traditional locale are moved to zh-Hans (their `localeChosen` flag stays as it was).
ALTER TYPE "Locale" RENAME TO "Locale_old";
CREATE TYPE "Locale" AS ENUM ('de', 'en', 'sr-Latn', 'cs', 'zh-Hans');
ALTER TABLE "User" ALTER COLUMN "locale" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "locale" TYPE "Locale" USING (
  CASE "locale"::text
    WHEN 'zh-Hant-HK' THEN 'zh-Hans'
    WHEN 'zh-Hant-TW' THEN 'zh-Hans'
    ELSE "locale"::text
  END
)::"Locale";
ALTER TABLE "User" ALTER COLUMN "locale" SET DEFAULT 'de';
DROP TYPE "Locale_old";

-- 2. LocalizedText JSON (Customer.notes, Product.name, Stop.problemNote): drop the Hant keys.
--    A text that only existed in a Traditional variant (e.g. written by a driver whose locale was
--    Traditional) keeps its words under zh-Hans; they are Chinese and the driver wrote them, so they
--    stay readable (they are not converted). `meta.source`, `meta.machine` and `meta.stale` lose their
--    Hant entries. Every text that now lacks a locale is flagged `pendingTranslation`, so the retry
--    job fills en, sr-Latn and cs without anybody re-saving the record.
CREATE FUNCTION pg_temp.nud140_text(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  result jsonb := j;
  hant text;
  src text;
  loc text;
  missing boolean := false;
BEGIN
  IF j IS NULL OR jsonb_typeof(j) <> 'object' THEN
    RETURN j;
  END IF;

  IF coalesce(btrim(result->>'zh-Hans'), '') = '' THEN
    src := result #>> '{meta,source}';
    hant := nullif(btrim(coalesce(
      CASE WHEN src = 'zh-Hant-HK' THEN result->>'zh-Hant-HK' END,
      CASE WHEN src = 'zh-Hant-TW' THEN result->>'zh-Hant-TW' END,
      result->>'zh-Hant-TW',
      result->>'zh-Hant-HK'
    )), '');
    IF hant IS NOT NULL THEN
      result := jsonb_set(result, '{zh-Hans}', to_jsonb(hant));
    END IF;
  END IF;

  result := result - 'zh-Hant-HK' - 'zh-Hant-TW';

  IF result #>> '{meta,source}' IN ('zh-Hant-HK', 'zh-Hant-TW') THEN
    result := jsonb_set(result, '{meta,source}', '"zh-Hans"');
  END IF;
  IF result #> '{meta,machine}' IS NOT NULL THEN
    result := jsonb_set(result, '{meta,machine}', (result #> '{meta,machine}') - 'zh-Hant-HK' - 'zh-Hant-TW');
  END IF;
  IF result #> '{meta,stale}' IS NOT NULL THEN
    result := jsonb_set(result, '{meta,stale}', (result #> '{meta,stale}') - 'zh-Hant-HK' - 'zh-Hant-TW');
  END IF;

  FOREACH loc IN ARRAY ARRAY['de', 'en', 'sr-Latn', 'cs', 'zh-Hans'] LOOP
    IF coalesce(btrim(result->>loc), '') = '' THEN
      missing := true;
    END IF;
  END LOOP;
  IF missing AND result ? 'meta' THEN
    result := jsonb_set(result, '{meta,pendingTranslation}', 'true');
  END IF;
  RETURN result;
END
$fn$;

UPDATE "Customer" SET "notes" = pg_temp.nud140_text("notes") WHERE "notes" IS NOT NULL;
UPDATE "Product" SET "name" = pg_temp.nud140_text("name");
UPDATE "Stop" SET "problemNote" = pg_temp.nud140_text("problemNote") WHERE "problemNote" IS NOT NULL;
