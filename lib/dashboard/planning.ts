import "server-only";
import { addDays, berlinToInstant, isDayKey, weekStart, dayKeyOf } from "@/lib/berlin-time";
import type { Employee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { nextWorkingDays, suggestSlots, type SlotBusy, type SlotExperience, type SlotSuggestion } from "@/lib/slot-suggestions";
import { formatWish } from "@/lib/format";
import { unreadMessages } from "./requests";
import type { UnreadInfo } from "./unread";
import { monthDays, monthLoad, type MonthLoad } from "@/lib/technician-load";
import type { QueueRow } from "./queues";

// Data of the planning page. Occupancy of all technicians comes from technician_busy_intervals
// (only technician, time and kind – no customer, address or absence reason). Details are added only
// for visits the user may read anyway via RLS (own requests for dispatchers, all for managers).
export type Technician = { id: string; name: string };
export type WorkingHours = { technicianId: string; weekday: number; start: string; end: string; validFrom: string | null; validTo: string | null };
// Open hold on the board (task-20-13): at the wished time (form), deviating from the wish (form, nothing free then;
// to be agreed with the customer) or agreed with the customer on the phone by Mira. wish: the customer's wish (form)
export type HoldState = "wish" | "deviates" | "mira";
export type HoldInfo = { state: HoldState; wish: string | null };
export type BusyBlock = {
  technicianId: string;
  start: string;
  end: string;
  // hold: window held by the phone assistant (task-13-3); shown, but does not block manual planning
  kind: "visit" | "absence" | "hold";
  // Only for readable visits
  requestId: string | null;
  requestNumber: string | null;
  // Planned visit that may still be moved on the board (task-10-8): status scheduled, not started yet;
  // version is the request version reschedule_visit checks
  move: { visitId: string; version: number } | null;
  // Only for holds
  hold?: HoldInfo;
  // Unread customer messages of the request (task-20-14), only where the request is readable
  unread?: number;
};
export type PlanningRequest = Pick<QueueRow, "id" | "request_number" | "company_name" | "city" | "service_kind" | "priority" | "customer_urgency" | "safety_check_required" | "work_status" | "due_at" | "waiting_since" | "version">;

export type PlanningData = {
  week: string;
  days: string[];
  technicians: Technician[];
  workingHours: WorkingHours[];
  busy: BusyBlock[];
  queue: PlanningRequest[];
  // Unread customer messages by request id: visits, holds and the queue (task-20-14)
  unread: Record<string, UnreadInfo>;
  selected: PlanningRequest | null;
  selectedPlanned: { id: string; request_number: string } | null;
  error: boolean;
};

// Hold with what the customer wished (website form: day and preferred_time from the submission)
const HOLD_SELECT = "request_id, technician_id, starts_at, ends_at, origin, wish_met, requests!inner(request_number, requested_visit_date, preferred_time:raw_payload->request->>preferred_time)";
type HoldRequest = { request_number: string | null; requested_visit_date: string | null; preferred_time: string | null };

function holdInfo(hold: { origin: string; wish_met: boolean | null; requests: unknown }): HoldInfo {
  if (hold.origin === "phone") return { state: "mira", wish: null };
  const request = hold.requests as HoldRequest;
  return { state: hold.wish_met === false ? "deviates" : "wish", wish: formatWish(request.requested_visit_date, request.preferred_time) };
}

export async function loadPlanning(employee: Employee, weekParam: string | undefined, requestParam: string | undefined): Promise<PlanningData> {
  const today = dayKeyOf(new Date());
  const week = weekStart(isDayKey(weekParam) ? weekParam : today);
  return loadPlanningDays(employee, Array.from({ length: 7 }, (_, index) => addDays(week, index)), requestParam);
}

// Same data for any consecutive list of days (planning board: 7 working days or a single day)
export async function loadPlanningDays(employee: Employee, days: string[], requestParam: string | undefined): Promise<PlanningData> {
  const supabase = await createClient();
  const week = weekStart(days[0]);
  const rangeStart = berlinToInstant(days[0], "00:00").toISOString();
  const rangeEnd = berlinToInstant(addDays(days[days.length - 1], 1), "00:00").toISOString();

  let queueQuery = supabase
    .from("dispatcher_queue")
    .select("id, request_number, company_name, city, service_kind, priority, customer_urgency, safety_check_required, work_status, due_at, waiting_since, version")
    .eq("queue", "planning")
    .order("priority_rank").order("due_at", { ascending: true, nullsFirst: false }).order("waiting_since").order("id");
  if (employee.role === "dispatcher") queueQuery = queueQuery.eq("dispatcher_id", employee.id);

  const [technicians, hours, busy, visits, queue, holds] = await Promise.all([
    supabase.from("profiles").select("id, display_name").eq("role", "technician").eq("is_active", true).order("display_name"),
    supabase.from("employee_availability").select("employee_id, weekday, local_start, local_end, valid_from, valid_to").eq("kind", "working_hours"),
    supabase.rpc("technician_busy_intervals", { range_start: rangeStart, range_end: rangeEnd }),
    supabase.from("visits").select("id, request_id, technician_id, scheduled_start, scheduled_end, status").in("status", ["scheduled", "in_progress"]).lt("scheduled_start", rangeEnd).gt("scheduled_end", rangeStart),
    queueQuery,
    employee.role === "technician" ? null : supabase.from("visit_holds").select(HOLD_SELECT).eq("status", "open").lt("starts_at", rangeEnd).gt("ends_at", rangeStart),
  ]);

  // Request numbers of readable visits (RLS)
  const readable = visits.data ?? [];
  const requestIds = [...new Set(readable.map((visit) => visit.request_id))];
  const queueRows = (queue.data ?? []) as PlanningRequest[];
  const [numbers, unread] = await Promise.all([
    requestIds.length ? supabase.from("requests").select("id, request_number, version").in("id", requestIds).then((result) => result.data ?? []) : Promise.resolve([]),
    unreadMessages([...new Set([...requestIds, ...(holds?.data ?? []).map((hold) => hold.request_id), ...queueRows.map((row) => row.id)].filter((id): id is string => Boolean(id)))]),
  ]);
  const numberOf = new Map(numbers.map((request) => [request.id, request.request_number]));
  const versionOf = new Map(numbers.map((request) => [request.id, request.version]));
  const loadedAt = Date.now();
  const readableBySlot = new Map(readable.map((visit) => [`${visit.technician_id}|${new Date(visit.scheduled_start).getTime()}|${new Date(visit.scheduled_end).getTime()}`, visit]));

  const selected = queueRows.find((row) => row.id === requestParam) ?? null;
  let selectedPlanned: PlanningData["selectedPlanned"] = null;
  if (!selected && requestParam && /^[0-9a-f-]{36}$/i.test(requestParam)) {
    const { data } = await supabase.from("requests").select("id, request_number").eq("id", requestParam).maybeSingle();
    selectedPlanned = data;
  }

  return {
    week,
    days,
    technicians: (technicians.data ?? []).map((tech) => ({ id: tech.id, name: tech.display_name })),
    workingHours: (hours.data ?? []).filter((row) => row.weekday !== null && row.local_start && row.local_end).map((row) => ({
      technicianId: row.employee_id,
      weekday: row.weekday as number,
      start: (row.local_start as string).slice(0, 5),
      end: (row.local_end as string).slice(0, 5),
      validFrom: row.valid_from,
      validTo: row.valid_to,
    })),
    busy: (busy.data ?? []).map((interval): BusyBlock => {
      const visit = interval.busy_kind === "visit"
        ? readableBySlot.get(`${interval.technician_id}|${new Date(interval.starts_at).getTime()}|${new Date(interval.ends_at).getTime()}`)
        : undefined;
      return {
        technicianId: interval.technician_id,
        start: interval.starts_at,
        end: interval.ends_at,
        kind: interval.busy_kind === "absence" ? "absence" : "visit",
        requestId: visit?.request_id ?? null,
        requestNumber: visit ? numberOf.get(visit.request_id) ?? null : null,
        unread: visit ? unread.get(visit.request_id)?.count ?? 0 : 0,
        move: visit && visit.status === "scheduled" && Date.parse(visit.scheduled_start) > loadedAt && versionOf.has(visit.request_id)
          ? { visitId: visit.id, version: versionOf.get(visit.request_id) as number }
          : null,
      };
    }).concat((holds?.data ?? []).map((hold) => ({
      technicianId: hold.technician_id,
      start: hold.starts_at,
      end: hold.ends_at,
      kind: "hold" as const,
      requestId: hold.request_id,
      requestNumber: (hold.requests as unknown as HoldRequest).request_number,
      move: null,
      hold: holdInfo(hold),
      unread: unread.get(hold.request_id)?.count ?? 0,
    }))),
    queue: queueRows,
    unread: Object.fromEntries(unread),
    selected,
    selectedPlanned,
    error: Boolean(technicians.error || hours.error || busy.error || queue.error),
  };
}

// Suggestions and availability of the next working days for the selected request (task-10-3).
// Occupancy comes from technician_busy_intervals, experience from technician_experience (counts only).
export type Availability = {
  days: string[];
  now: string;
  busy: SlotBusy[];
  suggestions: SlotSuggestion[];
  // Counts only, so the board can rank suggestions again for another duration
  experience: Record<string, SlotExperience>;
  error: boolean;
};

export async function loadAvailability(requestId: string | null, technicians: Technician[], workingHours: WorkingHours[], durationMinutes: number): Promise<Availability> {
  const supabase = await createClient();
  const now = new Date();
  const days = nextWorkingDays(dayKeyOf(now), 7);
  const rangeStart = berlinToInstant(days[0], "00:00").toISOString();
  const rangeEnd = berlinToInstant(addDays(days[days.length - 1], 1), "00:00").toISOString();
  const [busy, experience] = await Promise.all([
    supabase.rpc("technician_busy_intervals", { range_start: rangeStart, range_end: rangeEnd }),
    requestId ? supabase.rpc("technician_experience", { request_id: requestId }) : Promise.resolve({ data: [], error: null }),
  ]);
  const blocks: SlotBusy[] = (busy.data ?? []).map((row) => ({ technicianId: row.technician_id, start: row.starts_at, end: row.ends_at, kind: row.busy_kind === "absence" ? "absence" : "visit" }));
  const experienceById: Record<string, SlotExperience> = Object.fromEntries((experience.data ?? []).map((row) => [row.technician_id, { customerVisits: row.customer_visits, manufacturerVisits: row.manufacturer_visits, equipmentVisits: row.equipment_visits }]));
  const suggestions = requestId ? suggestSlots({ technicians, workingHours, busy: blocks, days, now, durationMinutes, experience: experienceById }) : [];
  return { days, now: now.toISOString(), busy: blocks, suggestions, experience: experienceById, error: Boolean(busy.error || experience.error) };
}

// Context of the selected request: earlier visits and ordered parts (readable via RLS)
export type SelectedContext = {
  visits: Array<{ start: string; technicianId: string; status: string }>;
  orderedParts: Array<{ description: string; quantity: number; orderedAt: string }>;
};

export async function loadSelectedContext(requestId: string): Promise<SelectedContext> {
  const supabase = await createClient();
  const [visits, parts] = await Promise.all([
    supabase.from("visits").select("scheduled_start, technician_id, status").eq("request_id", requestId).neq("status", "cancelled").order("scheduled_start"),
    supabase.from("work_entries").select("description, quantity, created_at").eq("request_id", requestId).eq("item_status", "ordered").order("created_at"),
  ]);
  return {
    visits: (visits.data ?? []).map((row) => ({ start: row.scheduled_start, technicianId: row.technician_id, status: row.status })),
    orderedParts: (parts.data ?? []).map((row) => ({ description: row.description, quantity: Number(row.quantity), orderedAt: row.created_at })),
  };
}

// Monthly load per technician for the planning board (task-12-1): calendar month of the shown day. Visits come from
// technician_load_intervals (incl. completed and waiting for parts), absences from technician_busy_intervals; both
// only technician and time.
export type MonthLoads = { month: string; loads: Record<string, MonthLoad>; error: boolean };

export async function loadMonthLoads(day: string, technicians: Technician[], workingHours: WorkingHours[]): Promise<MonthLoads> {
  const supabase = await createClient();
  const days = monthDays(day);
  const rangeStart = berlinToInstant(days[0], "00:00").toISOString();
  const rangeEnd = berlinToInstant(addDays(days[days.length - 1], 1), "00:00").toISOString();
  const [visits, busy] = await Promise.all([
    supabase.rpc("technician_load_intervals", { range_start: rangeStart, range_end: rangeEnd }),
    supabase.rpc("technician_busy_intervals", { range_start: rangeStart, range_end: rangeEnd }),
  ]);
  const visitList = (visits.data ?? []).map((row) => ({ technicianId: row.technician_id, start: row.starts_at, end: row.ends_at }));
  const absences = (busy.data ?? []).filter((row) => row.busy_kind === "absence").map((row) => ({ technicianId: row.technician_id, start: row.starts_at, end: row.ends_at }));
  const loads = Object.fromEntries(technicians.map((tech) => [tech.id, monthLoad({ technicianId: tech.id, day, workingHours, visits: visitList, absences })]));
  return { month: days[0], loads, error: Boolean(visits.error || busy.error) };
}

// Where the planning board opens for a request (task-20-2): its open hold (technician, window) or the wished day
export type PlanningTarget = { hold: { technicianId: string; start: string; end: string; info: HoldInfo } | null; wishedDay: string | null };

export async function loadPlanningTarget(requestId: string): Promise<PlanningTarget> {
  const supabase = await createClient();
  const [hold, request] = await Promise.all([
    supabase.from("visit_holds").select(HOLD_SELECT).eq("request_id", requestId).eq("status", "open").maybeSingle(),
    supabase.from("requests").select("requested_visit_date").eq("id", requestId).maybeSingle(),
  ]);
  return {
    hold: hold.data ? { technicianId: hold.data.technician_id, start: hold.data.starts_at, end: hold.data.ends_at, info: holdInfo(hold.data) } : null,
    wishedDay: request.data?.requested_visit_date ?? null,
  };
}
