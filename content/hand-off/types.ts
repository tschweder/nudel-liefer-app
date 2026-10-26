/**
 * Data model of the bilingual hand-off help page (docs/handoff-vserver-deploy-and-help.md §8.2).
 *
 * Content rule for `label` and `result`:
 * These two fields hold EXACT German UI strings, copied verbatim from `messages/de.json`.
 * They are never translated — a Chinese-speaking driver has to recognise the very same words on
 * the screen, and `content/hand-off/index.test.ts` fails the build if one of them is invented.
 * All prose (`text`, `title`, `summary`, `path`, `after`) exists in German and Simplified Chinese.
 */

export type HandOffLocale = "de" | "zh";
export type HandOffText = { de: string; zh: string };

/** The five sections of the help page; also the grouping used by the navigation. */
export type HandOffArea = "buero" | "fahrer" | "konto" | "system" | "glossar";

export type HandOffStep = {
  /** What the user does, in both languages. */
  text: HandOffText;
  /** Exact UI label the step clicks/taps, e.g. "Neues Produkt" — shown verbatim, never translated. */
  label?: string;
  /** Optional result/toast text, e.g. "Produkt angelegt." */
  result?: string;
};

export type HandOffTopic = {
  /** kebab-case, stable, used as the URL fragment (#produkt-anlegen). */
  id: string;
  area: HandOffArea;
  title: HandOffText;
  /** One line under the title in the result list. */
  summary: HandOffText;
  /** Click path, e.g. "Seitenleiste → Stammdaten → Produkte → «Neues Produkt»". */
  path: HandOffText;
  /** Extra searchable terms, per language. Include the user's wrong word here. */
  search: { de: string[]; zh: string[] };
  steps: HandOffStep[];
  /** "Das passiert danach" — one sentence. */
  after?: HandOffText;
  /** App route this topic is about, e.g. "/de/admin/products/new" (for maintainers, shown small). */
  route?: string;
};

export type HandOffContent = { topics: HandOffTopic[]; glossary: { de: string; zh: string }[] };
