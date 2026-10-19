import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { mayUseArea, suggest, SUGGEST_AREAS, type SuggestArea } from "@/lib/dashboard/suggestions";

const NO_STORE = { "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate" };

// Suggestions for the search fields (task-12-4): ?bereich=anfragen|kunden|rechnungen|posteingang|kundennummer&q=…
// Role of the area checked here, rows filtered by RLS like the lists.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (session.status !== "active") return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401, headers: NO_STORE });

  const params = request.nextUrl.searchParams;
  const area = params.get("bereich") as SuggestArea | null;
  if (!area || !SUGGEST_AREAS.includes(area)) return NextResponse.json({ error: "Unbekannter Bereich." }, { status: 400, headers: NO_STORE });
  if (!mayUseArea(area, session.employee.role)) return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403, headers: NO_STORE });

  const items = await suggest(area, params.get("q") ?? "", params.get("nachricht"));
  return NextResponse.json({ items }, { headers: NO_STORE });
}
