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

export type ArchiveReason = "advertising" | "supplier" | "application" | "other";

export type InboxMessage = InboxItem & {
  body_text: string;
  // Archived e-mails (task-10-10): reason, person and time
  archived: { at: string; by: string | null; reason: ArchiveReason } | null;
  request: { id: string; request_number: string | null; company_name: string } | null;
  files: Array<{ id: string; file_name: string; mime_type: string; size_bytes: number | null }>;
};

// match: same sender address, same company domain (not for mail providers), or the search term
export type LinkCandidate = { id: string; request_number: string | null; company_name: string; city: string; business_email: string; version: number; intake_status: string; created_at: string; match: "sender" | "domain" | "search" };

export type ArchivedItem = InboxItem & { archived_at: string; archive_reason: ArchiveReason; archived_by: string | null };

export type LinkedItem = { message_id: string; subject: string; request_id: string; request_number: string | null; company_name: string; linked_at: string };

const excerpt = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 140);

// Number of open messages for the navigation; null when the count fails (the badge is then left out)
export async function inboxCount(): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("direction", "incoming").is("request_id", null).is("archived_at", null);
  return error ? null : count ?? 0;
}

export async function listInbox(): Promise<{ rows: InboxItem[]; names: Map<string, string>; error: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, from_address, subject, received_at, inbox_dispatcher_id, body_text, attachments(count)")
    .eq("direction", "incoming")
    .is("request_id", null)
    .is("archived_at", null)
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

// Archived e-mails, newest archive first; names of the people who archived them
export async function listArchived(): Promise<{ rows: ArchivedItem[]; names: Map<string, string>; error: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, from_address, subject, received_at, inbox_dispatcher_id, body_text, archived_at, archive_reason, archived_by, attachments(count)")
    .eq("direction", "incoming")
    .is("request_id", null)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .order("id")
    .limit(200);
  const ids = [...new Set((data ?? []).flatMap((row) => [row.inbox_dispatcher_id, row.archived_by]).filter((id): id is string => !!id))];
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
      archived_at: row.archived_at as string,
      archive_reason: row.archive_reason as ArchiveReason,
      archived_by: row.archived_by,
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
    .select("id, from_address, subject, received_at, inbox_dispatcher_id, body_text, request_id, direction, archived_at, archived_by, archive_reason, attachments(id, file_name, mime_type, size_bytes), requests!messages_request_id_fkey(id, request_number, company_name)")
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
    archived: data.archived_at ? { at: data.archived_at, by: data.archived_by, reason: data.archive_reason as ArchiveReason } : null,
    request: (data.requests as unknown as InboxMessage["request"]) ?? null,
    files,
  };
}

// Mail providers: the same domain says nothing about the company
const PROVIDERS = new Set(["gmail.com", "googlemail.com", "web.de", "gmx.de", "gmx.net", "gmx.at", "outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.de", "live.com", "yahoo.com", "yahoo.de", "t-online.de", "icloud.com", "me.com", "aol.com", "freenet.de", "posteo.de", "mail.de", "arcor.de", "online.de", "email.de", "proton.me", "protonmail.com"]);

export function companyDomain(address: string | null): string | null {
  const domain = address?.split("@")[1]?.trim().toLowerCase();
  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && !PROVIDERS.has(domain) ? domain : null;
}

// Requests to assign a message to: same sender address first, then the same company domain, then the search term
// (number, company, e-mail)
export async function linkCandidates(fromAddress: string | null, term: string): Promise<LinkCandidate[]> {
  const supabase = await createClient();
  const columns = "id, request_number, company_name, city, business_email, version, intake_status, created_at";
  const found = new Map<string, LinkCandidate>();
  if (fromAddress) {
    const { data } = await supabase.from("requests").select(columns).ilike("business_email", fromAddress.replace(/[%_]/g, "")).order("created_at", { ascending: false }).limit(5);
    for (const row of data ?? []) found.set(row.id, { ...row, match: "sender" });
    const domain = companyDomain(fromAddress);
    if (domain) {
      const { data: sameDomain } = await supabase.from("requests").select(columns).ilike("business_email", `%@${domain.replace(/[%_]/g, "")}`).order("created_at", { ascending: false }).limit(5);
      for (const row of sameDomain ?? []) if (!found.has(row.id)) found.set(row.id, { ...row, match: "domain" });
    }
  }
  const q = term.trim().replace(/[%_,()]/g, " ").trim();
  if (q.length >= 2) {
    const { data } = await supabase
      .from("requests")
      .select(columns)
      .or(`request_number.ilike.%${q}%,company_name.ilike.%${q}%,business_email.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of data ?? []) if (!found.has(row.id)) found.set(row.id, { ...row, match: "search" });
  }
  return [...found.values()];
}
