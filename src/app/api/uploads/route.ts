import { requireRole } from "@/server/auth/guards";
import { getStorage } from "@/server/storage";
import { handleCreateUpload } from "@/server/uploads";

export function POST(request: Request) {
  return handleCreateUpload(request, { requireRole, storage: () => getStorage() });
}
