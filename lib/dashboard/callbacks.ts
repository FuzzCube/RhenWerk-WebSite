import "server-only";
import type { EmployeeRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

// Callback requests of the phone assistant (task-13-4) shown as dashboard notification. RLS decides who reads a row:
// the technician their own, a dispatcher escalations addressed to them or to all dispatchers. Dispatchers are only
// notified after escalation; manager and admin get no notification. Since task-13-6 dispatchers also see urgent
// calls (emergency, danger, production stop or an urgent callback asked for by the assistant) until someone called back.
export type VisitCallbackAlert = {
  kind: "visit";
  id: string;
  request_id: string;
  visit_id: string;
  callback_number: string;
  company_name: string;
  site: string;
  scheduled_start: string;
  created_at: string;
  escalated_at: string | null;
  technician: string | null;
};
export type CallAlert = {
  kind: "call";
  id: string;
  request_id: string | null;
  callback_number: string | null;
  company_name: string;
  reason: string;
  created_at: string;
};
export type CallbackAlert = VisitCallbackAlert | CallAlert;

export async function loadCallbackAlerts(role: EmployeeRole, { strict = false } = {}): Promise<CallbackAlert[]> {
  if (role !== "technician" && role !== "dispatcher") return [];
  const supabase = await createClient();
  let query = supabase
    .from("callback_requests")
    .select("id, request_id, visit_id, callback_number, company_name, site, scheduled_start, created_at, escalated_at, technician:profiles!callback_requests_technician_id_fkey(display_name)")
    .eq("status", "open")
    .order("created_at");
  if (role === "dispatcher") query = query.not("escalated_at", "is", null);
  const [{ data, error }, calls] = await Promise.all([
    query,
    role === "dispatcher"
      ? supabase.from("phone_calls").select("id, request_id, callback_number, callback_reason, summary, started_at, analysis, requests(company_name)")
        .eq("callback_needed", true).eq("callback_urgent", true).is("callback_done_at", null).order("started_at")
      : null,
  ]);
  if (strict && (error || calls?.error)) throw new Error("Rückrufbitten nicht verfügbar");
  const visits: CallbackAlert[] = error || !data ? [] : data.map(({ technician, ...row }) => ({ ...row, kind: "visit" as const, technician: technician?.display_name ?? null }));
  const urgent: CallbackAlert[] = (calls?.data ?? []).map((row) => {
    const named = row.analysis && typeof row.analysis === "object" && !Array.isArray(row.analysis) ? row.analysis.firma : null;
    return {
      kind: "call" as const,
      id: row.id,
      request_id: row.request_id,
      callback_number: row.callback_number,
      company_name: row.requests?.company_name ?? (typeof named === "string" && named ? named : "Anrufer ohne Firmenangabe"),
      reason: row.callback_reason ?? row.summary ?? "Dringender Anruf",
      created_at: row.started_at,
    };
  });
  return [...urgent, ...visits];
}
