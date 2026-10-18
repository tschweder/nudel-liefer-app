import { type AppLocale, type LocalizedText, pick } from "./localized-text";

export type ProductLabel = {
  /** Name in the requested locale (with the usual fallbacks); the SKU when there is no name at all. */
  primary: string;
  /** The German name, only when the sheet is not German and the German text differs. */
  german: string | null;
};

/** Product name in `locale` plus its German name for a printout read by people who may not read it. */
export function productLabel(
  name: LocalizedText | null,
  sku: string,
  locale: AppLocale,
): ProductLabel {
  const primary = (name ? pick(name, locale) : "").trim() || sku;
  const german = name?.de?.trim() ?? "";
  return {
    primary,
    german: locale !== "de" && german !== "" && german !== primary ? german : null,
  };
}
