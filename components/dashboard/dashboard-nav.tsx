"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { areasFor, type EmployeeRole } from "@/lib/auth/roles";
import { useDashboardUpdates } from "./dashboard-updates";

// counts: open items per area (e.g. the inbox); shown as a single dot next to the label (task-23-2), the area itself
// shows the details
export function DashboardNav({ role }: { role: EmployeeRole }) {
  const pathname = usePathname();
  const { snapshot } = useDashboardUpdates();
  const counts = snapshot?.counts;
  const badges: Record<string, Array<{ count: number; label: string; unread?: boolean }>> = counts ? {
    "/dashboard/posteingang": [{ count: counts.inbox, label: "offene E-Mails" }, { count: counts.failedInbox, label: "Versandfehler", unread: true }],
    "/dashboard/anfragen": [{ count: counts.newRequests, label: "neu zu bearbeiten" }, { count: counts.unreadRequests, label: "Anfragen mit ungelesenen Kundennachrichten", unread: true }, { count: counts.failedRequests, label: "Versandfehler", unread: true }],
    "/dashboard/planung": [{ count: counts.changes, label: "offene Terminwünsche", unread: true }],
    "/dashboard/anrufe": [{ count: snapshot?.callbacks.length ?? 0, label: "Rückrufbitten", unread: true }],
    "/dashboard/heute": [{ count: snapshot?.callbacks.length ?? 0, label: "Rückrufbitten", unread: true }],
    "/dashboard/system": [{ count: snapshot?.systemAlerts.length ?? 0, label: "Systemwarnungen", unread: true }],
  } : {};
  return (
    <nav className="dash-nav" aria-label="Dashboard-Navigation">
      <ul>
        {areasFor(role).map((area) => {
          const active = pathname === area.href || pathname.startsWith(`${area.href}/`);
          return (
            <li key={area.href}>
              <Link href={area.href} aria-current={active ? "page" : undefined}>
                {area.label}
                <NavDot badges={(badges[area.href] ?? []).filter((badge) => badge.count > 0)} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Red if anything is unread or failed, else green. The numbers stay in the tooltip and for screen readers.
function NavDot({ badges }: { badges: Array<{ count: number; label: string; unread?: boolean }> }) {
  if (!badges.length) return null;
  const text = badges.map((badge) => `${badge.count} ${badge.label}`).join(", ");
  return <span className={`dash-nav__dot${badges.some((badge) => badge.unread) ? " dash-nav__dot--unread" : ""}`} title={text}>
    {badges.map((badge) => <span key={badge.label} className="sr-only" data-badge={badge.label} data-count={badge.count}>{badge.count} {badge.label}</span>)}
  </span>;
}
