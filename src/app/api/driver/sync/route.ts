import { driverSyncResponse } from "@/server/driver-sync";

export function POST(request: Request) {
  return driverSyncResponse(request);
}
