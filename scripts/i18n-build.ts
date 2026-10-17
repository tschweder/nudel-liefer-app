import path from "node:path";

import { buildGenerated } from "./lib/i18n-files";

buildGenerated(path.join(process.cwd(), "messages"), console.log);
