"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { areasFor, type EmployeeRole } from "@/lib/auth/roles";

// counts: open items per area (e.g. the inbox); shown as a badge next to the label
export function DashboardNav({ role, counts = {} }: { role: EmployeeRole; counts?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav className="dash-nav" aria-label="Dashboard-Navigation">
      <ul>
        {areasFor(role).map((area) => {
          const active = pathname === area.href || pathname.startsWith(`${area.href}/`);
          return (
            <li key={area.href}>
              <Link href={area.href} aria-current={active ? "page" : undefined}>
                {area.label}
                {counts[area.href] ? <span className="dash-nav__count mono" aria-label={`${counts[area.href]} offen`}>{counts[area.href]}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
