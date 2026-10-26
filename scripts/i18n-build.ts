import path from "node:path";

import { buildGenerated } from "./lib/i18n-files";

// The message files are hand-written (no more OpenCC build); this only refreshes
// src/lib/fatal-messages.json, which global-error.tsx imports instead of the big catalogs.
buildGenerated(path.join(process.cwd(), "messages"), console.log);
