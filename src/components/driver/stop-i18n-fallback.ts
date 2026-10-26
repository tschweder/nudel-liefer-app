/**
 * Locale texts of the redesigned stop screen (redesign RD-2, re-design.md §7.3).
 *
 * The messages themselves are added through the fragment protocol (`messages/_fragments/D2.json`)
 * and merged by the orchestrator. Unit tests render the real message files, which do not contain
 * the fragment yet, so `stopText` falls back to this table per locale. Once the fragment is merged
 * the translation wins; the table then only documents the wording.
 */
const TEXTS = {
  backToTour: {
    de: "Zurück zur Tour",
    "zh-Hans": "返回线路",
    "zh-Hant-HK": "返回路線",
    "zh-Hant-TW": "返回路線",
  },
  photos: { de: "Fotos", "zh-Hans": "照片", "zh-Hant-HK": "照片", "zh-Hant-TW": "照片" },
  photoStore: { de: "Eingang", "zh-Hans": "入口", "zh-Hant-HK": "入口", "zh-Hant-TW": "入口" },
  photoParking: { de: "Parken", "zh-Hans": "停车", "zh-Hant-HK": "停車", "zh-Hant-TW": "停車" },
  summaryTotal: { de: "Gesamt", "zh-Hans": "合计", "zh-Hant-HK": "合計", "zh-Hant-TW": "合計" },
  statusDeliveredAt: {
    de: "Geliefert {time}",
    "zh-Hans": "{time} 已送达",
    "zh-Hant-HK": "{time} 已送達",
    "zh-Hant-TW": "{time} 已送達",
  },
  statusProblem: {
    de: "Problem: {reason}",
    "zh-Hans": "有问题：{reason}",
    "zh-Hant-HK": "有問題：{reason}",
    "zh-Hant-TW": "有問題：{reason}",
  },
  navigateStarting: {
    de: "Navigation wird geöffnet …",
    "zh-Hans": "正在打开导航 …",
    "zh-Hant-HK": "正在開啟導航 …",
    "zh-Hant-TW": "正在開啟導航 …",
  },
  deliveredStrip: {
    de: "Geliefert um {time}",
    "zh-Hans": "{time} 已送达",
    "zh-Hant-HK": "{time} 已送達",
    "zh-Hant-TW": "{time} 已送達",
  },
  problemStrip: {
    de: "Problem gemeldet",
    "zh-Hans": "问题已上报",
    "zh-Hant-HK": "問題已回報",
    "zh-Hant-TW": "問題已回報",
  },
  editAction: { de: "Bearbeiten", "zh-Hans": "编辑", "zh-Hant-HK": "編輯", "zh-Hant-TW": "編輯" },
  nextStop: {
    de: "Weiter zu Stopp {number}",
    "zh-Hans": "前往第 {number} 站",
    "zh-Hant-HK": "前往第 {number} 站",
    "zh-Hant-TW": "前往第 {number} 站",
  },
  backToTourAction: {
    de: "Zur Tour",
    "zh-Hans": "返回线路",
    "zh-Hant-HK": "返回路線",
    "zh-Hant-TW": "返回路線",
  },
  viewerTitle: {
    de: "Foto ansehen",
    "zh-Hans": "查看照片",
    "zh-Hant-HK": "查看照片",
    "zh-Hant-TW": "查看照片",
  },
  viewerPrev: {
    de: "Vorheriges Foto",
    "zh-Hans": "上一张照片",
    "zh-Hant-HK": "上一張照片",
    "zh-Hant-TW": "上一張照片",
  },
  viewerNext: {
    de: "Nächstes Foto",
    "zh-Hans": "下一张照片",
    "zh-Hant-HK": "下一張照片",
    "zh-Hant-TW": "下一張照片",
  },
  viewerClose: { de: "Schließen", "zh-Hans": "关闭", "zh-Hant-HK": "關閉", "zh-Hant-TW": "關閉" },
} as const;

export type StopTextKey = keyof typeof TEXTS;

type Translate = (key: string, values?: Record<string, string | number>) => string;

function isMissing(caught: unknown): boolean {
  return (
    caught instanceof Error &&
    (caught.message.includes("MISSING_MESSAGE") || caught.message.includes("missing message"))
  );
}

/**
 * Localized text of the stop screen: the merged message when it exists, otherwise the per-locale
 * fallback above (unit tests render the message files before the fragment is merged).
 */
export function stopText(
  t: Translate,
  locale: string,
  key: StopTextKey,
  values?: Record<string, string | number>,
): string {
  try {
    return t(key, values);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const table = TEXTS[key];
  const template: string =
    (table as Record<string, string | undefined>)[locale] ?? (table.de as string);
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
