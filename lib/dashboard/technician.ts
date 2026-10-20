import "server-only";
import { addDays, berlinToInstant, dayKeyOf, isDayKey, weekStart } from "@/lib/berlin-time";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Data of the technician pages. Every query is restricted to the signed-in technician (technician_id = own id)
// in addition to RLS, which would also show other technicians' visits of the technician's current requests.
type Tables = Database["public"]["Tables"];
type RequestInfo = Pick<Tables["requests"]["Row"], "id" | "request_number" | "company_name" | "customer_number" | "contact_name" | "phone_number" | "street_house_number" | "postal_code" | "city" | "site_label" | "equipment_kind" | "service_kind" | "description" | "safety_risk" | "priority" | "work_status">;
export type TechnicianVisit = Pick<Tables["visits"]["Row"], "id" | "request_id" | "status" | "scheduled_start" | "scheduled_end" | "actual_start" | "waiting_reason" | "summary"> & { request: RequestInfo };
export type PendingParts = { request: RequestInfo; parts: Array<Pick<Tables["work_entries"]["Row"], "id" | "description" | "quantity" | "ordered_at">>; waitingReason: string | null };

const REQUEST_COLUMNS = "id, request_number, company_name, customer_number, contact_name, phone_number, street_house_number, postal_code, city, site_label, equipment_kind, service_kind, description, safety_risk, priority, work_status";
const VISIT_COLUMNS = `id, request_id, status, scheduled_start, scheduled_end, actual_start, waiting_reason, summary, request:requests!inner(${REQUEST_COLUMNS})`;

export async function loadToday(technicianId: string) {
  const supabase = await createClient();
  const now = new Date();
  const today = dayKeyOf(now);
  const dayStart = berlinToInstant(today, "00:00").toISOString();
  const dayEnd = berlinToInstant(addDays(today, 1), "00:00").toISOString();

  const tomorrowEnd = berlinToInstant(addDays(today, 2), "00:00").toISOString();
  const weekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const [running, upcoming, todays, parts, waiting, tomorrow, later, hours] = await Promise.all([
    supabase.from("visits").select(VISIT_COLUMNS).eq("technician_id", technicianId).eq("status", "in_progress").order("scheduled_start").limit(1),
    supabase.from("visits").select(VISIT_COLUMNS).eq("technician_id", technicianId).eq("status", "scheduled").gt("scheduled_end", now.toISOString()).order("scheduled_start").limit(1),
    supabase.from("visits").select(VISIT_COLUMNS).eq("technician_id", technicianId).neq("status", "cancelled").lt("scheduled_start", dayEnd).gt("scheduled_end", dayStart).order("scheduled_start"),
    supabase.from("work_entries").select(`id, description, quantity, ordered_at, request:requests!inner(${REQUEST_COLUMNS}, technician_id)`).eq("kind", "part").eq("item_status", "ordered").eq("request.technician_id", technicianId).order("ordered_at"),
    supabase.from("visits").select(VISIT_COLUMNS).eq("technician_id", technicianId).eq("status", "waiting_parts").order("scheduled_start"),
    supabase.from("visits").select(VISIT_COLUMNS).eq("technician_id", technicianId).neq("status", "cancelled").gte("scheduled_start", dayEnd).lt("scheduled_start", tomorrowEnd).order("scheduled_start"),
    supabase.from("visits").select(VISIT_COLUMNS).eq("technician_id", technicianId).eq("status", "scheduled").gte("scheduled_start", dayEnd).order("scheduled_start").limit(1),
    supabase.from("employee_availability").select("local_start, local_end, valid_from, valid_to").eq("employee_id", technicianId).eq("kind", "working_hours").eq("weekday", weekday),
  ]);
  // Working hours of today (redesign task-10-3: shown in the header and after the last visit)
  const todayHours = (hours.data ?? [])
    .filter((row) => row.local_start && row.local_end && (!row.valid_from || row.valid_from <= today) && (!row.valid_to || row.valid_to >= today))
    .map((row) => ({ start: (row.local_start as string).slice(0, 5), end: (row.local_end as string).slice(0, 5) }))
    .sort((a, b) => a.start.localeCompare(b.start));

  // Requests waiting for parts: ordered parts of own current requests plus visits paused for parts
  const pending = new Map<string, PendingParts>();
  for (const entry of parts.data ?? []) {
    const { technician_id: _technicianId, ...request } = entry.request;
    void _technicianId;
    const item = pending.get(request.id) ?? { request, parts: [], waitingReason: null };
    item.parts.push({ id: entry.id, description: entry.description, quantity: entry.quantity, ordered_at: entry.ordered_at });
    pending.set(request.id, item);
  }
  for (const visit of (waiting.data ?? []) as TechnicianVisit[]) {
    if (["completed", "cancelled"].includes(visit.request.work_status)) continue;
    const item = pending.get(visit.request_id) ?? { request: visit.request, parts: [], waitingReason: null };
    item.waitingReason = visit.waiting_reason;
    pending.set(visit.request_id, item);
  }

  return {
    now: now.getTime(),
    today,
    next: ((running.data?.[0] ?? upcoming.data?.[0]) ?? null) as TechnicianVisit | null,
    todays: (todays.data ?? []) as TechnicianVisit[],
    pending: [...pending.values()],
    tomorrow: (tomorrow.data ?? []) as TechnicianVisit[],
    tomorrowDay: addDays(today, 1),
    nextLater: (later.data?.[0] ?? null) as TechnicianVisit | null,
    hours: todayHours,
    error: Boolean(running.error || upcoming.error || todays.error || parts.error || waiting.error || tomorrow.error || later.error || hours.error),
  };
}

export async function loadWeek(technicianId: string, weekParam: string | undefined) {
  const supabase = await createClient();
  const week = weekStart(isDayKey(weekParam) ? weekParam : dayKeyOf(new Date()));
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const rangeStart = berlinToInstant(week, "00:00").toISOString();
  const rangeEnd = berlinToInstant(addDays(week, 7), "00:00").toISOString();

  const [visits, availability] = await Promise.all([
    supabase.from("visits").select(VISIT_COLUMNS).eq("technician_id", technicianId).neq("status", "cancelled").lt("scheduled_start", rangeEnd).gt("scheduled_end", rangeStart).order("scheduled_start"),
    supabase.from("employee_availability").select("kind, weekday, local_start, local_end, valid_from, valid_to, starts_at, ends_at").eq("employee_id", technicianId),
  ]);
  const rows = availability.data ?? [];
  return {
    week,
    days,
    visits: (visits.data ?? []) as TechnicianVisit[],
    workingHours: rows.filter((row) => row.kind === "working_hours" && row.weekday && row.local_start && row.local_end).map((row) => ({
      technicianId,
      weekday: row.weekday as number,
      start: (row.local_start as string).slice(0, 5),
      end: (row.local_end as string).slice(0, 5),
      validFrom: row.valid_from,
      validTo: row.valid_to,
    })),
    absences: rows.filter((row) => row.kind === "absence" && row.starts_at && row.ends_at
      && new Date(row.starts_at).getTime() < new Date(rangeEnd).getTime() && new Date(row.ends_at).getTime() > new Date(rangeStart).getTime())
      .map((row) => ({ start: row.starts_at as string, end: row.ends_at as string })),
    error: Boolean(visits.error || availability.error),
  };
}
