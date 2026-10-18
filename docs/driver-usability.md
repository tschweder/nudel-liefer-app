# Driver usability, accessibility and performance (NUD-095)

Rules: backlog section 4.3 (touch targets >= 48 px, text >= 16 px, quantities >= 28 px bold, icon next to
every label, WCAG AA). They are checked automatically; this page says how and what is deliberately
exempt.

## Automated checks (Playwright, production build)

| Spec                                                                | What                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/driver-a11y.spec.ts`                                     | axe-core (no serious / critical findings) and the 4.3 measurements over login, language picker, today (list + map), stop detail with / without photos, problem sheet, toast, result card, finished screen, offline list + stop (service worker shell), generic offline page, error page (online + offline), iOS install hint + overlay. All four locales, light and dark colour scheme; de and zh-Hant-TW also at 130 % font size. |
| `tests/e2e/driver-usability.spec.ts`                                | primary actions in the bottom half at 375x667 and 412x915 (bounding boxes), visible keyboard focus in reading order, reduced motion.                                                                                                                                                                                                                                                                                               |
| `tests/e2e/driver-performance.spec.ts`                              | LCP of the driver home (25 stops) after the first load on Slow 4G + 4x CPU, PerformanceObserver.                                                                                                                                                                                                                                                                                                                                   |
| `pnpm lighthouse:prepare` + `pnpm lighthouse` (CI job `lighthouse`) | Lighthouse CI on the driver home, warm profile, DevTools throttling, LCP < 2.5 s (`lighthouserc.cjs`).                                                                                                                                                                                                                                                                                                                             |

Helpers: `tests/e2e/helpers/driver-fixture.ts` (own driver + tour), `driver-audit.ts` (axe + measurements).

Emulation limits: "130 % font size" sets the root font size to 130 % (what Chrome's font-size setting
does for rem-based CSS; Android's per-app font scale is not emulated). Throttling is Chromium's
DevTools throttling on a desktop CPU, not a real low-end phone (NUD-105 / NUD-107 / NUD-109 cover real
devices).

## Decisions

- **Dark mode:** supported. The design tokens follow `prefers-color-scheme` (NUD-005); axe runs in
  both schemes. `color-scheme: dark` is set so native controls follow. No manual toggle.
- **Exempt from the 16 px / 48 px rule:** the map credit line (OpenStreetMap / Leaflet attribution is
  required text, secondary information).
- **Status buttons stay in the page flow** (no sticky bar): a sticky "Delivered" button would invite
  a tap before the quantities were read. At the end of the page they sit in the bottom half.
- **Reduced motion:** transitions / animations are shortened globally; spinners keep turning.
