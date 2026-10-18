/**
 * Server-only half of LocalizedText: everything that needs OpenCC (~1.2 MB of dictionaries).
 * NEVER import this (or `./opencc`) from a client component or from `localized-text.ts`: the
 * dictionaries would end up in a client chunk (NUD-098). ESLint (`no-restricted-imports`) and
 * `pnpm check:client-bundle` guard this. Client-safe parts live in `./localized-text`.
 */
import { type AppLocale, type LocalizedText } from "./localized-text";
import { hansToHk, hansToTw, hantToHans } from "./opencc";

const isEmpty = (value: string | undefined): boolean => value === undefined || value.trim() === "";

/**
 * Fills empty Traditional variants from Simplified via OpenCC (`cn->hk`, `cn->twp`). If
 * Simplified is empty but a Traditional variant exists, Simplified is derived first (`t->cn`).
 * Derived locales are flagged in `meta.machine`; existing values are never overwritten.
 */
export function withDerivedHant(text: LocalizedText, now: Date = new Date()): LocalizedText {
  const next: LocalizedText = {
    ...text,
    meta: { ...text.meta, machine: { ...text.meta.machine } },
  };
  const derived: AppLocale[] = [];

  if (isEmpty(next["zh-Hans"])) {
    const hant = [next["zh-Hant-HK"], next["zh-Hant-TW"]].find((v) => !isEmpty(v));
    if (hant !== undefined) {
      next["zh-Hans"] = hantToHans(hant);
      derived.push("zh-Hans");
    }
  }
  const hans = next["zh-Hans"];
  if (hans !== undefined && !isEmpty(hans)) {
    if (isEmpty(next["zh-Hant-HK"])) {
      next["zh-Hant-HK"] = hansToHk(hans);
      derived.push("zh-Hant-HK");
    }
    if (isEmpty(next["zh-Hant-TW"])) {
      next["zh-Hant-TW"] = hansToTw(hans);
      derived.push("zh-Hant-TW");
    }
  }
  if (derived.length === 0) return text;
  for (const locale of derived) next.meta.machine[locale] = true;
  next.meta.updatedAt = now.toISOString();
  return next;
}
