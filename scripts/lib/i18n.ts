import { IntlMessageFormat } from "intl-messageformat";

export type MessageTree = { [key: string]: string | MessageTree };

/** All UI locales (D21). German is the source; the others are translations of it. */
export const MESSAGE_LOCALES = ["de", "en", "sr-Latn", "cs", "zh-Hans"] as const;
export type MessageLocale = (typeof MESSAGE_LOCALES)[number];

/** Full catalogs: the office (admin) screens exist in these languages only. */
export const FULL_LOCALES = ["de", "en", "zh-Hans"] as const satisfies readonly MessageLocale[];
/** Driver-only languages: they carry the driver-facing namespaces and nothing else. */
export const DRIVER_ONLY_LOCALES = ["sr-Latn", "cs"] as const satisfies readonly MessageLocale[];

/**
 * Top-level namespaces a driver can see (everything except `admin`). `maps` and `errorPages` are
 * shared with the office but also shown to drivers, so the driver-only languages need them.
 */
export const DRIVER_NAMESPACES = [
  "common",
  "home",
  "auth",
  "driver",
  "pwa",
  "errorPages",
  "maps",
] as const;

/** CLDR plural categories a whole-number plural message needs per language (checked when it has a plural). */
export const REQUIRED_PLURAL_CATEGORIES: Partial<Record<MessageLocale, readonly string[]>> = {
  cs: ["one", "few", "many", "other"],
  "sr-Latn": ["one", "few", "other"],
};

function isTree(value: unknown): value is MessageTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flattens a nested message tree to dot-separated keys. */
export function flatten(tree: MessageTree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isTree(value)) Object.assign(out, flatten(value, path));
    else out[path] = value;
  }
  return out;
}

export const isDriverKey = (key: string): boolean =>
  (DRIVER_NAMESPACES as readonly string[]).includes(key.split(".")[0]!);

/** Keys a locale must have: everything for the full catalogs, the driver namespaces otherwise. */
export function expectedKeys(locale: MessageLocale, germanKeys: readonly string[]): string[] {
  return (DRIVER_ONLY_LOCALES as readonly string[]).includes(locale)
    ? germanKeys.filter(isDriverKey)
    : [...germanKeys];
}

type IcuNode = {
  type: number;
  value?: string;
  children?: IcuNode[];
  options?: Record<string, { value: IcuNode[] }>;
};

function parse(message: string, locale: string): IcuNode[] {
  return new IntlMessageFormat(message, locale).getAst() as unknown as IcuNode[];
}

/** Names of all arguments / tags used in an ICU message (throws on invalid syntax). */
export function placeholderNames(message: string, locale: string): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: IcuNode[]) => {
    for (const node of nodes) {
      // 1 argument, 2 number, 3 date, 4 time, 5 select, 6 plural, 8 tag
      if ([1, 2, 3, 4, 5, 6, 8].includes(node.type) && node.value) out.add(node.value);
      if (node.children) walk(node.children);
      if (node.options) for (const option of Object.values(node.options)) walk(option.value);
    }
  };
  walk(parse(message, locale));
  return out;
}

/** Categories used by the first-level `plural` arguments of a message (`=0` style literals ignored). */
function pluralCategorySets(message: string, locale: string): Set<string>[] {
  const sets: Set<string>[] = [];
  const walk = (nodes: IcuNode[]) => {
    for (const node of nodes) {
      if (node.type === 6 && node.options) {
        sets.push(new Set(Object.keys(node.options).filter((k) => !k.startsWith("="))));
      }
      if (node.children) walk(node.children);
      if (node.options) for (const option of Object.values(node.options)) walk(option.value);
    }
  };
  walk(parse(message, locale));
  return sets;
}

export type CheckInput = Record<MessageLocale, MessageTree>;

/** Returns a list of human-readable problems; empty means everything is consistent. */
export function checkMessages(input: CheckInput): string[] {
  const errors: string[] = [];
  const flat = Object.fromEntries(MESSAGE_LOCALES.map((l) => [l, flatten(input[l])])) as Record<
    MessageLocale,
    Record<string, string>
  >;
  // Keys of the full catalogs must agree with each other (de is the reference).
  const germanKeys = [...new Set(FULL_LOCALES.flatMap((l) => Object.keys(flat[l])))].sort();

  for (const locale of MESSAGE_LOCALES) {
    const wanted = new Set(expectedKeys(locale, germanKeys));
    const messages = flat[locale];
    for (const key of wanted) {
      const value = messages[key];
      if (value === undefined) errors.push(`${locale}: missing key "${key}"`);
      else if (value.trim() === "") errors.push(`${locale}: empty value for "${key}"`);
    }
    for (const key of Object.keys(messages)) {
      if (!wanted.has(key)) {
        errors.push(
          `${locale}: key "${key}" does not belong in this file (driver-only languages carry the driver namespaces only)`,
        );
      }
    }
    for (const [key, value] of Object.entries(messages)) {
      if (value.trim() === "") continue;
      try {
        const names = placeholderNames(value, locale);
        const reference = flat.de[key];
        if (reference !== undefined && locale !== "de") {
          const expected = placeholderNames(reference, "de");
          const missing = [...expected].filter((n) => !names.has(n));
          const extra = [...names].filter((n) => !expected.has(n));
          if (missing.length > 0 || extra.length > 0) {
            errors.push(
              `${locale}: placeholders of "${key}" differ from German (missing: ${missing.join(", ") || "-"}; unexpected: ${extra.join(", ") || "-"})`,
            );
          }
        }
        const required = REQUIRED_PLURAL_CATEGORIES[locale];
        if (required) {
          for (const used of pluralCategorySets(value, locale)) {
            const lacking = required.filter((c) => !used.has(c));
            if (lacking.length > 0) {
              errors.push(`${locale}: plural in "${key}" lacks ${lacking.join(", ")}`);
            }
          }
        }
      } catch (error) {
        errors.push(`${locale}: invalid ICU message "${key}": ${(error as Error).message}`);
      }
    }
  }
  return errors;
}
