"use client";

import { useEffect, useState, type ReactNode } from "react";
import { markOpenedMessagesRead } from "@/app/(dashboard)/dashboard/anfragen/[id]/actions";
import { useDashboardUpdates } from "./dashboard-updates";

// task-23-2: opening the request counts as reading the customer's new e-mails. The banner listing them stays for this
// visit (also after the refresh that clears the marks); newly arriving e-mails are marked as soon as the page shows them.
export function ReadOnOpen({ requestId, messageIds, children }: { requestId: string; messageIds: string[]; children: ReactNode }) {
  const { poll } = useDashboardUpdates();
  const key = messageIds.join(",");
  const [shown, setShown] = useState({ key, children });
  if (key && key !== shown.key) setShown({ key, children });
  useEffect(() => {
    if (!key) return;
    void markOpenedMessagesRead(requestId).then(poll, () => {});
  }, [key, requestId, poll]);
  return shown.key ? shown.children : null;
}
