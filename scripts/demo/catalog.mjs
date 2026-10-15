// Fictional customers, sites and texts for the demo seed. Any resemblance to real companies is unintended.

// Region around Mannheim (Rhein-Neckar), matching the website and the service area of the phone assistant (task-13-9)
export const COMPANY_PREFIXES = [
  "Rheinauer", "Kurpfalz", "Neckartal", "Bergsträßer", "Pfälzer", "Odenwald", "Hardt", "Neckarauer", "Friedrichsfelder", "Käfertaler",
  "Rheinhafen", "Speyerer", "Wormser", "Weinheimer", "Schwetzinger", "Hockenheimer", "Ladenburger", "Heidelberger", "Kraichgau", "Lindenhof",
];
export const COMPANY_CORES = [
  "Kunststofftechnik", "Lebensmittelwerke", "Metallverarbeitung", "Papierfabrik", "Getränke", "Chemiepark Service",
  "Galvanik", "Brauerei", "Druckerei", "Logistikzentrum", "Molkerei", "Präzisionsteile", "Klinikum Technik",
  "Stadtwerke Betrieb", "Gießerei", "Verpackungen", "Textilveredelung", "Kältetechnik", "Recycling", "Glaswerk",
];
export const COMPANY_FORMS = ["GmbH", "GmbH & Co. KG", "AG", "KG", "GmbH"];

// [postal code, city, area code]; all inside docs/telefonassistent/einsatzgebiet.json
export const CITIES = [
  ["68159", "Mannheim", "621"], ["68219", "Mannheim", "621"], ["68307", "Mannheim", "621"], ["68169", "Mannheim", "621"],
  ["67059", "Ludwigshafen am Rhein", "621"], ["67063", "Ludwigshafen am Rhein", "621"], ["69115", "Heidelberg", "6221"],
  ["69123", "Heidelberg", "6221"], ["67346", "Speyer", "6232"], ["67547", "Worms", "6241"], ["69469", "Weinheim", "6201"],
  ["68723", "Schwetzingen", "6202"], ["68766", "Hockenheim", "6205"], ["68519", "Viernheim", "6204"], ["68526", "Ladenburg", "6203"],
  ["67227", "Frankenthal (Pfalz)", "6233"], ["69190", "Walldorf", "6227"], ["69168", "Wiesloch", "6222"], ["68623", "Lampertheim", "6206"],
  ["67105", "Schifferstadt", "6235"],
];
export const STREETS = [
  "Industriestraße", "Am Hafen", "Gewerbering", "Werkstraße", "Hansaallee", "Im Schiffahrtshafen", "Carl-Benz-Straße",
  "Max-Planck-Ring", "Kanalstraße", "Siemensstraße", "Am Bahnhof", "Robert-Bosch-Straße", "Fabrikweg", "Lagerstraße",
];
export const SITE_LABELS = ["Werk 1", "Werk 2", "Halle A", "Halle C", "Technikzentrale", "Kesselhaus", "Abfüllung", "Lager Nord"];

export const FIRST_NAMES = [
  "Sabine", "Thomas", "Katrin", "Michael", "Julia", "Stefan", "Nicole", "Andreas", "Melanie", "Frank",
  "Petra", "Markus", "Sandra", "Christian", "Birgit", "Oliver", "Yasemin", "Piotr", "Elena", "Kemal",
];
export const LAST_NAMES = [
  "Schulz", "Meyer", "Fischer", "Weber", "Schäfer", "Koch", "Bauer", "Richter", "Klein", "Wolf",
  "Neumann", "Schwarz", "Zimmermann", "Braun", "Hartmann", "Krause", "Lange", "Werner", "Arslan", "Kowalski",
];

export const MANUFACTURERS = {
  pump: ["Aquaflux", "Hydrotec", "Pumpenwerk Nord", "Fluvio"],
  compressor: ["Druckluft Kessler", "Aerocomp", "Kompressa", "AirLine"],
  ventilation: ["Ventara", "Klimabau West", "Luftwerk", "Aeris"],
  other: ["Anlagenbau Rhein", "Technik Hoffmann", "Fördertechnik Ost"],
};

export const DESCRIPTIONS = {
  diagnosis_repair: {
    pump: ["Pumpe verliert Wasser an der Gleitringdichtung.", "Kreiselpumpe läuft laut und vibriert stark.", "Förderleistung deutlich gesunken, Druck schwankt.", "Motorschutzschalter löst nach wenigen Minuten aus."],
    compressor: ["Kompressor schaltet unregelmäßig ab, Öltemperatur hoch.", "Druckluftanlage erreicht den Solldruck nicht mehr.", "Ölaustrag im Druckluftnetz festgestellt.", "Lautes Klopfen beim Anlauf des Verdichters."],
    ventilation: ["Lüftungsanlage meldet Störung am Ventilator.", "Zuluft deutlich reduziert, Filteralarm dauerhaft.", "Keilriemen quietscht, Anlage vibriert.", "Wärmerückgewinnung ohne Funktion."],
    other: ["Fördereinrichtung bleibt sporadisch stehen.", "Hydraulikaggregat verliert Druck.", "Steuerung meldet wiederkehrende Fehlercodes."],
  },
  scheduled_maintenance: {
    pump: ["Jährliche Wartung der Pumpenstation fällig.", "Wartung laut Wartungsplan, drei Pumpen."],
    compressor: ["Wartung nach 4.000 Betriebsstunden.", "Jahreswartung Schraubenkompressor inkl. Ölwechsel."],
    ventilation: ["Halbjährliche Wartung der Lüftungsanlage mit Filterwechsel.", "Wartung RLT-Anlage vor der Sommersaison."],
    other: ["Wartung der Hydraulikeinheit gemäß Herstellervorgabe."],
  },
  inspection: {
    pump: ["Inspektion der Pumpen vor Produktionsumstellung.", "Zustandsprüfung nach Hochwasser im Keller."],
    compressor: ["Prüfung der Druckluftanlage für das Audit.", "Sichtprüfung und Leckageortung im Druckluftnetz."],
    ventilation: ["Hygieneinspektion der Lüftungsanlage.", "Inspektion vor Abnahme durch den Versicherer."],
    other: ["Allgemeine Inspektion der technischen Anlagen."],
  },
};

export const PARTS = {
  pump: [["Gleitringdichtung", 48], ["Laufrad", 186], ["Wälzlagersatz", 72], ["O-Ring-Satz", 14]],
  compressor: [["Ölabscheider", 96], ["Luftfilterelement", 38], ["Ansaugregler-Reparatursatz", 142], ["Keilriemen", 29]],
  ventilation: [["Taschenfilter F7", 34], ["Keilriemen", 29], ["Ventilatorlager", 64], ["Stellantrieb", 158]],
  other: [["Hydraulikschlauch", 57], ["Näherungsschalter", 43], ["Dichtungssatz", 22]],
};

export const SUMMARIES = {
  diagnosis_repair: ["Fehler behoben, Probelauf ohne Befund.", "Defektes Bauteil ersetzt, Anlage läuft stabil.", "Ursache gefunden und instand gesetzt, Kunde eingewiesen."],
  scheduled_maintenance: ["Wartung nach Plan durchgeführt, keine Mängel.", "Wartung erledigt, Verschleißteile im nächsten Intervall prüfen."],
  inspection: ["Inspektion durchgeführt, Prüfbericht übergeben.", "Inspektion ohne Mängel abgeschlossen."],
};

export const REJECTION_REASONS = [
  "Privathaushalt, kein Industriekunde.",
  "Anlage eines Fremdherstellers außerhalb unseres Leistungsspektrums.",
  "Einsatzort außerhalb des Servicegebiets.",
];
export const CANCELLATION_REASONS = [
  "Kunde hat den Auftrag storniert.",
  "Störung hat sich durch Eigenleistung des Kunden erledigt.",
  "Anlage wird stillgelegt.",
];
export const UNCERTAINTIES = [
  "Typenschildangaben fehlen.",
  "Unklar, ob die Anlage unter Druck steht.",
  "Widersprüchliche Angaben zu Hersteller und Modell.",
  "Sicherheitsgefahr als „Unklar“ angegeben.",
];

// Demo service contracts (task-13-9): fixed, so the test list for the phone assistant (docs/telefonassistent/testdaten.md)
// stays valid after every reseed. Each contract belongs to one fixed demo customer at the given site(s).
export const SERVICE_CONTRACTS = [
  { contract_number: "SLA-2021-801", company_name: "Neckartal Brauerei GmbH", postal_codes: ["69115"], city: "Heidelberg", street: "Bergheimer Straße 120", area: "6221", emergency_24_7: true, valid_from: "2021-03-01", valid_until: null },
  { contract_number: "SLA-2022-176", company_name: "Kurpfalz Präzisionsteile KG", postal_codes: ["68219"], city: "Mannheim", street: "Rhenaniastraße 30", area: "621", emergency_24_7: true, valid_from: "2022-01-01", valid_until: null },
  { contract_number: "SLA-2022-340", company_name: "Rheinhafen Logistikzentrum GmbH & Co. KG", postal_codes: ["68159"], city: "Mannheim", street: "Hafenstraße 12", area: "621", emergency_24_7: true, valid_from: "2022-07-01", valid_until: null },
  { contract_number: "SLA-2023-512", company_name: "Pfälzer Lebensmittelwerke AG", postal_codes: ["67059"], city: "Ludwigshafen am Rhein", street: "Industriestraße 8", area: "621", emergency_24_7: true, valid_from: "2023-02-01", valid_until: null },
  { contract_number: "SLA-2023-627", company_name: "Bergsträßer Kunststofftechnik GmbH", postal_codes: ["69469"], city: "Weinheim", street: "Gewerbering 4", area: "6201", emergency_24_7: true, valid_from: "2023-05-01", valid_until: null },
  { contract_number: "SLA-2024-118", company_name: "Hardt Getränke AG", postal_codes: ["68766"], city: "Hockenheim", street: "Carl-Benz-Straße 21", area: "6205", emergency_24_7: true, valid_from: "2024-01-01", valid_until: null },
  { contract_number: "SLA-2024-328", company_name: "Speyerer Papierfabrik GmbH & Co. KG", postal_codes: ["67346"], city: "Speyer", street: "Am Hafen 5", area: "6232", emergency_24_7: true, valid_from: "2024-04-01", valid_until: null },
  { contract_number: "SLA-2025-205", company_name: "Odenwald Molkerei GmbH", postal_codes: ["69168", "69190"], city: "Wiesloch", street: "Werkstraße 17", area: "6222", emergency_24_7: true, valid_from: "2025-01-01", valid_until: null },
  { contract_number: "SLA-2021-373", company_name: "Wormser Glaswerk GmbH", postal_codes: ["67547"], city: "Worms", street: "Siemensstraße 9", area: "6241", emergency_24_7: false, valid_from: "2021-06-01", valid_until: null },
  { contract_number: "SLA-2022-558", company_name: "Schwetzinger Druckerei KG", postal_codes: ["68723"], city: "Schwetzingen", street: "Robert-Bosch-Straße 3", area: "6202", emergency_24_7: false, valid_from: "2022-09-01", valid_until: null },
  { contract_number: "SLA-2023-905", company_name: "Ladenburger Galvanik GmbH", postal_codes: ["68526"], city: "Ladenburg", street: "Fabrikweg 2", area: "6203", emergency_24_7: false, valid_from: "2023-03-01", valid_until: null },
  { contract_number: "SLA-2025-751", company_name: "Frankenthaler Verpackungen GmbH", postal_codes: ["67227"], city: "Frankenthal (Pfalz)", street: "Lagerstraße 11", area: "6233", emergency_24_7: false, valid_from: "2025-02-01", valid_until: null },
  { contract_number: "SLA-2020-433", company_name: "Viernheimer Metallverarbeitung GmbH", postal_codes: ["68519"], city: "Viernheim", street: "Max-Planck-Ring 6", area: "6204", emergency_24_7: true, valid_from: "2020-07-01", valid_until: "2026-06-30" },
  { contract_number: "SLA-2026-990", company_name: "Lampertheimer Recycling GmbH", postal_codes: ["68623"], city: "Lampertheim", street: "Kanalstraße 40", area: "6206", emergency_24_7: true, valid_from: "2027-01-01", valid_until: null },
];
