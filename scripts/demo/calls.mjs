// Demo calls of the phone assistant Mira (task-13-7) for the area "Anrufe" and the analysis "Telefon".
//
// Calls that created a request belong to the requests the generator marked as phone requests (source phone_agent);
// the other calls (status, appointment, question, complaint, spam …) are spread over business days and evenings.
// Own random sequence, so the requests stay the same. Urgent calls are always called back (no permanent banner for
// demo dispatchers); a few recent normal callbacks stay open. Transcripts exist only for the last 30 days, as in live
// operation (purge_call_transcripts). customer_number is resolved to customer_id by the seed after the customers exist.
import { addMinutes, berlinDay, berlinParts, berlinTime, DAY, nextBusinessTime } from "./time.mjs";

const iso = (date) => date.toISOString();
const TRANSCRIPT_DAYS = 30;

const EQUIPMENT = { pump: "Pumpe", compressor: "Kompressor", ventilation: "Lüftungsanlage", other: "Anlage" };
const SERVICE = { inspection: "eine Inspektion", scheduled_maintenance: "eine Wartung", diagnosis_repair: "eine Reparatur" };

// Mo–Fr 07:00–18:00 (public holidays left out in the demo)
export const inServiceHours = (date) => {
  const p = berlinParts(date);
  return p.weekday <= 5 && p.hour >= 7 && p.hour < 18;
};

const OTHER_CALLS = {
  status: {
    weight: 0.3, sentiment: [["neutral", 0.7], ["positiv", 0.2], ["negativ", 0.1]], callback: 0.15, seconds: [60, 200],
    summary: (r) => `Anrufer fragt nach dem Stand der Anfrage${r ? ` von ${r.company_name}` : ""}. Mira nennt den aktuellen Stand.`,
    lines: (r) => [["Anrufer", "Guten Tag, ich wollte fragen, wie der Stand unserer Anfrage ist."], ["Mira", "Gern. Nennen Sie mir bitte die Anfragenummer oder Ihre Firma und die Postleitzahl."], ["Anrufer", `${r?.company_name ?? "Wir"}, Postleitzahl ${r?.postal_code ?? "68159"}.`], ["Mira", "Danke. Ihre Anfrage ist in Bearbeitung, der Service Desk meldet sich mit einem Termin."]],
  },
  termin: {
    weight: 0.12, sentiment: [["neutral", 0.7], ["positiv", 0.2], ["negativ", 0.1]], callback: 0.45, seconds: [90, 260],
    summary: () => "Anrufer möchte den geplanten Termin verschieben. Mira nimmt den Wunsch auf; der Service Desk bestätigt.",
    lines: () => [["Anrufer", "Wir haben einen Termin bei Ihnen und müssten ihn leider verschieben."], ["Mira", "Das nehme ich auf. Welcher Tag würde Ihnen besser passen?"], ["Anrufer", "Gern in der nächsten Woche, am Dienstag oder Mittwoch."], ["Mira", "Ich gebe das an den Service Desk weiter, der sich zur Bestätigung meldet."]],
  },
  verspaetung: {
    weight: 0.05, sentiment: [["neutral", 0.5], ["negativ", 0.5]], callback: 0.2, seconds: [70, 180],
    summary: () => "Techniker noch nicht vor Ort. Mira hat den Techniker um einen Rückruf beim Kunden gebeten.",
    lines: () => [["Anrufer", "Ihr Techniker sollte seit einer halben Stunde da sein."], ["Mira", "Das tut mir leid. Ich schicke dem Techniker sofort die Bitte, Sie anzurufen."], ["Anrufer", "Gut, danke."]],
  },
  frage: {
    weight: 0.24, sentiment: [["neutral", 0.6], ["positiv", 0.35], ["negativ", 0.05]], callback: 0.08, seconds: [40, 150],
    summary: () => "Allgemeine Frage zu Leistungen und Servicezeiten, von Mira beantwortet.",
    lines: () => [["Anrufer", "Warten Sie auch Schraubenkompressoren anderer Hersteller?"], ["Mira", "Ja, wir betreuen Kompressoren, Pumpen und Lüftungsanlagen vieler Hersteller in der Region Rhein-Neckar."], ["Anrufer", "Und wann ist Ihr Service Desk erreichbar?"], ["Mira", "Montag bis Freitag von 7 bis 18 Uhr."]],
  },
  beschwerde: {
    weight: 0.04, sentiment: [["negativ", 1]], callback: 1, seconds: [120, 320],
    summary: () => "Kunde beschwert sich über die Rechnung zum letzten Einsatz. Rückruf durch den Service Desk gewünscht.",
    lines: () => [["Anrufer", "Ich bin mit der Rechnung vom letzten Einsatz nicht einverstanden."], ["Mira", "Das verstehe ich. Ich bitte den Service Desk um einen Rückruf, damit das geklärt wird."]],
  },
  ausserhalb_gebiet: {
    weight: 0.06, sentiment: [["neutral", 0.8], ["negativ", 0.2]], callback: 0, seconds: [50, 120],
    summary: () => "Standort liegt außerhalb des Einsatzgebiets. Mira hat das freundlich erklärt; keine Anfrage angelegt.",
    lines: () => [["Anrufer", "Unser Werk ist in Kassel, kommen Sie auch dorthin?"], ["Mira", "Leider nein, wir sind nur in der Region Rhein-Neckar im Einsatz."]],
  },
  spam: {
    weight: 0.05, sentiment: [["neutral", 1]], callback: 0, seconds: [15, 60],
    summary: () => "Werbeanruf ohne Serviceanliegen.",
    lines: () => [["Anrufer", "Wir bieten Ihnen günstige Energieverträge an."], ["Mira", "Danke, dafür bin ich nicht zuständig. Auf Wiederhören."]],
  },
  sonstiges: {
    weight: 0.14, sentiment: [["neutral", 0.9], ["negativ", 0.1]], callback: 0.25, seconds: [8, 70],
    summary: () => "Gespräch kurz nach der Begrüßung abgebrochen; kein Anliegen genannt.",
    lines: () => [["Mira", "RheinWerk Industrieservice, hier spricht Mira. Wie kann ich helfen?"], ["Anrufer", "Hallo? …"]],
  },
};

// Lines [speaker, text]; speaker "tool" is a tool call in the notation of the evaluation workflow
function transcriptText(lines) {
  return lines.map(([who, text]) => (who === "tool" ? text : `${who}: ${text}`)).join("\n");
}

export function generateDemoCalls({ rnd, phoneRequests, requests, from, cutoff, staff, customers }) {
  const calls = [];
  let index = 0;
  const transcriptCut = new Date(cutoff.getTime() - TRANSCRIPT_DAYS * DAY);
  const doneAt = (start) => {
    const at = nextBusinessTime(addMinutes(start, rnd.int(12, 150)));
    return at < cutoff ? at : null;
  };

  function add({ conversation = null, start, seconds, category, urgency = null, risk = null, request = null, customer = null, summary, lines, sentiment, callback, urgent = false, reason = null }) {
    const end = new Date(start.getTime() + seconds * 1000);
    if (end >= cutoff) return;
    index += 1;
    const conversationId = conversation ?? `demo-conv-${String(index).padStart(5, "0")}`;
    const hours = inServiceHours(start);
    // Urgent callbacks are always done; normal ones from the last week stay open in most cases
    const done = callback && (urgent || start < new Date(cutoff.getTime() - 7 * DAY) || rnd.chance(0.3)) ? doneAt(start) : null;
    const analyzed = new Date(Math.min(addMinutes(end, rnd.int(1, 3)).getTime(), cutoff.getTime()));
    const callbackNumber = callback ? customer?.phone_number ?? request?.phone_number ?? null : null;
    const kept = start >= transcriptCut;
    const credits = Math.round(seconds * rnd.float(6.5, 8.5));
    // Demo transfer (task-13-11): emergencies and complaints in the service hours go to the service desk first
    const forward = callback && hours && (urgent || category === "beschwerde") ? "service_desk" : null;
    calls.push({
      id: rnd.uuid(),
      conversation_id: conversationId,
      started_at: iso(start),
      ended_at: iso(end),
      duration_seconds: seconds,
      caller_number: null,
      in_service_hours: hours,
      category,
      urgency,
      safety_risk: risk,
      summary,
      transcript: kept ? transcriptText(lines) : null,
      transcript_deleted_at: kept ? null : iso(berlinTime(...dayParts(new Date(end.getTime() + TRANSCRIPT_DAYS * DAY)), 2, 30)),
      callback_needed: callback,
      callback_urgent: urgent,
      callback_reason: callback ? reason ?? summary : null,
      callback_number: callbackNumber,
      callback_done_at: done ? iso(done) : null,
      callback_done_by: done ? rnd.pick(staff.dispatchers) : null,
      forwarded: Boolean(forward),
      forward_target: forward,
      forward_reason: forward ? summary.slice(0, 200) : null,
      forwarded_at: forward ? iso(addMinutes(start, Math.max(1, Math.floor(seconds / 120)))) : null,
      sentiment,
      request_id: request?.id ?? null,
      cost_cents: Math.max(0, Math.round((seconds / 60) * rnd.float(1.2, 2.2))),
      credits,
      analysis: {
        kategorie: category, dringlichkeit: urgency ?? "planbar", sicherheitsgefahr: risk ?? "none_known",
        firma: customer?.company_name ?? request?.company_name ?? null, kontakt: customer?.contact_name ?? request?.contact_name ?? null,
        rueckrufnummer: callbackNumber, anfrage_nummer: null, zusammenfassung: summary, rueckruf_noetig: callback, stimmung: sentiment,
        termin_vorgemerkt: false, ausserhalb_servicezeit: !hours, rueckruf_ueber_werkzeug: urgent, kunde_erkannt: Boolean(customer?.customer_number),
      },
      analyzed_at: iso(analyzed),
      is_demo: true,
      created_at: iso(start),
      updated_at: iso(done ?? analyzed),
      customer_number: customer?.customer_number ?? null,
    });
  }

  // Calls that created a request: the call ends a minute before the request is stored
  for (const { req, customer, conversationId } of phoneRequests) {
    const seconds = rnd.int(170, 480);
    const created = new Date(req.created_at);
    const start = new Date(created.getTime() - seconds * 1000 - 20_000);
    const emergency = req.customer_urgency === "production_stop" || req.safety_risk !== "none_known";
    const what = `${SERVICE[req.service_kind]} (${EQUIPMENT[req.equipment_kind]}${req.manufacturer ? ` ${req.manufacturer}` : ""})`;
    const summary = emergency
      ? `${req.customer_urgency === "production_stop" ? "Produktionsstillstand" : "Mögliche Sicherheitsgefahr"}: Anrufer meldet einen Ausfall und braucht ${what}. Anfrage angelegt, dringender Rückruf.`
      : `Anrufer braucht ${what} in ${req.city}. Mira hat die Anfrage angelegt; Eingangsbestätigung per E-Mail.`;
    const known = Boolean(customer.customer_number) && rnd.chance(0.75);
    add({
      conversation: conversationId, start, seconds, category: emergency ? "notfall" : "neue_anfrage", urgency: req.customer_urgency, risk: req.safety_risk, request: req,
      customer: known ? customer : { ...customer, customer_number: null },
      summary,
      lines: [
        ["tool", "[Werkzeug servicezeit: {}]"],
        ["Mira", "RheinWerk Industrieservice, hier spricht Mira. Wie kann ich helfen?"],
        ["Anrufer", `Guten Tag, ${customer.contact_name} von ${customer.company_name}. ${req.description}`],
        ["Mira", known ? "Sind Sie bereits Kunde bei uns? Dann nennen Sie mir bitte Ihre Kundennummer und die Postleitzahl." : "Um welche Anlage handelt es sich, und wo steht sie?"],
        ["Anrufer", known ? `${customer.customer_number}, Postleitzahl ${customer.postal_code}.` : `${EQUIPMENT[req.equipment_kind]}${req.manufacturer ? ` von ${req.manufacturer}` : ""}, ${req.street_house_number} in ${req.city}.`],
        ...(known ? [["tool", `[Werkzeug kunde_finden: {"kundennummer":"${customer.customer_number}","plz":"${customer.postal_code}"}]`]] : []),
        ["tool", `[Werkzeug anfrage_anlegen: {"service_kind":"${req.service_kind}","equipment_kind":"${req.equipment_kind}"}]`],
        ["Mira", emergency ? "Ich lege die Anfrage als dringend an und bitte den Service Desk um einen sofortigen Rückruf." : "Danke. Ich habe die Anfrage angelegt, Sie erhalten gleich eine Eingangsbestätigung per E-Mail."],
      ],
      sentiment: rnd.weighted(emergency ? [["neutral", 0.6], ["negativ", 0.4]] : [["positiv", 0.45], ["neutral", 0.5], ["negativ", 0.05]]),
      callback: emergency, urgent: emergency, reason: emergency ? summary : null,
    });
  }

  // Other calls: 1–4 per business day, rarely on weekends; a quarter in the evening
  const byCustomer = new Map(customers.map((c) => [c.company_name, c]));
  for (let day = berlinDay(from); day < cutoff; day = berlinDay(day, 1)) {
    const p = berlinParts(day);
    const count = p.weekday <= 5 ? rnd.int(1, 4) : rnd.chance(0.4) ? 1 : 0;
    for (let i = 0; i < count; i += 1) {
      const evening = rnd.chance(0.22);
      const hour = evening ? rnd.pick([6, 18, 19, 20, 21]) : rnd.int(7, 17);
      const start = berlinTime(p.year, p.month, p.day, hour, rnd.int(0, 59));
      const category = rnd.weighted(Object.entries(OTHER_CALLS).map(([key, spec]) => [key, spec.weight]));
      const spec = OTHER_CALLS[category];
      // Status, appointment and delay refer to an open demo request of the caller
      const open = ["status", "termin", "verspaetung"].includes(category)
        ? requests.filter((r) => new Date(r.created_at) < new Date(start.getTime() - DAY) && (!r.completed_at || new Date(r.completed_at) > start) && (!r.cancelled_at || new Date(r.cancelled_at) > start))
        : [];
      const request = open.length ? rnd.pick(open.slice(-80)) : null;
      const customer = request ? byCustomer.get(request.company_name) ?? null : ["frage", "beschwerde"].includes(category) ? rnd.pick(customers) : null;
      const seconds = rnd.int(spec.seconds[0], spec.seconds[1]);
      add({
        start, seconds, category, request, customer, summary: spec.summary(request),
        lines: request ? [...spec.lines(request).slice(0, -1), ["tool", `[Werkzeug anfrage_finden: {"firma":"${request.company_name}","plz":"${request.postal_code}"}]`], spec.lines(request).at(-1)] : spec.lines(request),
        sentiment: rnd.weighted(spec.sentiment), callback: rnd.chance(spec.callback),
      });
    }
  }
  calls.sort((a, b) => a.started_at.localeCompare(b.started_at));
  // The three latest normal callbacks stay open, so "Rückruf offen" is never empty in the demo
  for (const call of calls.filter((c) => c.callback_needed && !c.callback_urgent).slice(-3)) {
    call.callback_done_at = null;
    call.callback_done_by = null;
    call.updated_at = call.analyzed_at;
  }
  return calls;
}

function dayParts(date) {
  const p = berlinParts(date);
  return [p.year, p.month, p.day];
}
