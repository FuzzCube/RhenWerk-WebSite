import { openHoldStarts } from "@/lib/dashboard/requests";
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { PAGE_SIZE } from "./requests";

// Dispatcher work queues from the view public.dispatcher_queue (rules and sorting documented in the migration).
// The view runs with the caller's rights; the page additionally restricts to the signed-in dispatcher.
export type QueueRow = Database["public"]["Views"]["dispatcher_queue"]["Row"];
export type QueueKey = "review" | "reply_received" | "planning" | "awaiting_customer";

export const QUEUE_TABS = [
  { slug: "pruefung", queue: "review", label: "Prüfung erforderlich", empty: "Keine Anfragen zur Prüfung." },
  { slug: "antwort", queue: "reply_received", label: "Kundenantwort erhalten", empty: "Keine neuen Kundenantworten." },
  { slug: "planung", queue: "planning", label: "Einsatzplanung erforderlich", empty: "Alle Anfragen sind eingeplant." },
  { slug: "warten", queue: "awaiting_customer", label: "Warten auf Kundenantwort", empty: "Keine Anfragen warten auf den Kunden." },
  { slug: "alle", queue: null, label: "Alle meine Anfragen", empty: "Ihnen sind keine Anfragen zugewiesen." },
] as const;

export type QueueTab = (typeof QUEUE_TABS)[number];

export function tabFor(slug: string | undefined): QueueTab {
  return QUEUE_TABS.find((tab) => tab.slug === slug) ?? QUEUE_TABS[0];
}

export type QueueData = {
  counts: Record<QueueKey, number>;
  rows: QueueRow[];
  total: number;
  now: number;
  // Open window holds of the phone assistant per request (task-13-3)
  holds: Map<string, string>;
  error: boolean;
};

export async function loadQueue(dispatcherId: string, tab: QueueTab, page: number): Promise<QueueData> {
  const supabase = await createClient();
  const now = Date.now();
  const countsQuery = supabase.from("dispatcher_queue").select("queue").eq("dispatcher_id", dispatcherId).not("queue", "is", null);
  const from = (page - 1) * PAGE_SIZE;
  const rowsQuery = tab.queue
    ? supabase.from("dispatcher_queue").select("*", { count: "exact" }).eq("dispatcher_id", dispatcherId).eq("queue", tab.queue)
        .order("priority_rank").order("due_at", { ascending: true, nullsFirst: false }).order("waiting_since").order("id")
    : supabase.from("dispatcher_queue").select("*", { count: "exact" }).eq("dispatcher_id", dispatcherId)
        .order("created_at", { ascending: false }).order("id").range(from, from + PAGE_SIZE - 1);
  const [counts, rows] = await Promise.all([countsQuery, rowsQuery]);

  const result: Record<QueueKey, number> = { review: 0, reply_received: 0, planning: 0, awaiting_customer: 0 };
  for (const row of counts.data ?? []) result[row.queue as QueueKey] += 1;
  const error = Boolean(counts.error || (rows.error && rows.error.code !== "PGRST103"));
  const holds = await openHoldStarts((rows.data ?? []).map((row) => row.id).filter((id): id is string => !!id));
  return { counts: result, rows: rows.data ?? [], total: rows.count ?? 0, now, holds, error };
}
