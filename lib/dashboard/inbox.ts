import "server-only";
import { createClient } from "@/lib/supabase/server";

// Inbox of unmatched incoming e-mails (task-10-5). All reads use the user's rights: RLS (can_read_message) shows a
// dispatcher only their own inbox, manager and admin every inbox, technicians nothing.
export type InboxItem = {
  id: string;
  from_address: string | null;
  subject: string;
  received_at: string | null;
  inbox_dispatcher_id: string | null;
  excerpt: string;
  attachments: number;
};

export type InboxMessage = InboxItem & {
  body_text: string;
  request: { id: string; request_number: string | null; company_name: string } | null;
  files: Array<{ id: string; file_name: string; mime_type: string; size_bytes: number | null }>;
};

export type LinkCandidate = { id: string; request_number: string | null; company_name: string; city: string; business_email: string; version: number; intake_status: string; created_at: string };

export type LinkedItem = { message_id: string; subject: string; request_id: string; request_number: string | null; company_name: string; linked_at: string };

const excerpt = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 140);

// Number of open messages for the navigation; null when the count fails (the badge is then left out)
export async function inboxCount(): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("direction", "incoming").is("request_id", null);
  return error ? null : count ?? 0;
}

export async function listInbox(): Promise<{ rows: InboxItem[]; names: Map<string, string>; error: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, from_address, subject, received_at, inbox_dispatcher_id, body_text, attachments(count)")
    .eq("direction", "incoming")
    .is("request_id", null)
    .order("received_at", { ascending: false })
    .order("id")
    .limit(200);
  const ids = [...new Set((data ?? []).map((row) => row.inbox_dispatcher_id).filter((id): id is string => !!id))];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      from_address: row.from_address,
      subject: row.subject,
      received_at: row.received_at,
      inbox_dispatcher_id: row.inbox_dispatcher_id,
      excerpt: excerpt(row.body_text),
      attachments: (row.attachments as unknown as Array<{ count: number }>)?.[0]?.count ?? 0,
    })),
    names: new Map((people ?? []).map((person) => [person.id, person.display_name])),
    error: !!error,
  };
}

// Messages assigned from the inbox in the last 14 days (event message_linked of readable requests)
export async function listLinked(): Promise<{ rows: LinkedItem[]; error: boolean }> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await supabase
    .from("request_events")
    .select("request_id, created_at, data, requests!inner(request_number, company_name)")
    .eq("event_type", "message_linked")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);
  return {
    rows: (data ?? []).map((row) => {
      const payload = (row.data ?? {}) as Record<string, unknown>;
      const request = row.requests as unknown as { request_number: string | null; company_name: string };
      return {
        message_id: String(payload.message_id ?? ""),
        subject: String(payload.subject ?? ""),
        request_id: row.request_id,
        request_number: request.request_number,
        company_name: request.company_name,
        linked_at: row.created_at,
      };
    }),
    error: !!error,
  };
}

export async function getInboxMessage(id: string): Promise<InboxMessage | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("id, from_address, subject, received_at, inbox_dispatcher_id, body_text, request_id, direction, attachments(id, file_name, mime_type, size_bytes), requests!messages_request_id_fkey(id, request_number, company_name)")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.direction !== "incoming") return null;
  const files = (data.attachments ?? []) as InboxMessage["files"];
  return {
    id: data.id,
    from_address: data.from_address,
    subject: data.subject,
    received_at: data.received_at,
    inbox_dispatcher_id: data.inbox_dispatcher_id,
    excerpt: excerpt(data.body_text),
    attachments: files.length,
    body_text: data.body_text,
    request: (data.requests as unknown as InboxMessage["request"]) ?? null,
    files,
  };
}

// Requests to assign a message to: same sender address first, then the search term (number, company, e-mail)
export async function linkCandidates(fromAddress: string | null, term: string): Promise<LinkCandidate[]> {
  const supabase = await createClient();
  const columns = "id, request_number, company_name, city, business_email, version, intake_status, created_at";
  const found = new Map<string, LinkCandidate>();
  if (fromAddress) {
    const { data } = await supabase.from("requests").select(columns).ilike("business_email", fromAddress.replace(/[%_]/g, "")).order("created_at", { ascending: false }).limit(5);
    for (const row of data ?? []) found.set(row.id, row);
  }
  const q = term.trim().replace(/[%_,()]/g, " ").trim();
  if (q.length >= 2) {
    const { data } = await supabase
      .from("requests")
      .select(columns)
      .or(`request_number.ilike.%${q}%,company_name.ilike.%${q}%,business_email.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of data ?? []) found.set(row.id, row);
  }
  return [...found.values()];
}
