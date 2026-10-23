// Unread customer messages (task-20-14): shown on the planning board, in the request list and on the request page
// until staff mark them as read. Mirrors the database view public.request_unread_messages.
export type UnreadInfo = { count: number; latestAt: string | null };

export const unreadText = (count: number) => (count === 1 ? "1 ungelesene Nachricht vom Kunden" : `${count} ungelesene Nachrichten vom Kunden`);

type MessageLike = { direction: string; staff_read_at: string | null; archived_at: string | null; received_at: string | null; created_at: string };

// An incoming message that staff have not read and that arrived after the request was created (the e-mail a request
// was created from is not "new")
export function isUnreadMessage(message: MessageLike, requestCreatedAt: string): boolean {
  return message.direction === "incoming" && message.staff_read_at === null && message.archived_at === null
    && Date.parse(message.received_at ?? message.created_at) > Date.parse(requestCreatedAt);
}
