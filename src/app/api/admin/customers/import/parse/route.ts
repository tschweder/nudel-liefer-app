import { requireRole } from "@/server/auth/guards";
import { handleParseUpload } from "@/server/customer-import-upload";

export function POST(request: Request) {
  return handleParseUpload(request, { requireRole });
}
