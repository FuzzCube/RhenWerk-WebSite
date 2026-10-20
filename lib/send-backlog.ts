import { formatElapsed } from "./format";

// Hint for e-mails that n8n should have sent (task-12-9). Pure, so the unit tests can check it.
export type SendBacklog = { waiting: number; oldestAt: string | null };

export function sendBacklogText(backlog: SendBacklog, now: Date): string | null {
  if (backlog.waiting <= 0 || !backlog.oldestAt) return null;
  const minutes = (now.getTime() - new Date(backlog.oldestAt).getTime()) / 60_000;
  const mails = backlog.waiting === 1 ? "1 E-Mail wartet" : `${backlog.waiting} E-Mails warten`;
  return `${mails} seit ${formatElapsed(Math.max(0, minutes))} auf den Versand.`;
}
