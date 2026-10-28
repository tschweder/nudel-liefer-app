import type { Page } from "@playwright/test";

/**
 * Measurements of the tablet layout audit (NUD-153) — the admin counterpart of `driver-audit.ts`.
 *
 * The admin area is a desktop design (D2: 40 px `default` buttons, a 260 px rail, a 1440 px content
 * column), so the driver rules of backlog 4.3 cannot be applied wholesale here. This module measures
 * exactly the two things the ticket asks for:
 *
 *  - **overflow**: the page itself never scrolls horizontally, and no visible element sticks out of
 *    the viewport — unless it sits inside a horizontal scroll / clip container (a table container,
 *    which the ticket explicitly allows) or the element is a map pane. Map tiles legitimately extend
 *    far beyond their box and are clipped by Leaflet; the interim audit of 2026-10-28 (NUD-153)
 *    recorded them as a false positive of a naive rect check, so the clipping rule covers them.
 *  - **controls**: every visible interactive control with its measured size, grouped by where it
 *    lives. The spec decides which groups must reach 48 px; the admin content area deliberately keeps
 *    the kit's desktop sizes and is only recorded (see the ticket's implementation notes).
 *
 * Elements that are 1-2 px wide (`sr-only`, the skip link, hairlines) are not measured: they are not
 * a hit area and not a layout defect.
 */

/** Where a measured control lives — decides which touch-target rule applies to it. */
export type ControlGroup = "nav" | "header" | "main" | "login" | "driver";

export type TabletFinding = { kind: "hscroll" | "overflow"; detail: string };

export type MeasuredControl = {
  group: ControlGroup;
  label: string;
  width: number;
  height: number;
};

export type PageAudit = {
  id: string;
  path: string;
  viewport: { width: number; height: number };
  findings: TabletFinding[];
  controls: MeasuredControl[];
  /** Horizontal scroll containers that really scroll (allowed, quantified for the ticket). */
  internalScroll: Array<{ label: string; scrollWidth: number; clientWidth: number }>;
};

/**
 * Chrome's own UI (dev overlay, hydration toast) is not part of the app and must not become a
 * finding when the suite runs against `next dev`.
 */
const IGNORED_SELECTOR =
  "nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button], [data-nextjs-error-overlay-nav]";

/** Interactive controls whose size matters on a touch screen. */
const CONTROL_SELECTOR =
  "a[href], button, input:not([type=hidden]), select, textarea, summary, " +
  "[role=button], [role=link], [role=switch], [role=tab], [role=menuitem], [role=checkbox], [role=radio]";

/** At most this many element findings per page: one real cause is worth more than 200 lines of noise. */
const MAX_OVERFLOW_FINDINGS = 12;

export async function auditTabletPage(
  page: Page,
  { id, group }: { id: string; group: "admin" | "login" | "driver" },
): Promise<PageAudit> {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const result = await page.evaluate(
    ({ ignoredSelector, controlSelector, maxOverflow, group }) => {
      const vw = window.innerWidth;
      const doc = document.documentElement;
      const findings: { kind: "hscroll" | "overflow"; detail: string }[] = [];
      const controls: {
        group: "nav" | "header" | "main" | "login" | "driver";
        label: string;
        width: number;
        height: number;
      }[] = [];

      const bodyWidth = document.body.scrollWidth;
      if (doc.scrollWidth > vw + 1 || bodyWidth > vw + 1) {
        findings.push({
          kind: "hscroll",
          detail:
            `documentElement.scrollWidth ${doc.scrollWidth}px > innerWidth ${vw}px ` +
            `(body ${bodyWidth}px)`,
        });
      }

      const describe = (el: Element): string => {
        const name = el.getAttribute("data-testid");
        const text = (el.getAttribute("aria-label") ?? el.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 40);
        return `${el.tagName.toLowerCase()}${name ? `[${name}]` : ""}${text ? ` "${text}"` : ""}`;
      };

      const isVisible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        // 1-2 px helpers (sr-only, the skip link, hairline separators) are neither hit area nor
        // layout defect; Chrome reports them with a zero-ish rect.
        if (rect.width < 4 || rect.height < 4) return false;
        const style = getComputedStyle(el);
        return (
          style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0
        );
      };

      /**
       * Nearest ancestor that scrolls or clips horizontally. Content inside it cannot widen the page;
       * that is the "inside a scroll container" case the ticket allows (and the map pane, whose
       * tiles are clipped by `.leaflet-container`).
       */
      const clipAncestor = (el: Element): Element | null => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const overflowX = getComputedStyle(a).overflowX;
          if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") return a;
          if (overflowX === "clip") return a;
        }
        return null;
      };

      const sticksOut = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        return rect.right > vw + 1 || rect.left < -1;
      };

      // Only the outermost offender of a chain is reported: it names the cause, and its children
      // would repeat the same sentence dozens of times.
      let reported = 0;
      for (const el of document.body.querySelectorAll("*")) {
        if (reported >= maxOverflow) break;
        if (el.closest(ignoredSelector)) continue;
        if (!isVisible(el) || !sticksOut(el)) continue;
        if (clipAncestor(el)) continue;
        const parent = el.parentElement;
        if (
          parent &&
          parent !== document.body &&
          isVisible(parent) &&
          sticksOut(parent) &&
          !clipAncestor(parent)
        ) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        findings.push({
          kind: "overflow",
          detail: `${describe(el)} left ${Math.round(rect.left)} right ${Math.round(rect.right)} (viewport 0..${vw})`,
        });
        reported += 1;
      }

      for (const el of document.body.querySelectorAll(controlSelector)) {
        if (el.closest(ignoredSelector)) continue;
        if (el.closest("[aria-hidden=true], [hidden], [inert]")) continue;
        // The OSM/Leaflet credit line is legally required running text, not a button (driver-audit
        // exempts it the same way): 15 px high on purpose, and never a mis-tap.
        if (el.closest(".leaflet-control-attribution")) continue;
        // A visually hidden `<input type=file>` is driven by the visible button in front of it.
        if (el instanceof HTMLInputElement && el.type === "file") continue;
        if ((el as HTMLButtonElement).disabled && el.tagName === "BUTTON") continue;
        if (!isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        let where: "nav" | "header" | "main" | "login" | "driver";
        if (group === "admin") {
          // "nav" is the off-canvas drawer — the whole navigation below 1025 px. The desktop rail
          // (`aside`, ≥1025 px) is chrome like the top bar: recorded, never asserted at 48 px.
          const inDrawer = el.closest('[data-slot="sheet-content"]');
          if (inDrawer || el.closest('[data-testid="open-menu"]')) where = "nav";
          else if (el.closest("aside") || el.closest("header")) where = "header";
          else where = "main";
        } else {
          where = group;
        }
        controls.push({
          group: where,
          label: describe(el),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }

      /**
       * Horizontal scroll containers that actually scroll. The ticket allows them (a table may
       * scroll on its own instead of widening the page), so this is inventory, not a finding — it is
       * how the products table at 768 px portrait is quantified.
       */
      const internalScroll: {
        label: string;
        scrollWidth: number;
        clientWidth: number;
      }[] = [];
      for (const el of document.body.querySelectorAll("*")) {
        if (el.closest(ignoredSelector)) continue;
        if (el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 1) continue;
        const overflowX = getComputedStyle(el).overflowX;
        if (overflowX !== "auto" && overflowX !== "scroll") continue;
        internalScroll.push({
          label: describe(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        });
      }

      return { findings, controls, internalScroll };
    },
    {
      ignoredSelector: IGNORED_SELECTOR,
      controlSelector: CONTROL_SELECTOR,
      maxOverflow: MAX_OVERFLOW_FINDINGS,
      group,
    },
  );

  return {
    id,
    path: new URL(page.url()).pathname + new URL(page.url()).search,
    viewport,
    ...result,
  };
}

/**
 * Rules the spec asserts. `>= 48 px` is the driver rule of backlog 4.3 and applies to the surfaces a
 * tablet user touches without a mouse: the off-canvas navigation (the whole navigation ≤1024 px),
 * the login screens and the driver app. The rest of the admin kit keeps its desktop sizes (40 px
 * `default` buttons, 44 px form fields, 32 px row icon buttons); the spec records those instead of
 * changing the design — the ticket wants the list, not a redesign.
 */
export const TOUCH_GROUPS: ReadonlyArray<ControlGroup> = ["nav", "login", "driver"];

export function controlViolations(controls: MeasuredControl[], minimum = 48): MeasuredControl[] {
  return controls
    .filter((control) => TOUCH_GROUPS.includes(control.group))
    .filter((control) => control.width < minimum || control.height < minimum);
}
