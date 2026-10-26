/*
 * Colour-scheme bootstrap (NUD-132).
 *
 * Runs before the first paint (loaded with `next/script` strategy="beforeInteractive" from the root
 * layout) and adds the `dark` class to <html> when the NEXT_THEME cookie says so. It has to be a
 * separate file rather than an inline snippet: production `script-src` has no 'unsafe-inline' and a
 * nonce cannot be baked into a static file. `'self'` covers this because it is served from our origin
 * (under the base path, i.e. /delivery-app/theme.js).
 *
 * The server cannot do this job: reading the cookie in the root layout makes every route "uncached or
 * runtime data" and the `cacheComponents` build refuses to prerender any static shell.
 *
 * Keep in sync with src/lib/theme.ts (cookie name, the two values, light as the default).
 */
(function () {
  try {
    var match = document.cookie.match(/(?:^|;\s*)NEXT_THEME=(dark|light)(?:;|$)/);
    if (match && match[1] === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  } catch {
    /* A blocked cookie store must never break the page: light stays the default. */
  }
})();
