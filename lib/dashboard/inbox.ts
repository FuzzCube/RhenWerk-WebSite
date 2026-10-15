import "server-only";
import { conversationState, type ConversationState, type StateRow } from "@/lib/inbox-conversation";
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
  // Conversation state (task-12-3): latest message of the conversation decides
  state: ConversationState;
  last_at: string | null;
};

// One message of an inbox conversation (customer e-mails and our replies), oldest first
export type { ConversationState };
export type ConversationEntry = {
  id: string;
  direction: "incoming" | "outgoing";
  from_address: string | null;
  to_address: string | null;
  subject: string;
  body_text: string;
  at: string;
  status: string;
  author: string | null;
  error_text: string | null;
  files: Array<{ id: string; file_name: string; mime_type: string; size_bytes: number | null }>;
};

export type ArchiveReason = "advertising" | "supplier" | "application" | "other";

export type InboxMessage = InboxItem & {
  body_text: string;
  // Archived e-mails (task-10-10): reason, person and time
  archived: { at: string; by: string | null; reason: ArchiveReason } | null;
  request: { id: string; request_number: string | null; company_name: string } | null;
  files: Array<{ id: string; file_name: string; mime_type: string; size_bytes: number | null }>;
  // Later messages of the conversation (our replies, further customer e-mails), oldest first
  conversation: ConversationEntry[];
};

// match: same sender address, same company domain (not for mail providers), or the search term
export type LinkCandidate = { id: string; request_number: string | null; company_name: string; city: string; business_email: string; version: number; intake_status: string; created_at: string; match: "sender" | "domain" | "search" };

export type ArchivedItem = InboxItem & { archived_at: string; archive_reason: ArchiveReason; archived_by: string | null };

export type LinkedItem = { message_id: string; subject: string; request_id: string; request_number: string | null; company_name: string; linked_at: string };

const excerpt = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 140);

// Later messages of the given roots, grouped by root
async function laterMessages(rootIds: string[]) {
  const byRoot = new Map<string, StateRow[]>();
  if (rootIds.length === 0) return byRoot;
  const supabase = await createClient();
  const { data } = await supabase.from("messages").select("inbox_root_id, direction, status, received_at, created_at").in("inbox_root_id", rootIds);
  for (const row of data ?? []) byRoot.set(row.inbox_root_id!, [...(byRoot.get(row.inbox_root_id!) ?? []), row]);
  return byRoot;
}

// Number of open messages for the navigation; null when the count fails (the badge is then left out)
export async function inboxCount(): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("direction", "incoming").is("request_id", null).is("archived_at", null).is("inbox_root_id", null);
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
    .is("inbox_root_id", null)
    .order("received_at", { ascending: false })
    .order("id")
    .limit(200);
  const ids = [...new Set((data ?? []).map((row) => row.inbox_dispatcher_id).filter((id): id is string => !!id))];
  const [{ data: people }, later] = await Promise.all([
    ids.length ? supabase.from("profiles").select("id, display_name").in("id", ids) : Promise.resolve({ data: [] as Array<{ id: string; display_name: string }> }),
    laterMessages((data ?? []).map((row) => row.id)),
  ]);
  const rows = (data ?? []).map((row) => ({
    id: row.id,
    from_address: row.from_address,
    subject: row.subject,
    received_at: row.received_at,
    inbox_dispatcher_id: row.inbox_dispatcher_id,
    excerpt: excerpt(row.body_text),
    attachments: (row.attachments as unknown as Array<{ count: number }>)?.[0]?.count ?? 0,
    ...conversationState(row.received_at, later.get(row.id) ?? []),
  }));
  // Latest activity first: a customer answer brings the conversation back to the top
  rows.sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));
  return {
    rows,
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
    .is("inbox_root_id", null)
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
      state: "new" as const,
      last_at: row.received_at,
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

// The conversation of a message (task-12-3): a later message opens its root; null when not readable or outgoing
export async function getInboxMessage(id: string): Promise<InboxMessage | null> {
  const supabase = await createClient();
  const columns = "id, from_address, subject, received_at, inbox_dispatcher_id, inbox_root_id, body_text, request_id, direction, archived_at, archived_by, archive_reason, attachments(id, file_name, mime_type, size_bytes), requests!messages_request_id_fkey(id, request_number, company_name)";
  const { data: opened } = await supabase.from("messages").select(columns).eq("id", id).maybeSingle();
  const { data } = opened?.inbox_root_id ? await supabase.from("messages").select(columns).eq("id", opened.inbox_root_id).maybeSingle() : { data: opened };
  if (!data || data.direction !== "incoming") return null;
  const { data: later } = await supabase
    .from("messages")
    .select("id, direction, from_address, to_address, subject, body_text, status, received_at, created_at, inbox_root_id, author_id, error_text, attachments(id, file_name, mime_type, size_bytes), author:profiles!messages_author_id_fkey(display_name)")
    .eq("inbox_root_id", data.id)
    .order("created_at");
  const files = (data.attachments ?? []) as InboxMessage["files"];
  const conversation = (later ?? [])
    .map((row) => ({
      id: row.id,
      direction: row.direction as ConversationEntry["direction"],
      from_address: row.from_address,
      to_address: row.to_address,
      subject: row.subject,
      body_text: row.body_text,
      at: row.received_at ?? row.created_at,
      status: row.status,
      author: (row.author as unknown as { display_name: string } | null)?.display_name ?? null,
      error_text: row.error_text,
      files: (row.attachments ?? []) as ConversationEntry["files"],
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return {
    id: data.id,
    from_address: data.from_address,
    subject: data.subject,
    received_at: data.received_at,
    inbox_dispatcher_id: data.inbox_dispatcher_id,
    excerpt: excerpt(data.body_text),
    attachments: files.length,
    ...conversationState(data.received_at, later ?? []),
    body_text: data.body_text,
    archived: data.archived_at ? { at: data.archived_at, by: data.archived_by, reason: data.archive_reason as ArchiveReason } : null,
    request: (data.requests as unknown as InboxMessage["request"]) ?? null,
    files,
    conversation,
  };
}

// Mail providers: the same domain says nothing about the company
const PROVIDERS = new Set(["gmail.com", "googlemail.com", "web.de", "gmx.de", "gmx.net", "gmx.at", "outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.de", "live.com", "yahoo.com", "yahoo.de", "t-online.de", "icloud.com", "me.com", "aol.com", "freenet.de", "posteo.de", "mail.de", "arcor.de", "online.de", "email.de", "proton.me", "protonmail.com"]);

export function companyDomain(address: string | null): string | null {
  const domain = address?.split("@")[1]?.trim().toLowerCase();
  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && !PROVIDERS.has(domain) ? domain : null;
}

// Requests to assign a message to: same sender address first, then the same company domain, then the search term
// (number, company, city, e-mail)
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
      .or(`request_number.ilike.%${q}%,company_name.ilike.%${q}%,city.ilike.%${q}%,business_email.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of data ?? []) if (!found.has(row.id)) found.set(row.id, { ...row, match: "search" });
  }
  return [...found.values()];
}
