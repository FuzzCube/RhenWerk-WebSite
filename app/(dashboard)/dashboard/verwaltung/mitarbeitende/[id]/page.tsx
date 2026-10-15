import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addAbsence, deactivateEmployee, deleteAbsence, reactivateEmployee, setEmployeePassword, saveWorkingHours, updateEmployee } from "@/app/(dashboard)/dashboard/verwaltung/actions";
import { AdminShell } from "@/components/dashboard/admin-nav";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { CheckboxField, HiddenField, SaveForm, SelectField, TextField } from "@/components/dashboard/ui/save-form";
import { EmptyState } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { ASSIGNMENT_LABELS, WEEKDAYS } from "@/lib/admin";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { EMPLOYEE_ROLES, ROLE_LABELS, rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getEmployee, type Assignment } from "@/lib/dashboard/admin";
import { EMPTY, formatDate, formatDateTime, formatTimeRange } from "@/lib/format";
import { statusInfo } from "@/lib/status";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Mitarbeitende" };

const roleOptions = EMPLOYEE_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// One employee (task-8-1): name and role, weekly hours, absences, active assignments, deactivation
export default async function EmployeePage({ params, searchParams }: Props) {
  const admin = await requireRole(rolesFor("/dashboard/verwaltung"));
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const detail = await getEmployee(id);
  if (!detail) notFound();

  const { profile, login, workingHours, absences, assignments, replacements } = detail;
  const self = profile.id === admin.id;
  const running = assignments.some((item) => item.visit_status === "in_progress");
  const hoursByDay = new Map(workingHours.map((row) => [row.weekday, row]));
  const result = one(query.ergebnis);

  const assignmentColumns: Column<Assignment>[] = [
    { key: "request", header: "Anfrage", cell: (row) => <><span className="mono">{row.request_number}</span><span className="cell-sub">{row.company_name}</span></>, mobile: "title" },
    { key: "kind", header: "Zuweisung", cell: (row) => ASSIGNMENT_LABELS[row.assignment] ?? row.assignment },
    { key: "visit", header: "Einsatz", cell: (row) => (row.visit_id ? <>{formatTimeRange(row.scheduled_start, row.scheduled_end)}<span className="cell-sub">{statusInfo("visit_status", row.visit_status).label}</span></> : EMPTY) },
  ];

  return (
    <AdminShell
      current="mitarbeitende"
      title={profile.display_name}
      description={<>{ROLE_LABELS[profile.role]} · {login?.email ?? "Keine Anmeldedaten"} · Letzte Anmeldung: {login?.lastSignInAt ? formatDateTime(login.lastSignInAt) : "noch nie"}</>}
      actions={<StatusBadge kind="profile_active" value={profile.is_active} />}
    >
      <p><Link href="/dashboard/verwaltung">← Alle Mitarbeitenden</Link></p>

      {one(query.angelegt) === "1" && <p className="notice" role="status">Konto angelegt. {profile.role === "technician" ? "Bitte jetzt die Arbeitszeiten festlegen, sonst kann der Techniker nicht eingeplant werden." : ""}</p>}
      {result === "deaktiviert" && (
        <p className="notice" role="status">
          Deaktiviert. Neu zugewiesen: {one(query.anfragen) || "0"} Anfragen, {one(query.einsaetze) || "0"} Einsätze{Number(one(query.posteingang)) > 0 ? `, ${one(query.posteingang)} E-Mails im Posteingang` : ""}.
          {one(query.sperre) === "fehlgeschlagen" ? " Die Anmeldung konnte nicht gesperrt werden; ohne aktives Profil sind aber keine Daten zugänglich." : " Die Anmeldung ist gesperrt."}
        </p>
      )}
      {result === "aktiviert" && (
        <p className="notice" role="status">
          Wieder aktiv.{one(query.sperre) === "fehlgeschlagen" ? " Die Anmeldung konnte nicht freigegeben werden – bitte erneut aktivieren." : " Die Anmeldung ist freigegeben."}
        </p>
      )}

      <section className="request-section" aria-labelledby="stammdaten-title">
        <h2 id="stammdaten-title">Name und Rolle</h2>
        <p className="section-note">
          {self ? "Die eigene Rolle kann nicht geändert werden, damit immer ein Admin verbleibt." : "Eine Rollenänderung ist nur ohne aktive Zuweisungen möglich."}
        </p>
        <SaveForm action={updateEmployee}>
          <HiddenField name="employee_id" value={profile.id} />
          <div className="form-grid">
            <TextField name="display_name" label="Name" required defaultValue={profile.display_name} />
            <SelectField name="role" label="Rolle" required defaultValue={profile.role} options={roleOptions} />
          </div>
        </SaveForm>
      </section>

      {profile.role === "technician" && (
        <section className="request-section" aria-labelledby="arbeitszeiten-title">
          <h2 id="arbeitszeiten-title">Arbeitszeiten</h2>
          <p className="section-note">Wöchentliche Zeitfenster (Europe/Berlin). Einsätze werden nur innerhalb dieser Zeiten geplant; Änderungen, die einen geplanten Einsatz ungültig machen, werden abgewiesen.</p>
          <SaveForm action={saveWorkingHours} submitLabel="Arbeitszeiten speichern">
            <HiddenField name="employee_id" value={profile.id} />
            <fieldset className="hours-grid">
              <legend className="sr-only">Arbeitstage</legend>
              {WEEKDAYS.map(({ day, label }) => {
                const row = hoursByDay.get(day);
                return (
                  <div key={day} className="hours-grid__row">
                    <CheckboxField name={`day_${day}`} label={label} defaultChecked={Boolean(row)} />
                    <TextField name={`day_${day}_start`} label="Beginn" type="time" defaultValue={row?.local_start?.slice(0, 5) ?? "07:00"} />
                    <TextField name={`day_${day}_end`} label="Ende" type="time" defaultValue={row?.local_end?.slice(0, 5) ?? "16:00"} />
                  </div>
                );
              })}
            </fieldset>
          </SaveForm>
        </section>
      )}

      <section className="request-section" aria-labelledby="abwesenheiten-title">
        <h2 id="abwesenheiten-title">Abwesenheiten</h2>
        {absences.length === 0 ? (
          <EmptyState title="Keine aktuellen Abwesenheiten." />
        ) : (
          <ul className="absence-list">
            {absences.map((absence) => (
              <li key={absence.id}>
                <span><strong>{formatDate(absence.starts_at)} – {formatDate(new Date(new Date(absence.ends_at as string).getTime() - 1))}</strong>{absence.label ? ` · ${absence.label}` : ""}</span>
                <SaveForm action={deleteAbsence} submitLabel="Entfernen" submitVariant="secondary" className="save-form--inline">
                  <HiddenField name="absence_id" value={absence.id} />
                </SaveForm>
              </li>
            ))}
          </ul>
        )}
        <details className="action">
          <summary>Abwesenheit eintragen</summary>
          <p className="section-note">Ganze Tage. Überschneidet sich der Zeitraum mit einem geplanten Einsatz, muss dieser zuerst umgeplant werden.</p>
          <SaveForm action={addAbsence} submitLabel="Eintragen" resetOnSuccess>
            <HiddenField name="employee_id" value={profile.id} />
            <div className="form-grid">
              <TextField name="from" label="Von" type="date" required />
              <TextField name="to" label="Bis einschließlich" type="date" required />
              <TextField name="label" label="Grund" hint="z. B. Urlaub, Schulung" />
            </div>
          </SaveForm>
        </details>
      </section>

      <section className="request-section" aria-labelledby="zuweisungen-title">
        <h2 id="zuweisungen-title">Aktive Zuweisungen</h2>
        <DataTable
          caption="Aktive Zuweisungen"
          columns={assignmentColumns}
          rows={assignments}
          rowKey={(row) => `${row.assignment}-${row.request_id}-${row.visit_id ?? ""}`}
          rowHref={(row) => `/dashboard/anfragen/${row.request_id}`}
          empty={<EmptyState title="Keine offenen Anfragen oder geplanten Einsätze." />}
        />
      </section>

      {profile.is_active && (
        <section className="request-section" aria-labelledby="passwort-title">
          <h2 id="passwort-title">Passwort</h2>
          {self ? (
            <p className="section-note">Das eigene Passwort ändern Sie unter <Link href="/dashboard/konto">Mein Konto</Link>.</p>
          ) : (
            <>
              <p className="section-note">
                Für vergessene Passwörter, wenn kein Link per E-Mail möglich ist: ein vorläufiges Passwort setzen (mindestens {MIN_PASSWORD_LENGTH} Zeichen) und der Person persönlich mitteilen.
                Sie kann es danach unter „Mein Konto“ ändern. Das Passwort wird nicht gespeichert und nicht angezeigt.
              </p>
              <SaveForm action={setEmployeePassword} submitLabel="Neues Passwort setzen" submitVariant="secondary" resetOnSuccess>
                <HiddenField name="employee_id" value={profile.id} />
                <div className="form-grid">
                  <TextField name="password" label="Neues Passwort" type="password" autoComplete="new-password" required />
                  <TextField name="password_repeat" label="Neues Passwort wiederholen" type="password" autoComplete="new-password" required />
                </div>
              </SaveForm>
            </>
          )}
        </section>
      )}

      {profile.is_active && !self && (
        <section className="request-section" aria-labelledby="deaktivieren-title">
          <h2 id="deaktivieren-title">Deaktivieren</h2>
          <p className="section-note">
            Das Konto wird gesperrt und das Profil deaktiviert, nicht gelöscht: Verlauf, Einsätze und Rechnungen behalten den Namen.
            {assignments.length > 0 && " Die aktiven Zuweisungen oben gehen dabei in einem Schritt an die gewählte Vertretung; geplante Einsätze müssen in deren Arbeitszeit passen."}
          </p>
          {running ? (
            <p className="request-alert">Ein Einsatz läuft gerade. Er muss erst abgeschlossen werden, bevor das Konto deaktiviert werden kann.</p>
          ) : assignments.length > 0 && replacements.length === 0 ? (
            <p className="request-alert">Es gibt keine andere aktive Person mit der Rolle {ROLE_LABELS[profile.role]}. Bitte zuerst eine Vertretung anlegen.</p>
          ) : (
            <SaveForm action={deactivateEmployee} submitLabel="Deaktivieren" submitVariant="danger">
              <HiddenField name="employee_id" value={profile.id} />
              {assignments.length > 0 && (
                <>
                  <HiddenField name="needs_replacement" value="1" />
                  <div className="form-grid">
                    <SelectField name="replacement_id" label={`Neuzuweisung an (${assignments.length} Zuweisungen)`} required options={replacements.map((person) => ({ value: person.id, label: person.display_name }))} />
                  </div>
                </>
              )}
            </SaveForm>
          )}
        </section>
      )}

      {!profile.is_active && (
        <section className="request-section" aria-labelledby="aktivieren-title">
          <h2 id="aktivieren-title">Wieder aktivieren</h2>
          <p className="section-note">Gibt die Anmeldung frei. Zuweisungen werden nicht automatisch zurückübertragen.</p>
          <SaveForm action={reactivateEmployee} submitLabel="Aktivieren" submitVariant="secondary">
            <HiddenField name="employee_id" value={profile.id} />
          </SaveForm>
        </section>
      )}
    </AdminShell>
  );
}
