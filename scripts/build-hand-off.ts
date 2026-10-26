/**
 * Writes the bilingual hand-off help page into `public/` (NUD-127). Runs after `scripts/build-pwa.ts`
 * in the `build` / `build:vercel` chains, so the four files exist before `next build` copies `public/`.
 *
 * The page is generated, never hand-edited: the source of truth is `content/hand-off/index.ts`.
 * A broken index fails the build - a release must never ship a half-broken help page.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { HAND_OFF } from "../content/hand-off";
import {
  handOffCss,
  handOffData,
  handOffHtml,
  handOffProblems,
  handOffScript,
} from "./lib/hand-off-page";

const publicDir = path.join(process.cwd(), "public");

const problems = handOffProblems(HAND_OFF);
if (problems.length > 0) {
  console.error(`hand-off: content is not shippable (${problems.length} problem(s)):`);
  for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
  process.exit(1);
}

const files: [string, string][] = [
  ["hand-off.html", handOffHtml(HAND_OFF)],
  ["hand-off.css", handOffCss()],
  ["hand-off.js", handOffScript()],
  ["hand-off-data.js", handOffData(HAND_OFF)],
];

for (const [name, body] of files) {
  writeFileSync(path.join(publicDir, name), body, "utf8");
}

const de = HAND_OFF.topics.length;
console.log(
  `hand-off: public/hand-off.html (${de} topics, de+zh, ${HAND_OFF.glossary.length} glossary terms), hand-off.js, hand-off-data.js, hand-off.css`,
);
