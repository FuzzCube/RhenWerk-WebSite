import type { Metadata } from "next";
import { createEmployee } from "@/app/(dashboard)/dashboard/verwaltung/actions";
import { ActiveFilter, showsInactive } from "@/components/dashboard/active-filter";
import { AdminShell } from "@/components/dashboard/admin-nav";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { SaveForm, SelectField, TextField } from "@/components/dashboard/ui/save-form";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { MIN_PASSWORD_LENGTH, summarizeWorkingHours } from "@/lib/admin";
import { EMPLOYEE_ROLES, ROLE_LABELS, rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { listEmployees, type EmployeeListItem } from "@/lib/dashboard/admin";
import { EMPTY, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Verwaltung" };

const roleOptions = EMPLOYEE_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

// Employees (task-8-1). Accounts are created only here; there is no public registration.
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(rolesFor("/dashboard/verwaltung"));
  const [{ rows, error }, all] = await Promise.all([listEmployees(), searchParams.then(showsInactive)]);
  const activeCount = rows.filter((row) => row.is_active).length;

  const columns: Column<EmployeeListItem>[] = [
    { key: "name", header: "Name", cell: (row) => <>{row.display_name}<span className="cell-sub">{row.email ?? EMPTY}</span></>, mobile: "title" },
    { key: "role", header: "Rolle", cell: (row) => ROLE_LABELS[row.role] },
    { key: "status", header: "Status", cell: (row) => <StatusBadge kind="profile_active" value={row.is_active} /> },
    { key: "hours", header: "Arbeitszeiten", cell: (row) => (row.role === "technician" ? summarizeWorkingHours(row.workingHours) : EMPTY), mobile: "hide" },
    { key: "login", header: "Letzte Anmeldung", cell: (row) => (row.lastSignInAt ? formatDateTime(row.lastSignInAt) : "Noch nie"), mobile: "hide" },
  ];

  return (
    <AdminShell current="mitarbeitende" title="Mitarbeitende" count={activeCount} description="Konten, Rollen und Anmeldung. Mitarbeitende werden deaktiviert, nicht gelöscht; ihre Historie bleibt erhalten.">

      <details className="action">
        <summary>Mitarbeitende anlegen</summary>
        <p className="section-note">
          Es gibt keine öffentliche Registrierung: Konten entstehen nur hier. Das Startpasswort wird ausschließlich in Supabase Auth
          gespeichert, nicht im Profil. Bitte auf sicherem Weg weitergeben.
        </p>
        <SaveForm action={createEmployee} submitLabel="Konto anlegen">
          <div className="form-grid">
            <TextField name="display_name" label="Name" required />
            <TextField name="email" label="E-Mail-Adresse (Anmeldung)" type="email" required autoComplete="off" />
            <SelectField name="role" label="Rolle" required options={roleOptions} />
            <TextField name="password" label="Startpasswort" type="password" required autoComplete="new-password" hint={`Mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`} />
          </div>
        </SaveForm>
      </details>

      {error && rows.length === 0 ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
      ) : (
        <>
          {error && <p className="request-alert request-alert--info">Anmeldedaten (E-Mail, letzte Anmeldung) konnten nicht geladen werden.</p>}
          <div className="side-page__list">
            <div className="side-page__list-bar">
              {rows.length > 0 && <ActiveFilter basePath="/dashboard/verwaltung" all={all} active={activeCount} total={rows.length} label="Mitarbeitende anzeigen" />}
              <span>Zeile öffnen für Stammdaten, Arbeitszeiten und Deaktivierung</span>
            </div>
            <DataTable
              caption="Mitarbeitende"
              columns={columns}
              rows={all ? rows : rows.filter((row) => row.is_active)}
              rowKey={(row) => row.id}
              rowHref={(row) => `/dashboard/verwaltung/mitarbeitende/${row.id}`}
              empty={<EmptyState title={rows.length === 0 ? "Noch keine Mitarbeitenden." : "Keine aktiven Mitarbeitenden."} />}
            />
          </div>
        </>
      )}
    </AdminShell>
  );
}
