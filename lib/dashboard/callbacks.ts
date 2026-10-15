import "server-only";
import type { EmployeeRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

// Callback requests of the phone assistant (task-13-4) shown as dashboard notification. RLS decides who reads a row:
// the technician their own, a dispatcher escalations addressed to them or to all dispatchers. Dispatchers are only
// notified after escalation; manager and admin get no notification.
export type CallbackAlert = {
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

export async function loadCallbackAlerts(role: EmployeeRole): Promise<CallbackAlert[]> {
  if (role !== "technician" && role !== "dispatcher") return [];
  const supabase = await createClient();
  let query = supabase
    .from("callback_requests")
    .select("id, request_id, visit_id, callback_number, company_name, site, scheduled_start, created_at, escalated_at, technician:profiles!callback_requests_technician_id_fkey(display_name)")
    .eq("status", "open")
    .order("created_at");
  if (role === "dispatcher") query = query.not("escalated_at", "is", null);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(({ technician, ...row }) => ({ ...row, technician: technician?.display_name ?? null }));
}
