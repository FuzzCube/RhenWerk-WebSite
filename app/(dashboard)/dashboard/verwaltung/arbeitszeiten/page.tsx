import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/dashboard/admin-nav";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { summarizeWorkingHours } from "@/lib/admin";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { listAvailability, type Availability } from "@/lib/dashboard/admin";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Arbeitszeiten" };

type Row = { id: string; name: string; hours: Availability[]; absences: Availability[] };

const lastDay = (end: string | null) => formatDate(new Date(new Date(end as string).getTime() - 1));

// Weekly hours and upcoming absences of all active technicians (task-8-1); edited per employee
export default async function WorkingHoursPage() {
  await requireRole(rolesFor("/dashboard/verwaltung"));
  const data = await listAvailability();

  const rows: Row[] = (data?.technicians ?? []).map((technician) => ({
    id: technician.id,
    name: technician.display_name,
    hours: data?.rows.filter((row) => row.employee_id === technician.id && row.kind === "working_hours") ?? [],
    absences: data?.rows.filter((row) => row.employee_id === technician.id && row.kind === "absence") ?? [],
  }));
  const columns: Column<Row>[] = [
    { key: "name", header: "Techniker", cell: (row) => row.name, mobile: "title" },
    { key: "hours", header: "Wöchentliche Arbeitszeit", cell: (row) => summarizeWorkingHours(row.hours) },
    {
      key: "absences",
      header: "Kommende Abwesenheiten",
      cell: (row) => (row.absences.length === 0 ? "Keine" : row.absences.map((absence) => `${formatDate(absence.starts_at)} – ${lastDay(absence.ends_at)}${absence.label ? ` (${absence.label})` : ""}`).join("; ")),
    },
  ];

  return (
    <AdminShell current="arbeitszeiten" title="Arbeitszeiten" count={rows.length} description="Grundlage der Einsatzplanung: Einsätze passen nur in die Arbeitszeit und nicht in eine Abwesenheit.">
      {!data ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
      ) : (
        <div className="side-page__list">
          <div className="side-page__list-bar">
            <p className="result-count"><strong>{rows.length === 1 ? "1 aktiver Techniker" : `${rows.length} aktive Techniker`}</strong></p>
            <span>Bearbeiten über die Person</span>
          </div>
          <DataTable
            caption="Arbeitszeiten der Techniker"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/dashboard/verwaltung/mitarbeitende/${row.id}#arbeitszeiten-title`}
            empty={<EmptyState title="Keine aktiven Techniker."><p><Link href="/dashboard/verwaltung">Mitarbeitende anlegen</Link></p></EmptyState>}
          />
        </div>
      )}
    </AdminShell>
  );
}
