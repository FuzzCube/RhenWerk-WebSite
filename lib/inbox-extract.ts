// Rule-based prefill of a new request from an inbox e-mail (task-10-10, variant A: no AI, nothing leaves the app).
// Reads labelled lines ("Telefon: …"), the signature block (company with legal form, name after the closing
// formula, street, postal code and city) and keywords for equipment, service and urgency. Every value is a
// suggestion: the form marks recognised fields and the dispatcher checks them before saving.

export type ExtractedField =
  | "company_name" | "contact_name" | "phone_number" | "street_house_number" | "postal_code" | "city" | "customer_number"
  | "equipment_kind" | "service_kind" | "customer_urgency" | "safety_risk" | "manufacturer" | "model_type" | "requested_visit_date";

export type Extraction = Partial<Record<ExtractedField, string>>;

const LEGAL_FORM = /\b(GmbH(?:\s*&\s*Co\.?\s*KG)?|gGmbH|mbH|AG|KG|OHG|GbR|UG(?:\s*\(haftungsbeschränkt\))?|SE|e\.\s?K\.|e\.\s?V\.|KGaA|Ltd\.?|Inc\.?)(?=$|[\s,.)])/;
const CLOSING = /^(mit\s+)?(freundlichen|besten|herzlichen|vielen|liebe|beste|viele|schöne)?\s*(grüßen|grüße|gruß|gruss|grüssen|dank)(?![a-zäöüß])|^mfg\b|^lg\b|^vg\b|^best regards|^kind regards/i;
const STREET_SUFFIX = /(straße|strasse|str\.|weg|allee|platz|ring|gasse|damm|ufer|chaussee|steig|pfad|markt|hof|feld|berg|kamp|kai|park|zeile|wall|graben|stieg)\s+\d+\s*[a-zA-Z]?(\s*[-–/]\s*\d+\s*[a-zA-Z]?)?$/i;
const OWN_COMPANY = /rheinwerk/i;
// Known manufacturers of pumps, compressors and ventilation (canonical spelling)
const MANUFACTURERS = [
  "KAESER", "Atlas Copco", "BOGE", "ALMIG", "Mehrer", "Ingersoll Rand", "Schneider", "Renner", "Gardner Denver", "CompAir", "Sauer", "Elgi",
  "Grundfos", "Wilo", "KSB", "Lowara", "Xylem", "Flygt", "Netzsch", "Seepex", "Vogelsang", "Speck", "Calpeda", "Ebara", "Sterling", "Edur", "Allweiler",
  "Systemair", "TROX", "Rosenberg", "ebm-papst", "Ziehl-Abegg", "Helios", "Maico", "Wolf", "Nicotra", "Fläkt", "Swegon", "Menerga", "Viessmann",
];

const LABELS: Array<[ExtractedField | "plz_city" | "address", RegExp]> = [
  ["company_name", /^(firma|unternehmen|firmenname|company)\s*[:：]\s*(.+)$/i],
  ["contact_name", /^(ansprechpartner(?:in)?|ansprechperson|kontakt(?:person)?|name)\s*[:：]\s*(.+)$/i],
  ["phone_number", /^(tel(?:efon)?\.?|fon|mobil|handy|phone|telefonnummer)\s*[:：.]?\s*(.+)$/i],
  ["customer_number", /^(kunden[-\s]?(?:nr\.?|nummer)|kd\.?[-\s]?nr\.?)\s*[:：]?\s*([A-Z0-9][A-Z0-9-]{2,})/i],
  ["manufacturer", /^(hersteller|fabrikat|marke)\s*[:：]\s*(.+)$/i],
  ["model_type", /^(modell|typ|typenbezeichnung|baureihe|model)\s*[:：]\s*(.+)$/i],
  ["requested_visit_date", /^(wunschtermin|termin(?:wunsch)?)\s*[:：]\s*(.+)$/i],
  ["plz_city", /^(plz\s*(?:\/|und)?\s*ort|ort)\s*[:：]\s*(.+)$/i],
  ["address", /^(adresse|anschrift|standort|straße|strasse|einsatzort)\s*[:：]\s*(.+)$/i],
];

const clean = (value: string) => value.replace(/\s+/g, " ").replace(/^[\s,;:–-]+|[\s,;]+$/g, "").trim();
const words = (text: string) => text.toLowerCase();

// Lines of the e-mail without quoted replies and forwarded history
function ownLines(body: string): string[] {
  const lines: string[] = [];
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (/^-{2,}\s*(original|ursprüngliche|forwarded|weitergeleitete)/i.test(line) || /^am .{4,80} schrieb .*:$/i.test(line) || /^on .{4,80} wrote:$/i.test(line)) break;
    if (line.startsWith(">")) continue;
    lines.push(line);
  }
  return lines;
}

function postalCity(text: string): { postal_code: string; city: string } | null {
  const match = text.match(/(?:^|[\s,])(?:D[-\s]?)?(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\-]+(?:[\s-](?:an der|am|im|bei|ob der|a\.\s?d\.|[A-ZÄÖÜ(][A-Za-zÄÖÜäöüß.()\-]*))*)/);
  return match ? { postal_code: match[1], city: clean(match[2].replace(/\s+(Tel|Fon|Telefon|Mobil|E-Mail|www)\b.*$/i, "")) } : null;
}

function phone(text: string): string | null {
  const match = text.match(/(?:\+\s?49|\(?0)[\d\s/().\-]{6,}\d/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? clean(match[0]) : null;
}

function isName(line: string): boolean {
  return /^(?:(?:Dr|Prof|Dipl\.-Ing|Ing)\.?\s+)*[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?(?:\s+(?:von|van|de|zu|vom)?\s*[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?){1,2}$/.test(line)
    && !LEGAL_FORM.test(line) && !/(straße|strasse|weg|allee|platz|team|service|abteilung|einkauf|technik|instandhaltung)$/i.test(line);
}

// Date in the future from "20.10.2026", "20.10.26" or "20.10." (current or next year)
function dateKey(text: string, today: string): string | null {
  const match = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
  if (!match) return null;
  const [day, month] = [Number(match[1]), Number(match[2])];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : Number(today.slice(0, 4));
  const key = (y: number) => `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!match[3] && key(year) < today) year += 1;
  return key(year) >= today ? key(year) : null;
}

function count(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (text.match(new RegExp(pattern.source, "gi"))?.length ?? 0), 0);
}

export function extractRequestFields(input: { subject: string; body: string; fromAddress?: string | null; today: string }): Extraction {
  const result: Extraction = {};
  const lines = ownLines(input.body);
  const set = (field: ExtractedField, value: string | null | undefined) => {
    const text = value ? clean(value) : "";
    if (text && !result[field]) result[field] = text.slice(0, 200);
  };

  // 1. Labelled lines
  for (const line of lines) {
    for (const [field, pattern] of LABELS) {
      const match = line.match(pattern);
      if (!match) continue;
      const value = match[2];
      if (field === "plz_city") { const found = postalCity(value); if (found) { set("postal_code", found.postal_code); set("city", found.city); } }
      else if (field === "address") {
        const found = postalCity(value);
        const street = value.split(/,/)[0];
        if (STREET_SUFFIX.test(street) || /\s\d+\s*[a-zA-Z]?$/.test(street)) set("street_house_number", street);
        if (found) { set("postal_code", found.postal_code); set("city", found.city); }
      } else if (field === "phone_number") set("phone_number", phone(value));
      else if (field === "requested_visit_date") set("requested_visit_date", dateKey(value, input.today));
      else if (field === "company_name" && OWN_COMPANY.test(value)) continue;
      else set(field, value);
    }
  }

  // 2. Signature: block after the closing formula, else the last lines of the e-mail
  const closing = lines.findIndex((line) => CLOSING.test(line));
  const signature = (closing >= 0 ? lines.slice(closing + 1) : lines.slice(-12)).filter(Boolean).slice(0, 14);
  if (closing >= 0) {
    const name = signature.find((line) => isName(line));
    set("contact_name", name);
  }
  const block = closing >= 0 ? signature : lines;
  set("company_name", block.find((line) => LEGAL_FORM.test(line) && line.length <= 80 && !/@|https?:|www\./i.test(line) && !OWN_COMPANY.test(line) && !/^(sehr|hallo|guten|liebe)/i.test(line)));
  const postalIndex = block.findIndex((line) => postalCity(line) !== null && !/^(tel|fon|fax|mobil)/i.test(line));
  if (postalIndex >= 0) {
    const found = postalCity(block[postalIndex])!;
    set("postal_code", found.postal_code);
    set("city", found.city);
    // Street on the same line ("Hafenstraße 12, 40213 Düsseldorf") or the line before
    const sameLine = block[postalIndex].split(/,|·|\|/)[0];
    const before = block[postalIndex - 1] ?? "";
    if (sameLine !== block[postalIndex] && /\d/.test(sameLine) && !/^\s*(D[-\s]?)?\d{5}/.test(sameLine)) set("street_house_number", sameLine);
    else if (/[A-Za-zäöüß]\S*\s+\d+\s*[a-zA-Z]?(\s*[-–/]\s*\d+\s*[a-zA-Z]?)?$/.test(before) && !LEGAL_FORM.test(before)) set("street_house_number", before);
  }
  if (!result.street_house_number) set("street_house_number", lines.find((line) => STREET_SUFFIX.test(line) && line.length <= 60));
  set("phone_number", phone(block.filter((line) => !/^fax/i.test(line)).join("\n")) ?? null);
  if (!result.phone_number) set("phone_number", phone(lines.filter((line) => !/^fax/i.test(line) && /(tel|fon|mobil|handy|erreichbar|rufnummer|\+49)/i.test(line)).join("\n")));

  // Contact from the sender address "max.mustermann@…" when the signature has no name
  if (!result.contact_name && input.fromAddress) {
    const local = input.fromAddress.split("@")[0];
    const parts = local.split(/[._-]/).filter((part) => /^[a-zäöüß]{2,}$/i.test(part));
    if (parts.length >= 2 && parts.length <= 3 && !/^(info|service|kontakt|einkauf|office|mail|technik|verwaltung|buchhaltung|noreply|no|reply|team)$/i.test(parts[0])) {
      set("contact_name", parts.map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase()).join(" "));
    }
  }

  // 3. Keywords in subject and own text
  const text = words(`${input.subject}\n${lines.join("\n")}`);
  const kinds: Array<[string, number]> = [
    ["pump", count(text, [/pumpe/, /kreiselpumpe/, /tauchpumpe/, /förderpumpe/, /hebeanlage/])],
    ["compressor", count(text, [/kompressor/, /verdichter/, /druckluft/])],
    ["ventilation", count(text, [/lüftung/, /lüfter/, /ventilator/, /\brlt\b/, /abluft/, /zuluft/, /klimaanlage/])],
  ];
  const kind = kinds.sort((a, b) => b[1] - a[1])[0];
  if (kind[1] > 0) set("equipment_kind", kind[0]);

  const repair = count(text, [/defekt/, /störung/, /fehler(code|meldung)?/, /reparatur/, /ausgefallen/, /fällt .{0,20}aus/, /undicht/, /leck/, /geräusch/, /läuft nicht/, /springt nicht an/, /schaltet .{0,20}ab\b/, /geht .{0,20}aus\b/, /funktioniert nicht/, /kaputt/, /\bdruck .{0,20}(zu niedrig|fällt|sinkt)/]);
  const maintenance = count(text, [/wartung/, /instandhaltung/, /service-?intervall/, /ölwechsel/, /filterwechsel/]);
  const inspection = count(text, [/inspektion/, /prüfung/, /\buvv\b/, /\bdguv\b/, /sicherheitsprüfung/, /begehung/]);
  const standstill = count(text, [/stillstand/, /produktion (steht|ist gestoppt)/, /steht still/, /anlage steht/, /produktionsausfall/]) > 0;
  if (repair > 0 || (standstill && maintenance === 0 && inspection === 0)) set("service_kind", "diagnosis_repair");
  else if (maintenance > 0 || inspection > 0) set("service_kind", maintenance >= inspection ? "scheduled_maintenance" : "inspection");

  if (standstill) set("customer_urgency", "production_stop");
  else if (count(text, [/dringend/, /\beilt\b/, /\basap\b/, /notfall/, /so schnell wie möglich/, /sofort/]) > 0) set("customer_urgency", "erheblich");
  else if (count(text, [/zeitnah/, /kurzfristig/, /diese woche/, /in den nächsten tagen/]) > 0) set("customer_urgency", "zeitnah");

  // Hints of danger: "unclear" so the request goes into review; never "none_known" from text alone
  if (count(text, [/\bgas(geruch|austritt)?\b/, /brandgeruch/, /\brauch/, /verschmort/, /funken/, /stromschlag/, /explosion/, /verletz/, /gefahr/, /ölaustritt/, /öl läuft aus/, /überhitz/]) > 0) set("safety_risk", "unclear");

  // Manufacturer and model: labelled first, then a known name, model right after it ("KAESER SM 13")
  const raw = `${input.subject}\n${lines.join("\n")}`;
  for (const name of MANUFACTURERS) {
    const pattern = new RegExp(`(?<![\\wäöüß])${name.replace(/[.*+?^${}()|[\]\\-]/g, (c) => `\\${c}`)}(?![\\wäöüß])(?:\\s+(?:Typ\\s+|Modell\\s+)?([A-Z]{1,5}[\\s-]?\\d{1,4}(?:[.,]\\d)?\\s?[A-Z+]{0,3}\\b))?`, "i");
    const match = raw.match(pattern);
    if (!match) continue;
    set("manufacturer", name);
    if (match[1]) set("model_type", match[1]);
    break;
  }

  set("customer_number", raw.match(/kunden[-\s]?(?:nr\.?|nummer)\s*[:：]?\s*([A-Z0-9][A-Z0-9-]{2,})/i)?.[1]);
  if (!result.requested_visit_date) {
    const wish = raw.match(/(?:termin|vorbeikommen|kommen|einsatz|besuch)[^.\n]{0,40}?\b(?:am\s+)?(\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)/i);
    if (wish) set("requested_visit_date", dateKey(wish[1], input.today));
  }
  return result;
}
