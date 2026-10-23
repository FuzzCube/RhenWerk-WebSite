import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { loadDashboardSnapshot } from "@/lib/dashboard/notifications";

const headers = { "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const session = await getSession(true);
    if (session.status !== "active") return NextResponse.json({ error: "Keine aktive Sitzung" }, { status: 401, headers });
    const since = new URL(request.url).searchParams.get("seit");
    if (since && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(since) || !Number.isFinite(Date.parse(since)) || Date.parse(since) > Date.now())) {
      return NextResponse.json({ error: "Ungültiger Zeitpunkt" }, { status: 400, headers });
    }
    return NextResponse.json(await loadDashboardSnapshot(session.employee, since ?? undefined), { headers });
  } catch {
    // A partial response would silently clear valid badges. Keep the client's entire last successful snapshot.
    return NextResponse.json({ error: "Aktualisierung vorübergehend nicht verfügbar" }, { status: 503, headers });
  }
}
