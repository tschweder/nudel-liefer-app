/**
 * The generic offline page served by the service worker when a driver page cannot be loaded
 * (NUD-080). Static HTML with the texts of all four locales (from messages/*.json, key group
 * `pwa.offline`); a tiny script shows the language of the URL prefix. No personal data.
 */

export const OFFLINE_LOCALES = ["de", "zh-Hans", "zh-Hant-HK", "zh-Hant-TW"] as const;
export type OfflineLocale = (typeof OFFLINE_LOCALES)[number];
export type OfflineTexts = { title: string; text: string; retry: string };

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function buildOfflineHtml(
  texts: Record<OfflineLocale, OfflineTexts>,
  themeColor: string,
): string {
  const sections = OFFLINE_LOCALES.map((locale) => {
    const t = texts[locale];
    return `    <section lang="${locale}" data-locale="${locale}" hidden>
      <h1>${escapeHtml(t.title)}</h1>
      <p>${escapeHtml(t.text)}</p>
      <button type="button" onclick="location.reload()">${escapeHtml(t.retry)}</button>
    </section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="${themeColor}" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(texts.de.title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 16px; box-sizing: border-box;
        font: 18px/1.5 system-ui, "PingFang SC", "PingFang HK", "PingFang TC", "Noto Sans SC", "Noto Sans HK", "Noto Sans TC", "Microsoft YaHei", "Microsoft JhengHei", sans-serif; }
      main { max-width: 24rem; text-align: center; }
      h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
      p { margin: 0 0 1.5rem; }
      button { min-height: 48px; min-width: 48px; padding: 0 1.5rem; font: inherit; font-weight: 600; border: 0; border-radius: 8px; color: #fff; background: ${themeColor}; }
    </style>
  </head>
  <body>
    <main>
${sections}
    </main>
    <script>
      (function () {
        var wanted = location.pathname.split("/")[1];
        var sections = document.querySelectorAll("section[data-locale]");
        var shown = false;
        for (var i = 0; i < sections.length; i++) {
          if (sections[i].getAttribute("data-locale") === wanted) { sections[i].hidden = false; shown = true; }
        }
        if (!shown) sections[0].hidden = false;
        document.documentElement.lang = shown ? wanted : "de";
      })();
    </script>
  </body>
</html>
`;
}
