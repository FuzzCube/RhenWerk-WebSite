// Contract hint for the dispatcher (task-13-9): what the contract master data says about the SLA number a customer
// gave. Same rules as private.contract_status in the database; the person still sets "SLA geprüft". Pure, for tests.

export type ContractRow = { contract_number: string; postal_codes: string[]; emergency_24_7: boolean; valid_from: string; valid_until: string | null };
export type ContractHint = { state: "valid_24_7" | "valid" | "expired" | "not_yet" | "site_missing" | "unknown"; text: string };

// "sla 2021 801", "SLA2021-801", "2021-801" → "SLA-2021-801"; null when it does not look like a contract number
export function normalizeContractNumber(value: string | null | undefined): string | null {
  const compact = (value ?? "").toUpperCase().replace(/\s+/g, "").replace(/^SLA-?/, "");
  const match = /^(\d{4})-?(\d{3,})$/.exec(compact);
  return match ? `SLA-${match[1]}-${match[2]}` : null;
}

const dateDe = (day: string) => day.split("-").reverse().join(".");

export function contractHint(contract: ContractRow | null, postalCode: string, today: string): ContractHint {
  if (!contract) return { state: "unknown", text: "Nicht im Vertragsbestand – bitte beim Kunden klären." };
  if (contract.postal_codes.length > 0 && !contract.postal_codes.includes(postalCode)) {
    return { state: "site_missing", text: `Im Bestand, aber Standort ${postalCode} ist nicht im Vertrag (${contract.postal_codes.join(", ")}).` };
  }
  if (contract.valid_from > today) return { state: "not_yet", text: `Im Bestand, gültig erst ab ${dateDe(contract.valid_from)}.` };
  if (contract.valid_until && contract.valid_until < today) return { state: "expired", text: `Im Bestand, abgelaufen am ${dateDe(contract.valid_until)}.` };
  const until = contract.valid_until ? ` bis ${dateDe(contract.valid_until)}` : "";
  return contract.emergency_24_7
    ? { state: "valid_24_7", text: `Im Bestand: gültig${until}, mit 24/7-Notfall-SLA.` }
    : { state: "valid", text: `Im Bestand: gültig${until}, ohne 24/7-Notfall-SLA.` };
}
