import "server-only";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Customer master data (task-13-10), read with the user's rights (RLS: dispatcher, manager, admin). Request
// counts and lists follow the request RLS, so a dispatcher sees only the requests assigned to them.
type Tables = Database["public"]["Tables"];
export type Customer = Tables["customers"]["Row"];
export type CustomerSite = Tables["customer_sites"]["Row"];
// Request the customer was created from (task-14-4); null when manual, or when the request is not visible to the user
export type CustomerOrigin = { id: string; request_number: string } | null;
export type CustomerListItem = Customer & { sites: CustomerSite[]; requestCount: number; origin: CustomerOrigin };
export type CustomerRequest = Pick<Tables["requests"]["Row"], "id" | "request_number" | "created_at" | "intake_status" | "work_status" | "service_kind" | "equipment_kind" | "street_house_number" | "city" | "customer_site_id">;

export const CUSTOMER_VIEWS = [
  { key: "aktiv", label: "Aktive Kunden" },
  { key: "inaktiv", label: "Inaktive Kunden" },
  { key: "alle", label: "Alle Kunden" },
] as const;
export type CustomerView = (typeof CUSTOMER_VIEWS)[number]["key"];

export const CUSTOMER_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCustomerFilters(query: Record<string, string | string[] | undefined>) {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const view = CUSTOMER_VIEWS.some((item) => item.key === one(query.ansicht)) ? (one(query.ansicht) as CustomerView) : "aktiv";
  const page = Math.max(1, Number.parseInt(one(query.seite), 10) || 1);
  return { q: one(query.suche).trim().slice(0, 80), view, page };
}
export type CustomerFilters = ReturnType<typeof parseCustomerFilters>;

// Search term for PostgREST "or" filters: characters with a meaning there are dropped
const term = (q: string) => q.replace(/[,()*%\\:"]/g, " ").trim();

export async function listCustomers(filters: CustomerFilters): Promise<{ rows: CustomerListItem[]; total: number; counts: Record<CustomerView, number>; error: boolean }> {
  const supabase = await createClient();
  const q = term(filters.q);
  // Customers whose sites match the search (street, postal code, city)
  let siteCustomerIds: string[] = [];
  if (q) {
    const { data } = await supabase.from("customer_sites").select("customer_id")
      .or(`street_house_number.ilike.%${q}%,postal_code.ilike.${q}%,city.ilike.%${q}%`).limit(500);
    siteCustomerIds = [...new Set((data ?? []).map((row) => row.customer_id))];
  }
  let query = supabase.from("customers").select("*, customer_sites(*), requests!requests_customer_id_fkey(count), origin:requests!customers_origin_request_id_fkey(id, request_number)", { count: "exact" });
  if (filters.view === "aktiv") query = query.eq("is_active", true);
  if (filters.view === "inaktiv") query = query.eq("is_active", false);
  if (q) {
    const ors = [`customer_number.ilike.%${q}%`, `company_name.ilike.%${q}%`, `contact_name.ilike.%${q}%`, `business_email.ilike.%${q}%`];
    if (siteCustomerIds.length > 0) ors.push(`id.in.(${siteCustomerIds.join(",")})`);
    query = query.or(ors.join(","));
  }
  const from = (filters.page - 1) * CUSTOMER_PAGE_SIZE;
  const [{ data, count, error }, active, inactive] = await Promise.all([
    query.order("company_name").range(from, from + CUSTOMER_PAGE_SIZE - 1),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_active", false),
  ]);
  const rows = (data ?? []).map(({ customer_sites: sites, requests, origin, ...row }) => ({
    ...row,
    origin,
    sites: [...sites].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.created_at.localeCompare(b.created_at)),
    requestCount: requests[0]?.count ?? 0,
  }));
  return {
    rows,
    total: count ?? 0,
    counts: { aktiv: active.count ?? 0, inaktiv: inactive.count ?? 0, alle: (active.count ?? 0) + (inactive.count ?? 0) },
    error: Boolean(error),
  };
}

export async function getCustomer(id: string): Promise<{ customer: Customer & { origin: CustomerOrigin }; sites: CustomerSite[]; requests: CustomerRequest[] } | null> {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const [{ data: customer, error }, sites, requests] = await Promise.all([
    supabase.from("customers").select("*, origin:requests!customers_origin_request_id_fkey(id, request_number)").eq("id", id).maybeSingle(),
    supabase.from("customer_sites").select("*").eq("customer_id", id).order("created_at"),
    supabase.from("requests").select("id, request_number, created_at, intake_status, work_status, service_kind, equipment_kind, street_house_number, city, customer_site_id")
      .eq("customer_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  if (error) throw new Error("Kunde konnte nicht geladen werden.");
  if (!customer) return null;
  return { customer, sites: sites.data ?? [], requests: requests.data ?? [] };
}
