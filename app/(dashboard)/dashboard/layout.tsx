import type { Metadata } from "next";
import Link from "next/link";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { DashboardAlertBanners, DashboardUpdates } from "@/components/dashboard/dashboard-updates";
import { Logo } from "@/components/ui";
import { logout } from "@/lib/auth/actions";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireEmployee } from "@/lib/auth/session";
import { loadDashboardSnapshot } from "@/lib/dashboard/notifications";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s | RheinWerk Dashboard" },
  robots: { index: false, follow: false },
};

// Shell only. Every page checks access itself (requireEmployee/requireRole), because layouts
// are not re-rendered on client navigation.
export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const employee = await requireEmployee();
  // A temporary read failure must not prevent opening the dashboard. The first successful poll then establishes
  // a silent baseline; no historical popup flood and no invented zero counts.
  const initial = await loadDashboardSnapshot(employee).catch(() => null);
  return (
    <DashboardUpdates initial={initial} employeeId={employee.id}>
    <div className="dash-shell">
      <a className="skip-link" href="#dash-main">Zum Inhalt springen</a>
      <header className="dash-header">
        <div className="dash-header__inner">
          <Link href="/dashboard" aria-label="Dashboard-Startseite"><Logo compact inverse /></Link>
          <Link className="dash-user" href="/dashboard/konto" title="Mein Konto">
            <span className="dash-user__name">{employee.displayName}</span>
            <span className="dash-user__role">{ROLE_LABELS[employee.role]}</span>
          </Link>
          <form action={logout}>
            <button className="dash-logout" type="submit">Abmelden</button>
          </form>
        </div>
        <DashboardNav role={employee.role} />
      </header>
      <main id="dash-main" className="dash-main">
        <DashboardAlertBanners />
        {children}
      </main>
    </div>
    </DashboardUpdates>
  );
}
