import { driverPhotoResponse } from "@/server/driver-photos";

export function POST(request: Request) {
  return driverPhotoResponse(request);
}
