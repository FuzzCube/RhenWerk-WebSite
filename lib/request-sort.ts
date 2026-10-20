// Sorting of the request list (task-12-12). Pure, so the unit tests can check it. URL parameter
// "sortierung=<key>-<auf|ab>"; the default (newest receipt first) is not written into the address.
export type SortDir = "auf" | "ab";

export const REQUEST_SORTS = {
  eingang: { label: "Eingang", first: "ab", asc: "älteste zuerst", desc: "neueste zuerst" },
  prioritaet: { label: "Priorität", first: "ab", asc: "niedrigste zuerst", desc: "höchste zuerst" },
  anfrage: { label: "Anfrage", first: "ab", asc: "kleinste Nummer zuerst", desc: "größte Nummer zuerst" },
  kunde: { label: "Kunde", first: "auf", asc: "A–Z", desc: "Z–A" },
  // Order of the service kinds in the database: inspection, scheduled maintenance, diagnosis and repair
  leistung: { label: "Leistung", first: "auf", asc: "Inspektion zuerst", desc: "Reparatur zuerst" },
  dispatcher: { label: "Dispatcher", first: "auf", asc: "A–Z", desc: "Z–A" },
} as const satisfies Record<string, { label: string; first: SortDir; asc: string; desc: string }>;
export type SortKey = keyof typeof REQUEST_SORTS;
export type RequestSort = { key: SortKey; dir: SortDir };

export const DEFAULT_SORT: RequestSort = { key: "eingang", dir: "ab" };

// Unknown values and keys the role may not use fall back to the default
export function parseSort(value: string, allowed: readonly SortKey[] = Object.keys(REQUEST_SORTS) as SortKey[]): RequestSort {
  const match = /^([a-z]+)-(auf|ab)$/.exec(value);
  if (!match || !(allowed as readonly string[]).includes(match[1])) return DEFAULT_SORT;
  return { key: match[1] as SortKey, dir: match[2] as SortDir };
}

export function sortParam(sort: RequestSort): string | null {
  return sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir ? null : `${sort.key}-${sort.dir}`;
}

// Click on a column header: the active column turns around, another one starts in its natural direction
export function nextSort(current: RequestSort, key: SortKey): RequestSort {
  if (current.key === key) return { key, dir: current.dir === "auf" ? "ab" : "auf" };
  return { key, dir: REQUEST_SORTS[key].first };
}

export function sortLabel(sort: RequestSort): string {
  const entry = REQUEST_SORTS[sort.key];
  return `${entry.label}, ${sort.dir === "auf" ? entry.asc : entry.desc}`;
}
