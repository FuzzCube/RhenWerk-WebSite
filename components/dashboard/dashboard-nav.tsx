"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { areasFor, type EmployeeRole } from "@/lib/auth/roles";
import { useDashboardUpdates } from "./dashboard-updates";

// counts: open items per area (e.g. the inbox); shown as a badge next to the label
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
                {(badges[area.href] ?? []).filter((badge) => badge.count > 0).map((badge) => (
                  <span key={badge.label} className={`dash-nav__count mono${badge.unread ? " dash-nav__count--unread" : ""}`}
                    data-badge={badge.label} title={`${badge.count} ${badge.label}`} aria-label={`${badge.count} ${badge.label}`}>
                    {badge.count}{area.href === "/dashboard/anfragen" && <span className="dash-nav__count-label">{badge.label === "neu zu bearbeiten" ? " neu" : badge.label === "Versandfehler" ? " Fehler" : badge.count === 1 ? " Antwort" : " Antworten"}</span>}
                  </span>
                ))}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
