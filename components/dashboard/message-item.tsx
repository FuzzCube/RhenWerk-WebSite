"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// task-25-1: a message keeps how it appeared during the visit. Opening the request marks it read (task-23-2) and the
// refresh that follows would otherwise collapse it and drop the mark a second after it showed up.
export function MessageItem({ id, direction, unread, open, children }: { id: string; direction: string; unread: boolean; open: boolean; children: ReactNode }) {
  const [wasUnread] = useState(unread);
  const [openedAtFirst] = useState(open);
  const details = useRef<HTMLDetailsElement>(null);
  // Becoming open later (e.g. a new draft) opens it; becoming closed is left to the person
  useEffect(() => {
    if (open && details.current) details.current.open = true;
  }, [open]);
  return (
    // Anchor for "Als Entwurf speichern" (task-20-8): the page opens at the new draft, :target marks it
    <li id={`nachricht-${id}`} className={`message message--${direction}${unread || wasUnread ? " message--unread" : ""}`}>
      <details ref={details} open={openedAtFirst}>{children}</details>
    </li>
  );
}
