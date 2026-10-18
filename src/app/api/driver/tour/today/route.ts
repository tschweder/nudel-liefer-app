import { driverTourTodayResponse } from "@/server/driver-tour-api";

export function GET() {
  return driverTourTodayResponse();
}
