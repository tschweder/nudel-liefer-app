/**
 * Original app icon (a bowl of pasta with steam), drawn as SVG. `maskable` keeps the whole glyph
 * inside the central 60 % so launchers can crop it to a circle / squircle; the plain variant has
 * rounded corners and a larger glyph. Rendered to PNG by `scripts/generate-pwa-icons.ts`.
 */
export const ICON_BACKGROUND = "#2f6b4f";

function glyph(): string {
  return `
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M196 120c-16 22 16 34 0 56M256 104c-16 22 16 34 0 56M316 120c-16 22 16 34 0 56" stroke="#e3efe8" stroke-width="14" opacity="0.85"/>
    <path d="M120 292c10-56 52-72 84-44 22 20 44 20 52-6 10-34 54-50 84-14 14 18 28 30 52 64" stroke="#f3d58a" stroke-width="22"/>
    <path d="M140 270c22-34 58-34 82-4 16 20 42 20 56-6 16-30 54-34 78-6" stroke="#f8e3a8" stroke-width="18"/>
  </g>
  <path d="M90 288h332c0 94-66 152-166 152S90 382 90 288Z" fill="#ffffff"/>
  <rect x="78" y="276" width="356" height="24" rx="12" fill="#e3efe8"/>
  <rect x="190" y="436" width="132" height="28" rx="14" fill="#e3efe8"/>
  <path d="M146 336c14 36 52 58 110 58" fill="none" stroke="#f3d58a" stroke-width="10" stroke-linecap="round" opacity="0.8"/>`;
}

export function iconSvg(variant: "any" | "maskable"): string {
  const scale = variant === "maskable" ? 0.78 : 1;
  const offset = (512 - 512 * scale) / 2;
  const radius = variant === "any" ? 112 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${radius}" fill="${ICON_BACKGROUND}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${glyph()}
  </g>
</svg>`;
}
