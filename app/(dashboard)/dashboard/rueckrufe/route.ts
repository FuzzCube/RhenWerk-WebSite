import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { loadCallbackAlerts } from "@/lib/dashboard/callbacks";

const NO_STORE = { "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate" };

// Open callback requests for the notification banner (task-13-4); polled by the dashboard shell
export async function GET() {
  const session = await getSession();
  if (session.status !== "active") return NextResponse.json({ alerts: [] }, { status: 401, headers: NO_STORE });
  return NextResponse.json({ alerts: await loadCallbackAlerts(session.employee.role) }, { headers: NO_STORE });
}
