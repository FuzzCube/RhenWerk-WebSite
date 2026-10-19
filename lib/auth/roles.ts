// Roles and dashboard areas. Shared by server (access checks) and client (navigation); contains no secrets.
// The UI only hides what a role cannot use; data access is enforced by RLS and the database operations.
export const EMPLOYEE_ROLES = ["admin", "manager", "dispatcher", "technician"] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const ROLE_LABELS: Record<EmployeeRole, string> = {
  admin: "Admin",
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Techniker",
};

export type DashboardArea = {
  href: string;
  label: string;
  roles: readonly EmployeeRole[];
};

// Order = order in the navigation
export const DASHBOARD_AREAS: readonly DashboardArea[] = [
  { href: "/dashboard/uebersicht", label: "Übersicht", roles: ["manager", "admin"] },
  { href: "/dashboard/auswertung", label: "Auswertung", roles: ["manager", "admin"] },
  { href: "/dashboard/erstbearbeitung", label: "Erstbearbeitung", roles: ["dispatcher"] },
  { href: "/dashboard/heute", label: "Mein Tag", roles: ["technician"] },
  { href: "/dashboard/kalender", label: "Kalender", roles: ["technician"] },
  { href: "/dashboard/planung", label: "Einsatzplanung", roles: ["dispatcher", "manager"] },
  { href: "/dashboard/anfragen", label: "Anfragen", roles: ["admin", "manager", "dispatcher", "technician"] },
  { href: "/dashboard/kunden", label: "Kunden", roles: ["dispatcher", "manager", "admin"] },
  { href: "/dashboard/posteingang", label: "Posteingang", roles: ["dispatcher", "manager", "admin"] },
  { href: "/dashboard/rechnungen", label: "Rechnungen", roles: ["manager", "admin"] },
  { href: "/dashboard/verwaltung", label: "Verwaltung", roles: ["admin"] },
];

const START_PAGES: Record<EmployeeRole, string> = {
  admin: "/dashboard/verwaltung",
  manager: "/dashboard/uebersicht",
  dispatcher: "/dashboard/erstbearbeitung",
  technician: "/dashboard/heute",
};

export function isEmployeeRole(value: unknown): value is EmployeeRole {
  return typeof value === "string" && (EMPLOYEE_ROLES as readonly string[]).includes(value);
}

export function startPageFor(role: EmployeeRole): string {
  return START_PAGES[role];
}

export function areasFor(role: EmployeeRole): DashboardArea[] {
  return DASHBOARD_AREAS.filter((area) => area.roles.includes(role));
}

export function rolesFor(href: string): readonly EmployeeRole[] {
  const area = DASHBOARD_AREAS.find((item) => item.href === href);
  if (!area) throw new Error(`Unbekannter Dashboard-Bereich ${href}`);
  return area.roles;
}
