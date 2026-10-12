// Generates the demo dataset (spec section 9) as table rows for public.demo_seed_apply.
//
// Every request is simulated along its lifecycle (submission -> processing -> assignment -> visits ->
// completion -> invoice -> payment). Each step happens at a point in time; steps after the cutoff (now)
// are not applied, so the final status always matches the chronology and no actual data lies in the future.
// Only planned visits may be future-dated. Required demo cases are added as explicit fixtures (raw_payload.demo_case).
import * as C from "./catalog.mjs";
import { createRandom } from "./random.mjs";
import { addHours, addMinutes, berlinDay, berlinParts, berlinTime, HOUR, isoDate, MINUTE, nextBusinessTime } from "./time.mjs";

const TAX_RATE = 19;
const BASELINE_MINUTES = 15;
const SEASON = [0.85, 0.85, 1.05, 1.15, 1.1, 0.95, 1.05, 0.9, 1.15, 1.2, 1.0, 0.75];

// Seller data as on the website (Impressum, Kontakt); fictional company, payment data marked as demo
export const COMPANY_DETAILS = {
  company_name: "RheinWerk Industrieservice GmbH",
  street_house_number: "Rheinwerkstraße 12",
  postal_code: "68169",
  city: "Mannheim",
  email: "service@rheinwerk-industrieservice.example",
  phone: "+49 621 00000-0",
  managing_director: "Dr. Lena Hartmann",
  vat_id: "DE000000000 (Demo)",
  iban: "DE00 0000 0000 0000 0000 00 (Demo)",
  bank: "Demo-Bank",
  legal_note: "Fiktives Portfolio-Projekt. RheinWerk Industrieservice GmbH ist kein reales Unternehmen.",
  invoice_note: "Musterrechnung / Demodaten – keine echte Rechnung",
};

const iso = (date) => date.toISOString();
const cents = (value) => Math.round(value * 100);
const fromCents = (value) => value / 100;

// Rounding rule of invoice_items: net = round(q * p, 2), tax = round(net * rate / 100, 2), half away from zero
function lineAmounts(quantity, unitPrice, taxRate) {
  const quantityMilli = Math.round(quantity * 1000);
  const net = Math.floor((quantityMilli * cents(unitPrice) + 500) / 1000);
  const tax = Math.floor((net * Math.round(taxRate * 100) + 5000) / 10000);
  return { net: fromCents(net), tax: fromCents(tax), gross: fromCents(net + tax) };
}

export function generateDemoData({ anchor, now, staff }) {
  const rnd = createRandom(`rheinwerk-demo:${isoDate(anchor)}`);
  const anchorEnd = berlinDay(anchor, 1);
  const cutoff = new Date(Math.min(now.getTime(), anchorEnd.getTime() - MINUTE));
  const anchorKey = isoDate(anchor);
  const rateChange = berlinDay(cutoff, -180);

  const out = {
    settings: { company_details: COMPANY_DETAILS, manual_intake_minutes: BASELINE_MINUTES, default_tax_rate: TAX_RATE, payment_terms_days: 14 },
    service_rates: [],
    employee_availability: [],
    requests: [],
    visits: [],
    work_entries: [],
    invoices: [],
    invoice_items: [],
    messages: [],
    invoice_reminders: [],
    automation_runs: [],
    request_events: [],
  };

  // Rates: old prices until the rate change, new prices afterwards (issued invoices keep their prices)
  const startOfData = berlinTime(berlinParts(anchor).year - 2, berlinParts(anchor).month, 1);
  const rateDefs = [
    ["repair", "diagnosis_repair", "Diagnose und Reparatur je Stunde", "hourly", 89, 95],
    ["maintenance", "scheduled_maintenance", "Planmäßige Wartung pauschal", "fixed", 235, 250],
    ["inspection", "inspection", "Inspektion pauschal", "fixed", 165, 180],
  ];
  const rates = {};
  for (const [key, kind, name, model, oldPrice, newPrice] of rateDefs) {
    const old = { id: rnd.uuid(), code: `DEMO-${key.toUpperCase()}-2024`, service_kind: kind, display_name: `${name} (bis ${isoDate(rateChange)})`, billing_model: model, unit_price: oldPrice, tax_rate: TAX_RATE, is_active: false, created_at: iso(startOfData), updated_at: iso(rateChange) };
    const current = { id: rnd.uuid(), code: `DEMO-${key.toUpperCase()}`, service_kind: kind, display_name: name, billing_model: model, unit_price: newPrice, tax_rate: TAX_RATE, is_active: true, created_at: iso(rateChange), updated_at: iso(rateChange) };
    out.service_rates.push(old, current);
    rates[kind] = { old, current };
  }
  const rateFor = (kind, at) => (at < rateChange ? rates[kind].old : rates[kind].current);

  // Working hours and absences
  const technicians = staff.technicians;
  for (const technicianId of technicians) {
    for (let weekday = 1; weekday <= 5; weekday += 1) {
      out.employee_availability.push({ id: rnd.uuid(), employee_id: technicianId, kind: "working_hours", weekday, local_start: "07:00", local_end: "16:00", valid_from: null, valid_to: null, starts_at: null, ends_at: null, label: null, created_at: iso(startOfData), updated_at: iso(startOfData) });
    }
  }
  const cutoffParts = berlinParts(cutoff);
  const weekStart = berlinDay(cutoff, 1 - cutoffParts.weekday);
  const absences = [
    // current week: technician 3 on Thursday and Friday
    [technicians[2], berlinDay(weekStart, 3), berlinDay(weekStart, 5), "Urlaub"],
    // last summer: technician 2 two weeks vacation
    [technicians[1], berlinDay(cutoff, -300), berlinDay(cutoff, -286), "Urlaub"],
    // a sick day of technician 1
    [technicians[0], berlinDay(cutoff, -120), berlinDay(cutoff, -119), "Krankheit"],
  ];
  for (const [employeeId, start, end, label] of absences) {
    out.employee_availability.push({ id: rnd.uuid(), employee_id: employeeId, kind: "absence", weekday: null, local_start: null, local_end: null, valid_from: null, valid_to: null, starts_at: iso(start), ends_at: iso(end), label, created_at: iso(addHours(start, -24 * 14)), updated_at: iso(addHours(start, -24 * 14)) });
  }

  // Calendar: conflict-free bookings within working hours, absences blocked
  const busy = new Map(technicians.map((id) => [id, []]));
  for (const [employeeId, start, end] of absences) busy.get(employeeId).push([start.getTime(), end.getTime()]);
  const isFree = (technicianId, start, end) =>
    busy.get(technicianId).every(([s, e]) => end.getTime() <= s || start.getTime() >= e);
  function findSlot(preferred, fromDate, hours, { maxDays = 40, notBefore = fromDate, onlyDay = false } = {}) {
    for (let d = 0; d <= (onlyDay ? 0 : maxDays); d += 1) {
      const day = berlinDay(fromDate, d);
      const p = berlinParts(day);
      if (p.weekday > 5) continue;
      const order = [...preferred].sort(() => rnd.next() - 0.5);
      for (const technicianId of order) {
        const startHours = [7, 8, 9, 10, 11, 12, 13, 14].sort(() => rnd.next() - 0.5);
        for (const hour of startHours) {
          if (hour + hours > 16) continue;
          const start = berlinTime(p.year, p.month, p.day, hour, 0);
          const end = addMinutes(start, hours * 60);
          if (start < notBefore || !isFree(technicianId, start, end)) continue;
          busy.get(technicianId).push([start.getTime(), end.getTime()]);
          return { technicianId, start, end };
        }
      }
    }
    return null;
  }
  function bookExact(technicianId, start, end) {
    if (!isFree(technicianId, start, end)) return null;
    busy.get(technicianId).push([start.getTime(), end.getTime()]);
    return { technicianId, start, end };
  }

  // Customers
  const customers = Array.from({ length: 70 }, (_, i) => {
    const [postalCode, city] = rnd.pick(C.CITIES);
    const name = `${rnd.pick(C.COMPANY_PREFIXES)} ${rnd.pick(C.COMPANY_CORES)} ${rnd.pick(C.COMPANY_FORMS)}`;
    const first = rnd.pick(C.FIRST_NAMES);
    const last = rnd.pick(C.LAST_NAMES);
    const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 28);
    return {
      company_name: name,
      contact_name: `${first} ${last}`,
      business_email: `${slug}.${i + 1}@example.com`,
      phone_number: `+49 ${rnd.int(201, 2199)} ${rnd.int(100000, 999999)}`,
      customer_number: rnd.chance(0.65) ? `K-${10000 + i * 7}` : null,
      street_house_number: `${rnd.pick(C.STREETS)} ${rnd.int(1, 140)}`,
      postal_code: postalCode,
      city,
      site_label: rnd.chance(0.4) ? rnd.pick(C.SITE_LABELS) : null,
      sla_contract_number: rnd.chance(0.25) ? `SLA-${2020 + rnd.int(0, 5)}-${rnd.int(100, 999)}` : null,
    };
  });

  let requestIndex = 0;
  let dispatcherCursor = 0;

  function simulate(spec) {
    requestIndex += 1;
    const t0 = spec.createdAt;
    const customer = spec.customer ?? rnd.pick(customers);
    const month = berlinParts(t0).month;
    const serviceKind = spec.serviceKind ?? rnd.weighted([
      ["diagnosis_repair", 0.42 * ([12, 1, 2].includes(month) ? 1.3 : 1)],
      ["scheduled_maintenance", 0.33 * ([3, 4, 5, 9, 10].includes(month) ? 1.6 : 0.8)],
      ["inspection", 0.25],
    ]);
    const equipmentKind = spec.equipmentKind ?? rnd.weighted([
      ["pump", 0.33], ["compressor", 0.25 * ([11, 12, 1, 2].includes(month) ? 1.4 : 1)],
      ["ventilation", 0.25 * ([5, 6, 7, 8].includes(month) ? 1.8 : 0.9)], ["other", 0.12],
    ]);
    const urgency = spec.urgency ?? (serviceKind === "diagnosis_repair"
      ? rnd.weighted([["planbar", 0.2], ["zeitnah", 0.38], ["erheblich", 0.28], ["production_stop", 0.14]])
      : rnd.weighted([["planbar", 0.75], ["zeitnah", 0.22], ["erheblich", 0.03]]));
    const safetyRisk = spec.safetyRisk ?? rnd.weighted([["none_known", 0.86], ["unclear", 0.1], ["known", 0.04]]);
    const priority = { planbar: rnd.pick(["low", "normal"]), zeitnah: "normal", erheblich: "high", production_stop: "critical" }[urgency];
    const dispatcherId = staff.dispatchers[dispatcherCursor++ % staff.dispatchers.length];
    let path = spec.path ?? rnd.weighted([["auto", 0.5], ["clarify", 0.12], ["review", 0.15], ["corrected", 0.03], ["failure", 0.03], ["manual", 0.12], ["reject", 0.05]]);
    if (safetyRisk !== "none_known" && ["auto", "clarify", "corrected"].includes(path)) path = "review";
    const cancelStage = "cancelStage" in spec ? spec.cancelStage : rnd.chance(0.045) ? rnd.pick(["before_intake", "before_schedule", "after_schedule"]) : null;
    const leadDays = urgency === "planbar" ? rnd.int(7, 28) : urgency === "zeitnah" ? rnd.int(2, 7) : rnd.int(0, 2);
    const requestedVisitDate = berlinDay(t0, leadDays);
    const equipment = C.MANUFACTURERS[equipmentKind];
    const manufacturer = rnd.chance(0.75) ? rnd.pick(equipment) : null;
    const modelType = manufacturer && rnd.chance(0.7) ? `${manufacturer.slice(0, 2).toUpperCase()}-${rnd.int(100, 990)}` : null;
    const machineNumber = rnd.chance(0.45) ? `MN-${rnd.int(100000, 999999)}` : null;
    const emergencyClaimed = rnd.weighted([[null, 0.45], [false, 0.45], [true, 0.1]]);
    const description = rnd.pick(C.DESCRIPTIONS[serviceKind][equipmentKind]);

    const req = {
      id: rnd.uuid(),
      request_number: "wird-vergeben",
      source_event_key: `demo:${anchorKey}:${String(requestIndex).padStart(4, "0")}`,
      source: "demo_seed",
      is_demo: true,
      company_name: customer.company_name,
      contact_name: customer.contact_name,
      business_email: customer.business_email,
      phone_number: customer.phone_number,
      customer_number: customer.customer_number,
      site_label: customer.site_label,
      street_house_number: customer.street_house_number,
      postal_code: customer.postal_code,
      city: customer.city,
      equipment_kind: equipmentKind,
      manufacturer,
      model_type: modelType,
      machine_number: machineNumber,
      service_kind: serviceKind,
      requested_visit_date: isoDate(requestedVisitDate),
      description,
      customer_urgency: urgency,
      priority: null,
      safety_risk: safetyRisk,
      sla_contract_number: customer.sla_contract_number,
      emergency_sla_claimed: emergencyClaimed,
      sla_verified: false,
      raw_payload: null,
      dispatcher_id: null,
      technician_id: null,
      intake_status: "new",
      work_status: "not_planned",
      intake_mode: null,
      human_review_required: false,
      response_due_at: null,
      service_due_at: null,
      first_substantive_response_at: null,
      intake_completed_at: null,
      completed_at: null,
      cancelled_at: null,
      rejection_reason: null,
      cancellation_reason: null,
      completion_summary: null,
      manual_minutes_baseline: null,
      version: 1,
      created_at: iso(t0),
      updated_at: iso(t0),
    };
    req.raw_payload = {
      schema_version: "1.0",
      submission_id: req.source_event_key,
      source: "rheinwerk_website_service_request",
      locale: "de-DE",
      submitted_at: iso(t0),
      contact: { company_name: req.company_name, contact_name: req.contact_name, business_email: req.business_email, phone: req.phone_number, customer_number: req.customer_number ?? undefined },
      site_and_equipment: { site_name: req.site_label ?? undefined, street_and_number: req.street_house_number, postal_code: req.postal_code, city: req.city, equipment_type: { pump: "Pumpe", compressor: "Kompressor", ventilation: "Lüftungsanlage", other: "Sonstiges" }[equipmentKind], manufacturer: manufacturer ?? undefined, model_or_type: modelType ?? undefined, machine_number: machineNumber ?? undefined },
      request: { service_type: { inspection: "Inspektion", scheduled_maintenance: "Planmäßige Wartung", diagnosis_repair: "Diagnose und Reparatur" }[serviceKind], description, urgency: { planbar: "Planbar", zeitnah: "Zeitnah", erheblich: "Erheblich", production_stop: "Produktionsstillstand" }[urgency], known_safety_hazard: { none_known: "Nein", known: "Ja", unclear: "Unklar" }[safetyRisk], preferred_service_date: req.requested_visit_date, requires_human_review: safetyRisk !== "none_known" },
      contract_and_attachments: { customer_or_sla_contract_number: req.sla_contract_number ?? undefined, emergency_sla_24_7: emergencyClaimed === true, attachments: [] },
      privacy_consent: true,
      demo: true,
      demo_case: spec.demoCase ?? undefined,
    };
    out.requests.push(req);

    // Step control: actions after the cutoff are not applied
    let stopped = false;
    const ok = (t) => {
      if (stopped || t > cutoff) {
        stopped = true;
        return false;
      }
      req.updated_at = iso(t);
      return true;
    };
    const event = (t, type, { actor = null, actorType = actor ? "user" : "system", from = null, to = null, note = null, data = {}, visibility = "operational", visitId = null } = {}) => {
      out.request_events.push({ id: rnd.uuid(), request_id: req.id, visit_id: visitId, actor_type: actorType, actor_id: actorType === "user" ? actor : null, event_type: type, visibility, from_value: from, to_value: to, note, data, occurred_at: iso(t) });
    };
    const setIntake = (t, to, actor, note = null) => {
      event(t, "intake_status_changed", { actor, actorType: actor ? "user" : "automation", from: req.intake_status, to, note });
      req.intake_status = to;
    };
    const setWork = (t, to, actor, note = null) => {
      event(t, "work_status_changed", { actor, actorType: actor ? "user" : "automation", from: req.work_status, to, note });
      req.work_status = to;
    };
    const completeIntake = (t, mode, actor, outcome = "processed") => {
      if (req.intake_completed_at) return;
      req.intake_completed_at = iso(t);
      req.intake_mode = mode;
      req.manual_minutes_baseline = BASELINE_MINUTES;
      event(t, "intake_completed", { actor, actorType: actor ? "user" : "automation", to: mode, data: { manual_minutes_baseline: BASELINE_MINUTES, outcome } });
    };
    const run = (step, start, end, status, decision, confidence, { messageId = null, errorCode = null, result = null } = {}) => {
      if (start > cutoff) return null;
      const finished = end <= cutoff;
      const record = {
        id: rnd.uuid(), request_id: step === "email_matching" ? null : req.id, message_id: messageId,
        operation_key: `demo:${req.source_event_key}:${step}:${out.automation_runs.length}`,
        workflow_execution_id: `demo-exec-${rnd.int(100000, 999999)}`, step, input_version: 1,
        status: finished ? status : "running", decision: finished && status === "succeeded" ? decision : null,
        confidence: finished ? confidence : null, result: finished ? result : null,
        error_code: finished && status === "failed" ? errorCode : null,
        error_text: finished && status === "failed" ? "Analyse nicht innerhalb des Zeitlimits abgeschlossen (Demo)." : null,
        corrected_by: null, corrected_at: null, correction_reason: null,
        started_at: iso(start), finished_at: finished ? iso(end) : null, created_at: iso(start), updated_at: iso(finished ? end : start),
      };
      out.automation_runs.push(record);
      return record;
    };
    // Outgoing message: created (draft) -> queued (approved) -> sent; the state at the cutoff is kept
    const sendMessage = ({ kind, created, queued, sent, author = null, approver = null, systemApproved = false, subject, body, invoice = null, fail = false }) => {
      if (created > cutoff) return null;
      const message = {
        id: rnd.uuid(), request_id: req.id, inbox_dispatcher_id: null, invoice_id: invoice?.id ?? null,
        direction: "outgoing", kind, status: "draft", from_address: COMPANY_DETAILS.email, to_address: req.business_email,
        subject, body_text: body, mailbox_key: "service", gmail_message_id: null, gmail_thread_id: null,
        mime_message_id: null, in_reply_to: null, references_header: null, author_id: author, approved_by: null,
        received_at: null, sent_at: null, approved_at: null, handled_at: null, error_text: null,
        created_at: iso(created), updated_at: iso(created),
      };
      out.messages.push(message);
      const actorType = approver ? "user" : "automation";
      if (queued <= cutoff) {
        message.status = "queued";
        message.updated_at = iso(queued);
        if (approver || systemApproved) {
          message.approved_by = approver;
          message.approved_at = iso(queued);
        }
        event(queued, "message_queued", { actor: approver, actorType, from: "draft", to: "queued", data: { message_id: message.id, kind }, visibility: "dispatch" });
      }
      if (queued <= cutoff && sent <= cutoff) {
        if (fail) {
          message.status = "failed";
          message.error_text = "Zustellung vom Empfangsserver abgelehnt (Demo).";
          message.updated_at = iso(sent);
          return message;
        }
        message.status = "sent";
        message.sent_at = iso(sent);
        message.updated_at = iso(sent);
        message.gmail_message_id = `demo-${message.id.slice(0, 12)}`;
        message.gmail_thread_id = `demo-thread-${req.id.slice(0, 12)}`;
        message.mime_message_id = `<${message.id}@rheinwerk-demo.example.com>`;
        event(sent, "message_sent", { actorType: "automation", from: "queued", to: "sent", data: { message_id: message.id, kind, sent_at: iso(sent) }, visibility: "dispatch" });
        if (["clarification", "other"].includes(kind) && !req.first_substantive_response_at) req.first_substantive_response_at = iso(sent);
      }
      return message;
    };
    const receiveReply = (t, subject) => {
      const message = {
        id: rnd.uuid(), request_id: req.id, inbox_dispatcher_id: null, invoice_id: null, direction: "incoming",
        kind: "customer_reply", status: "received", from_address: req.business_email, to_address: COMPANY_DETAILS.email,
        subject: `AW: ${subject}`, body_text: "Guten Tag, anbei die gewünschten Angaben zur Anlage. Mit freundlichen Grüßen",
        mailbox_key: "service", gmail_message_id: `demo-in-${rnd.int(100000, 999999)}`, gmail_thread_id: `demo-thread-${req.id.slice(0, 12)}`,
        mime_message_id: `<in-${rnd.uuid()}@kunde.example.com>`, in_reply_to: null, references_header: null,
        author_id: null, approved_by: null, received_at: iso(t), sent_at: null, approved_at: null, handled_at: iso(t),
        error_text: null, created_at: iso(t), updated_at: iso(t),
      };
      out.messages.push(message);
      event(t, "message_received", { actorType: "automation", to: "received", data: { message_id: message.id }, visibility: "dispatch" });
      return message;
    };
    const setDeadline = (t, kind, due, actor, reason) => {
      const column = kind === "response" ? "response_due_at" : "service_due_at";
      const old = req[column] ? new Date(req[column]) : null;
      const fulfilled = kind === "response" ? req.first_substantive_response_at : req.completed_at;
      const breach = Boolean(old && old < t && (!fulfilled || new Date(fulfilled) > old));
      event(t, "deadline_changed", { actor, from: old ? iso(old) : null, to: iso(due), note: reason, data: { deadline_kind: kind, old_due_at: old ? iso(old) : null, new_due_at: iso(due), breach_recorded: breach } });
      req[column] = iso(due);
    };
    const cancel = (t, reason, openVisits) => {
      for (const visit of openVisits) {
        if (!["scheduled", "in_progress", "waiting_parts"].includes(visit.status)) continue;
        event(t, "visit_status_changed", { actor: dispatcherId, from: visit.status, to: "cancelled", note: `Anfrage storniert: ${reason}`, visitId: visit.id });
        visit.status = "cancelled";
        visit.cancellation_reason = `Anfrage storniert: ${reason}`;
        visit.updated_at = iso(t);
      }
      setIntake(t, "cancelled", dispatcherId, reason);
      setWork(t, "cancelled", dispatcherId, reason);
      req.cancelled_at = iso(t);
      req.cancellation_reason = reason;
    };

    // Submission, dispatcher assignment, receipt
    event(t0, "submission_received", { data: { source: "website_form", submission_id: req.source_event_key } });
    const tAssign = addMinutes(t0, 1);
    if (!spec.unassigned && ok(tAssign)) {
      req.dispatcher_id = dispatcherId;
      event(tAssign, "dispatcher_assigned", { actorType: "automation", to: dispatcherId, visibility: "dispatch" });
    }
    const receiptSubject = `Eingangsbestätigung Ihrer Serviceanfrage vom ${isoDate(t0).split("-").reverse().join(".")}`;
    sendMessage({ kind: "receipt", created: addMinutes(t0, 2), queued: addMinutes(t0, 2), sent: addMinutes(t0, 3), subject: receiptSubject, body: "Vielen Dank für Ihre Anfrage. Wir melden uns nach der Prüfung. Ein Termin ist damit noch nicht zugesagt." });

    // Agreed response deadline for urgent requests and some others
    if ((spec.responseDeadline ?? (["erheblich", "production_stop"].includes(urgency) || rnd.chance(0.2))) && !spec.unassigned) {
      const t = addMinutes(t0, 6);
      if (ok(t)) setDeadline(t, "response", addHours(t0, ["erheblich", "production_stop"].includes(urgency) ? 4 : 24), dispatcherId, "Rückmeldefrist mit Kunde vereinbart");
    }

    if (cancelStage === "before_intake") {
      const t = nextBusinessTime(addHours(t0, rnd.int(2, 30)));
      if (ok(t)) cancel(t, rnd.pick(C.CANCELLATION_REASONS), []);
      return req;
    }

    // Initial processing
    let processedAt = null;
    const tA = addMinutes(t0, 2);
    const tB = addMinutes(t0, 3);
    const analysisResult = (classification, uncertainties = []) => ({ contract_version: "demo-1", classification, service_kind: serviceKind, priority, uncertainties, proposed_reply: uncertainties.length ? "Bitte senden Sie uns die fehlenden Angaben zur Anlage." : null });
    const substantiveReply = (t, actor) => sendMessage({ kind: "other", created: t, queued: addMinutes(t, actor ? 3 : 1), sent: addMinutes(t, actor ? 5 : 2), author: actor, approver: actor, subject: "Ihre Serviceanfrage: nächste Schritte", body: "Wir haben Ihre Anfrage geprüft und stimmen den Einsatztermin in Kürze mit Ihnen ab." });

    if (["auto", "corrected", "clarify", "review", "reject", "failure"].includes(path)) {
      if (!ok(tA)) return req;
      if (path !== "failure") setIntake(tA, "analyzing", null);
    }
    if (path === "auto" || path === "corrected") {
      const r = run("intake_analysis", tA, tB, "succeeded", "ready_for_planning", rnd.float(0.86, 0.99).toFixed(4), { result: analysisResult("klar") });
      if (!ok(tB)) return req;
      req.priority = priority;
      setIntake(tB, "processed", null);
      completeIntake(tB, "automatic", null);
      processedAt = tB;
      substantiveReply(addMinutes(tB, 1), null);
      if (path === "corrected") {
        const tc = nextBusinessTime(addHours(tB, rnd.int(1, 20)));
        if (ok(tc)) {
          const newPriority = priority === "critical" ? "high" : "critical";
          r.corrected_by = dispatcherId;
          r.corrected_at = iso(tc);
          r.correction_reason = "Automatische Einstufung falsch: Produktionsrelevanz übersehen.";
          r.updated_at = iso(tc);
          event(tc, "automatic_result_corrected", { actor: dispatcherId, from: JSON.stringify({ priority: req.priority }), to: JSON.stringify({ priority: newPriority }), note: r.correction_reason, data: { automation_run_id: r.id }, visibility: "dispatch" });
          req.priority = newPriority;
        }
      }
    } else if (path === "clarify") {
      run("intake_analysis", tA, tB, "succeeded", "ask_customer", rnd.float(0.6, 0.8).toFixed(4), { result: analysisResult("rueckfrage", [rnd.pick(C.UNCERTAINTIES)]) });
      if (!ok(tB)) return req;
      setIntake(tB, "awaiting_customer", null);
      let t = tB;
      const rounds = spec.rounds ?? 1;
      for (let round = 1; round <= rounds; round += 1) {
        const subject = `Rückfrage zu Ihrer Serviceanfrage${round > 1 ? ` (${round})` : ""}`;
        const failFirst = spec.failClarification && round === 1;
        sendMessage({ kind: "clarification", created: addMinutes(t, 1), queued: addMinutes(t, 2), sent: addMinutes(t, 4), subject, body: "Für die Planung benötigen wir noch Angaben vom Typenschild sowie ein Foto der Anlage.", fail: failFirst });
        if (failFirst) {
          t = addMinutes(t, 30);
          if (!ok(t)) return req;
          sendMessage({ kind: "clarification", created: t, queued: addMinutes(t, 1), sent: addMinutes(t, 3), author: dispatcherId, approver: dispatcherId, subject, body: "Erneuter Versand: Bitte senden Sie uns die Angaben vom Typenschild." });
        }
        const replyAt = addHours(t, spec.replyHours ?? rnd.int(3, 50));
        if (!ok(replyAt)) return req;
        const reply = receiveReply(replyAt, subject);
        setIntake(replyAt, "analyzing", null);
        const done = addMinutes(replyAt, 2);
        const last = round === rounds;
        if (last && spec.replyNeedsReview) {
          run("reply_analysis", addMinutes(replyAt, 1), done, "succeeded", "human_review", rnd.float(0.4, 0.6).toFixed(4), { messageId: reply.id, result: analysisResult("pruefung", ["Antwort des Kunden widerspricht der Erstangabe."]) });
          if (!ok(done)) return req;
          req.human_review_required = true;
          setIntake(done, "needs_review", null, "Kundenantwort erhalten, Prüfung erforderlich");
          return req;
        }
        run("reply_analysis", addMinutes(replyAt, 1), done, "succeeded", last ? "ready_for_planning" : "ask_customer", rnd.float(0.8, 0.97).toFixed(4), { messageId: reply.id, result: analysisResult(last ? "klar" : "rueckfrage", last ? [] : [rnd.pick(C.UNCERTAINTIES)]) });
        if (!ok(done)) return req;
        if (!last) {
          setIntake(done, "awaiting_customer", null);
          t = done;
          continue;
        }
        req.priority = priority;
        setIntake(done, "processed", null);
        completeIntake(done, "automatic", null);
        processedAt = done;
      }
    } else if (path === "review" || path === "reject") {
      run("intake_analysis", tA, tB, "succeeded", "human_review", rnd.float(0.38, 0.66).toFixed(4), { result: analysisResult("pruefung", [rnd.pick(C.UNCERTAINTIES)]) });
      if (!ok(tB)) return req;
      req.human_review_required = true;
      setIntake(tB, "needs_review", null);
      const tReview = nextBusinessTime(addHours(tB, spec.reviewHours ?? rnd.float(0.5, 7)));
      if (spec.draftReply && tReview > cutoff) {
        const tDraft = addMinutes(tB, 20);
        if (tDraft <= cutoff) sendMessage({ kind: "clarification", created: tDraft, queued: addHours(cutoff, 24), sent: addHours(cutoff, 25), author: dispatcherId, subject: "Rückfrage zur Sicherheitslage", body: "Bitte bestätigen Sie, ob die Anlage drucklos geschaltet werden kann." });
      }
      if (!ok(tReview)) return req;
      if (path === "reject") {
        const reason = rnd.pick(C.REJECTION_REASONS);
        setIntake(tReview, "rejected", dispatcherId, reason);
        req.rejection_reason = reason;
        completeIntake(tReview, "human_review", dispatcherId, "rejected");
        setWork(tReview, "cancelled", dispatcherId, reason);
        sendMessage({ kind: "other", created: addMinutes(tReview, 2), queued: addMinutes(tReview, 4), sent: addMinutes(tReview, 6), author: dispatcherId, approver: dispatcherId, subject: "Ihre Serviceanfrage", body: "Leider können wir diesen Auftrag nicht übernehmen." });
        return req;
      }
      req.priority = priority;
      setIntake(tReview, "processed", dispatcherId, "Analyse geprüft und freigegeben");
      completeIntake(tReview, "human_review", dispatcherId);
      processedAt = tReview;
      substantiveReply(addMinutes(tReview, 2), dispatcherId);
    } else if (path === "failure" || path === "manual") {
      if (path === "failure") run("intake_analysis", tA, addMinutes(tA, 5), "failed", null, null, { errorCode: "MODEL_TIMEOUT" });
      const tManual = nextBusinessTime(addHours(t0, spec.manualHours ?? rnd.float(0.5, 8)));
      if (!ok(tManual)) return req;
      req.priority = priority;
      setIntake(tManual, "processed", dispatcherId, path === "failure" ? "Manuell bearbeitet nach Analysefehler" : "Manuell bearbeitet");
      completeIntake(tManual, "manual", dispatcherId);
      processedAt = tManual;
      substantiveReply(addMinutes(tManual, 2), dispatcherId);
    }
    if (!processedAt) return req;

    if (cancelStage === "before_schedule") {
      const t = nextBusinessTime(addHours(processedAt, rnd.int(2, 40)));
      if (ok(t)) cancel(t, rnd.pick(C.CANCELLATION_REASONS), []);
      return req;
    }

    // Scheduling
    const urgent = urgency === "production_stop" || urgency === "erheblich";
    const tSched = spec.scheduleAt ?? nextBusinessTime(addHours(processedAt, urgent ? rnd.float(0.3, 2) : rnd.float(2, 30)));
    if (!ok(tSched)) return req;
    const hours = { diagnosis_repair: rnd.pick([2, 3, 3, 4]), scheduled_maintenance: rnd.pick([2, 3]), inspection: rnd.pick([1, 2]) }[serviceKind];
    const earliest = urgency === "production_stop" ? addHours(tSched, 2)
      : urgency === "erheblich" ? berlinDay(tSched, rnd.int(1, 2))
      : urgency === "zeitnah" ? berlinDay(tSched, rnd.int(2, 5))
      : new Date(Math.max(berlinDay(tSched, 3).getTime(), requestedVisitDate.getTime()));
    const slot = spec.slot
      ? (spec.slot.reserved ? spec.slot : bookExact(spec.slot.technicianId, spec.slot.start, spec.slot.end))
      : findSlot(spec.technicianId ? [spec.technicianId] : technicians, earliest, hours, { notBefore: addHours(tSched, 1) });
    if (!slot) return req;
    const visits = [];
    const newVisit = (t, booked) => {
      const visit = { id: rnd.uuid(), request_id: req.id, technician_id: booked.technicianId, status: "scheduled", scheduled_start: iso(booked.start), scheduled_end: iso(booked.end), actual_start: null, actual_end: null, actual_work_minutes: null, summary: null, waiting_reason: null, cancellation_reason: null, created_by: dispatcherId, created_at: iso(t), updated_at: iso(t) };
      out.visits.push(visit);
      visits.push(visit);
      event(t, "visit_scheduled", { actor: dispatcherId, to: `[${iso(booked.start)},${iso(booked.end)})`, data: { technician_id: booked.technicianId, scheduled_start: iso(booked.start), scheduled_end: iso(booked.end) }, visitId: visit.id });
      if (req.technician_id !== booked.technicianId) {
        event(t, "technician_assigned", { actor: dispatcherId, from: req.technician_id, to: booked.technicianId });
        req.technician_id = booked.technicianId;
      }
      return visit;
    };
    const visit1 = newVisit(tSched, slot);
    setWork(tSched, "scheduled", dispatcherId);
    sendMessage({ kind: "other", created: addMinutes(tSched, 3), queued: addMinutes(tSched, 5), sent: addMinutes(tSched, 6), author: dispatcherId, approver: dispatcherId, subject: "Terminbestätigung", body: `Unser Techniker kommt am ${isoDate(slot.start).split("-").reverse().join(".")}.` });
    if (spec.serviceDeadline ?? rnd.chance(0.4)) {
      const t = addMinutes(tSched, 8);
      if (ok(t)) setDeadline(t, "service", spec.serviceDueAt ?? addHours(slot.end, rnd.int(4, 72)), dispatcherId, "Servicetermin mit Kunde vereinbart");
    }

    if (cancelStage === "after_schedule") {
      const t = new Date(Math.min(addHours(tSched, rnd.int(4, 30)).getTime(), slot.start.getTime() - HOUR));
      if (ok(t)) cancel(t, rnd.pick(C.CANCELLATION_REASONS), visits);
      return req;
    }

    // Work entries
    const technicianOf = (visit) => visit.technician_id;
    const addEntry = (t, visit, { kind, status, description, quantity, unitPrice, rate = null, billable = true }) => {
      const entry = { id: rnd.uuid(), request_id: req.id, visit_id: visit?.id ?? null, author_id: technicianOf(visit), kind, item_status: status, service_rate_id: rate?.id ?? null, description, quantity, unit: { labor: "hour", part: "piece", fixed_service: "service" }[kind], unit_price: unitPrice, tax_rate: TAX_RATE, billable, ordered_at: status === "ordered" ? iso(t) : null, performed_at: ["performed", "used"].includes(status) ? iso(t) : null, created_at: iso(t), updated_at: iso(t) };
      out.work_entries.push(entry);
      event(t, "work_entry_added", { actor: entry.author_id, to: status, data: { work_entry_id: entry.id, kind, description, quantity, unit_price: unitPrice, billable }, visitId: entry.visit_id });
      return entry;
    };
    const recordWork = (t, visit, minutes, partCount) => {
      if (serviceKind === "diagnosis_repair") {
        const rate = rateFor("diagnosis_repair", t);
        addEntry(t, visit, { kind: "labor", status: "performed", description: "Fehlersuche und Instandsetzung", quantity: Math.max(0.5, Math.round(minutes / 30) / 2), unitPrice: rate.unit_price, rate });
        for (let i = 0; i < partCount; i += 1) {
          const [name, price] = rnd.pick(C.PARTS[equipmentKind]);
          addEntry(t, visit, { kind: "part", status: "used", description: name, quantity: rnd.int(1, 2), unitPrice: price });
        }
      } else {
        const rate = rateFor(serviceKind, t);
        addEntry(t, visit, { kind: "fixed_service", status: "performed", description: rate.display_name.replace(/ \(bis .*\)$/, ""), quantity: 1, unitPrice: rate.unit_price, rate });
        if (serviceKind === "scheduled_maintenance" && rnd.chance(0.12)) {
          const hourly = rateFor("diagnosis_repair", t);
          addEntry(t, visit, { kind: "labor", status: "performed", description: "Zusätzliche Arbeit auf Kundenwunsch", quantity: 1, unitPrice: hourly.unit_price });
        }
      }
      if (rnd.chance(0.05)) addEntry(t, visit, { kind: "labor", status: "performed", description: "Kulanz: Nachkontrolle", quantity: 0.5, unitPrice: rateFor("diagnosis_repair", t).unit_price, billable: false });
    };
    const startVisit = (visit) => {
      const t = addMinutes(new Date(visit.scheduled_start), rnd.int(0, 12));
      if (!ok(t)) return null;
      event(t, "visit_status_changed", { actor: visit.technician_id, from: "scheduled", to: "in_progress", visitId: visit.id });
      visit.status = "in_progress";
      visit.actual_start = iso(t);
      visit.updated_at = iso(t);
      setWork(t, "in_progress", visit.technician_id);
      return t;
    };
    const finishVisit = (visit, t, minutes, summary) => {
      event(t, "visit_status_changed", { actor: visit.technician_id, from: visit.status, to: "completed", note: summary, data: { actual_work_minutes: minutes }, visitId: visit.id });
      visit.status = "completed";
      visit.actual_end = iso(t);
      visit.actual_work_minutes = minutes;
      visit.summary = summary;
      visit.updated_at = iso(t);
    };

    const partsCase = "partsCase" in spec ? spec.partsCase : serviceKind === "diagnosis_repair" && rnd.chance(0.2) ? "repeat" : null;
    const started = startVisit(visit1);
    if (!started) return req;
    let lastEnd;
    if (partsCase) {
      const tWait = addMinutes(started, rnd.int(50, 90));
      if (!ok(tWait)) return req;
      const [partName, partPrice] = rnd.pick(C.PARTS[equipmentKind]);
      const ordered = addEntry(tWait, visit1, { kind: "part", status: "ordered", description: partName, quantity: 1, unitPrice: partPrice });
      const reason = `${partName} bestellt`;
      event(tWait, "visit_status_changed", { actor: visit1.technician_id, from: "in_progress", to: "waiting_parts", note: reason, visitId: visit1.id });
      visit1.status = "waiting_parts";
      visit1.waiting_reason = reason;
      visit1.updated_at = iso(tWait);
      setWork(tWait, "waiting_parts", visit1.technician_id, reason);
      if (partsCase === "open") return req;
      const tClose1 = addMinutes(tWait, 10);
      if (!ok(tClose1)) return req;
      const minutes1 = Math.round((tClose1 - started) / MINUTE);
      recordWork(tClose1, visit1, minutes1, 0);
      finishVisit(visit1, tClose1, minutes1, "Diagnose abgeschlossen, Ersatzteil bestellt. Folgeeinsatz erforderlich.");
      const tParts = nextBusinessTime(addHours(tClose1, rnd.int(48, 140)));
      if (!ok(tParts)) return req;
      const slot2 = findSlot([visit1.technician_id, ...technicians], berlinDay(tParts, 1), 2, { notBefore: addHours(tParts, 2) });
      if (!slot2) return req;
      const visit2 = newVisit(tParts, slot2);
      setWork(tParts, "scheduled", dispatcherId, "Ersatzteil eingetroffen");
      if (spec.missedServiceDeadline && req.service_due_at && new Date(req.service_due_at) < tParts) {
        setDeadline(addMinutes(tParts, 2), "service", addHours(slot2.end, 24), dispatcherId, "Ersatzteil verspätet, neuer Termin vereinbart");
      }
      const started2 = startVisit(visit2);
      if (!started2) return req;
      const tUse = addMinutes(started2, 30);
      if (!ok(tUse)) return req;
      event(tUse, "work_entry_changed", { actor: visit2.technician_id, from: "ordered", to: "used", data: { work_entry_id: ordered.id }, visitId: visit2.id });
      ordered.item_status = "used";
      ordered.performed_at = iso(tUse);
      ordered.updated_at = iso(tUse);
      const end2 = addMinutes(started2, rnd.int(60, 110));
      if (!ok(end2)) return req;
      const minutes2 = Math.round((end2 - started2) / MINUTE);
      recordWork(end2, visit2, minutes2, 0);
      finishVisit(visit2, end2, minutes2, `${partName} eingebaut, Probelauf erfolgreich.`);
      lastEnd = end2;
    } else {
      const end = spec.forceLongVisit ? addHours(cutoff, 1) : addMinutes(started, Math.round(hours * 60 * rnd.float(0.75, 1.1)));
      if (!ok(end)) return req;
      const minutes = Math.round((end - started) / MINUTE);
      recordWork(end, visit1, minutes, serviceKind === "diagnosis_repair" ? rnd.weighted([[0, 0.45], [1, 0.4], [2, 0.15]]) : 0);
      finishVisit(visit1, end, minutes, rnd.pick(C.SUMMARIES[serviceKind]));
      lastEnd = end;
    }

    // Closure by the current technician
    const tDone = addMinutes(lastEnd, rnd.int(10, 60));
    if (!ok(tDone)) return req;
    const summary = rnd.pick(C.SUMMARIES[serviceKind]);
    setWork(tDone, "completed", req.technician_id);
    req.completed_at = iso(tDone);
    req.completion_summary = summary;
    event(tDone, "work_completed", { actor: req.technician_id, note: summary, data: { completed_at: iso(tDone) } });

    // Invoice: technician issues, dispatcher sends, manager records payment
    const tInvoice = nextBusinessTime(addHours(tDone, rnd.float(0.2, 30)));
    if (!ok(tInvoice)) return req;
    const invoice = { id: rnd.uuid(), request_id: req.id, invoice_number: null, status: "draft", created_by: req.technician_id, issued_by: null, issue_date: null, payment_due_date: null, issued_at: null, sent_at: null, paid_at: null, subtotal: 0, tax_total: 0, total: 0, currency: "EUR", seller_snapshot: {}, customer_snapshot: {}, notes: null, created_at: iso(tInvoice), updated_at: iso(tInvoice) };
    out.invoices.push(invoice);
    const billable = out.work_entries.filter((w) => w.request_id === req.id && w.billable && ((w.kind !== "part" && w.item_status === "performed") || (w.kind === "part" && w.item_status === "used")));
    billable.forEach((w, index) => {
      const amounts = lineAmounts(w.quantity, w.unit_price, w.tax_rate);
      out.invoice_items.push({ id: rnd.uuid(), invoice_id: invoice.id, work_entry_id: w.id, position: index + 1, kind: w.kind, description: w.description, unit: w.unit, quantity: w.quantity, unit_price: w.unit_price, tax_rate: w.tax_rate, net_amount: amounts.net, tax_amount: amounts.tax, gross_amount: amounts.gross, created_at: iso(tInvoice) });
    });
    event(tInvoice, "invoice_created", { actor: req.technician_id, to: "draft", data: { invoice_id: invoice.id } });
    if (spec.invoiceDraftOnly) return req;
    const tIssue = addMinutes(tInvoice, 2);
    if (!ok(tIssue)) return req;
    invoice.status = "issued";
    invoice.issued_by = req.technician_id;
    invoice.issued_at = iso(tIssue);
    invoice.issue_date = isoDate(tIssue);
    invoice.payment_due_date = isoDate(berlinDay(tIssue, 14));
    invoice.seller_snapshot = { ...COMPANY_DETAILS, currency: "EUR", payment_terms_days: 14 };
    invoice.customer_snapshot = { company_name: req.company_name, contact_name: req.contact_name, business_email: req.business_email, phone_number: req.phone_number, customer_number: req.customer_number, street_house_number: req.street_house_number, postal_code: req.postal_code, city: req.city, site_label: req.site_label };
    invoice.updated_at = iso(tIssue);
    event(tIssue, "invoice_issued", { actor: req.technician_id, from: "draft", to: "issued", data: { invoice_id: invoice.id, items: billable.length } });

    if (spec.invoiceNotSent) return req;
    const tMail = nextBusinessTime(addHours(tIssue, rnd.float(0.5, 20)));
    const mail = sendMessage({ kind: "invoice", created: tMail, queued: addMinutes(tMail, 2), sent: addMinutes(tMail, 3), author: dispatcherId, approver: dispatcherId, subject: "Ihre Rechnung (Musterrechnung / Demodaten)", body: "Anbei erhalten Sie die Rechnung zu Ihrem Serviceeinsatz.", invoice });
    if (mail?.status === "sent") {
      invoice.status = "sent";
      invoice.sent_at = mail.sent_at;
      invoice.updated_at = mail.sent_at;
      event(new Date(mail.sent_at), "invoice_sent", { actorType: "automation", from: "issued", to: "sent", data: { invoice_id: invoice.id, message_id: mail.id } });
    }
    const unpaid = spec.unpaid ?? rnd.chance(0.1);
    const tPaid = unpaid ? null : nextBusinessTime(addHours(new Date(invoice.sent_at ?? invoice.issued_at), 24 * rnd.int(5, 40)));
    // Payment reminders (task-10-2): stage 1 seven days after the due date, then every 14 days, until payment or cutoff
    if (invoice.status === "sent") {
      const [y, m, d] = invoice.payment_due_date.split("-").map(Number);
      let tReminder = addHours(berlinDay(berlinTime(y, m, d), 7), 6);
      for (const stage of [1, 2, 3]) {
        if (tReminder > cutoff || (tPaid && tReminder >= tPaid)) break;
        const subject = [`Zahlungserinnerung zu Rechnung`, `1. Mahnung zu Rechnung`, `2. Mahnung zu Rechnung`][stage - 1] + " (Demodaten)";
        const reminder = sendMessage({ kind: "payment_reminder", created: tReminder, queued: tReminder, sent: addMinutes(tReminder, 1), systemApproved: true, subject, body: "Für die Rechnung ist noch kein Zahlungseingang verbucht. Bitte überweisen Sie den offenen Betrag.", invoice });
        out.invoice_reminders.push({ id: rnd.uuid(), invoice_id: invoice.id, stage, message_id: reminder.id, trigger: "automatic", created_by: null, created_at: iso(tReminder) });
        event(tReminder, "payment_reminder_queued", { actorType: "automation", from: stage > 1 ? String(stage - 1) : null, to: String(stage), data: { invoice_id: invoice.id, message_id: reminder.id, stage, approved_by: "system" }, visibility: "management" });
        tReminder = addHours(berlinDay(tReminder, 14), 6);
      }
    }
    if (unpaid || invoice.status !== "sent" || !ok(tPaid)) return req;
    event(tPaid, "invoice_paid", { actor: staff.manager, from: "sent", to: "paid", data: { invoice_id: invoice.id, paid_at: iso(tPaid) }, visibility: "management" });
    invoice.status = "paid";
    invoice.paid_at = iso(tPaid);
    invoice.updated_at = iso(tPaid);
    return req;
  }

  // Required cases as fixtures (processed first so their calendar slots are guaranteed)
  const daysAgo = (days, hour = 9, minute = 0) => {
    const day = berlinParts(berlinDay(cutoff, -days));
    return berlinTime(day.year, day.month, day.day, hour, minute);
  };
  const lastBusiness = (days, hour) => nextBusinessTime(daysAgo(days, hour));
  const fixtures = [
    { demoCase: "Sichere automatische Bearbeitung", path: "auto", createdAt: lastBusiness(45, 9), serviceKind: "scheduled_maintenance", urgency: "planbar", safetyRisk: "none_known", unpaid: false, cancelStage: null },
    { demoCase: "Rückfrage und Kundenantwort", path: "clarify", createdAt: lastBusiness(40, 10), serviceKind: "diagnosis_repair", urgency: "zeitnah", safetyRisk: "none_known", cancelStage: null, partsCase: null },
    { demoCase: "Geringe Konfidenz mit menschlicher Freigabe", path: "review", createdAt: lastBusiness(35, 11), serviceKind: "diagnosis_repair", safetyRisk: "unclear", cancelStage: null, partsCase: null },
    { demoCase: "Korrigierter Modellfehler", path: "corrected", createdAt: lastBusiness(33, 8), serviceKind: "diagnosis_repair", urgency: "zeitnah", safetyRisk: "none_known", cancelStage: null, partsCase: null },
    { demoCase: "Technischer Fehler der Analyse", path: "failure", createdAt: lastBusiness(30, 13), serviceKind: "inspection", safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Ablehnung", path: "reject", createdAt: lastBusiness(28, 10), safetyRisk: "unclear", cancelStage: null },
    { demoCase: "Stornierung nach Planung", path: "auto", createdAt: lastBusiness(26, 9), serviceKind: "inspection", urgency: "planbar", safetyRisk: "none_known", cancelStage: "after_schedule" },
    { demoCase: "Versäumte vereinbarte Frist", path: "manual", createdAt: lastBusiness(60, 15), serviceKind: "diagnosis_repair", urgency: "erheblich", safetyRisk: "none_known", cancelStage: null, responseDeadline: true, manualHours: 26, serviceDeadline: true, serviceDueAt: null, partsCase: "repeat", missedServiceDeadline: true, unpaid: false },
    { demoCase: "Keine Fristzusage", path: "auto", createdAt: lastBusiness(22, 10), serviceKind: "scheduled_maintenance", urgency: "planbar", safetyRisk: "none_known", cancelStage: null, responseDeadline: false, serviceDeadline: false },
    { demoCase: "Bestellte Teile und Folgeeinsatz", path: "auto", createdAt: lastBusiness(50, 9), serviceKind: "diagnosis_repair", urgency: "zeitnah", safetyRisk: "none_known", cancelStage: null, partsCase: "repeat", unpaid: false },
    { demoCase: "Abgeschlossen mit offener Rechnung", path: "auto", createdAt: lastBusiness(55, 10), serviceKind: "diagnosis_repair", urgency: "zeitnah", safetyRisk: "none_known", cancelStage: null, partsCase: null, unpaid: true },
    { demoCase: "Mehrere Läufe und Nachrichten, ein Abschluss", path: "clarify", rounds: 2, failClarification: true, createdAt: lastBusiness(38, 8), serviceKind: "scheduled_maintenance", safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Warten auf Ersatzteil (offen)", path: "auto", createdAt: lastBusiness(4, 8), serviceKind: "diagnosis_repair", urgency: "erheblich", safetyRisk: "none_known", cancelStage: null, partsCase: "open" },
    { demoCase: "Rechnungsentwurf", path: "auto", createdAt: lastBusiness(9, 8), serviceKind: "inspection", urgency: "zeitnah", safetyRisk: "none_known", cancelStage: null, invoiceDraftOnly: true },
    { demoCase: "Stornierung vor Abschluss der Erstbearbeitung", path: "clarify", createdAt: lastBusiness(12, 9), replyHours: 400, cancelStage: "before_intake", safetyRisk: "none_known" },
    { demoCase: "Prüfung offen mit E-Mail-Entwurf", path: "review", createdAt: addHours(cutoff, -3), reviewHours: 200, draftReply: true, safetyRisk: "known", cancelStage: null },
    { demoCase: "Warten auf Kundenantwort", path: "clarify", createdAt: addHours(cutoff, -26), replyHours: 300, safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Neu und noch nicht zugewiesen", path: "manual", createdAt: addMinutes(cutoff, -25), manualHours: 200, unassigned: true, safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Analyse läuft", path: "auto", createdAt: addMinutes(cutoff, -2.5), safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Kundenantwort erhalten", path: "clarify", createdAt: addHours(cutoff, -30), replyHours: 27, replyNeedsReview: true, safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Kundenantwort erhalten (2)", path: "clarify", createdAt: addHours(cutoff, -52), replyHours: 46, replyNeedsReview: true, safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Prüfung offen", path: "review", createdAt: addHours(cutoff, -7), reviewHours: 200, safetyRisk: "unclear", cancelStage: null },
    { demoCase: "Prüfung offen (2)", path: "review", createdAt: addHours(cutoff, -20), reviewHours: 200, safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Warten auf Kundenantwort (2)", path: "clarify", createdAt: addHours(cutoff, -50), replyHours: 300, safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Rechnung ausgestellt, Versand ausstehend", path: "auto", createdAt: lastBusiness(10, 9), serviceKind: "scheduled_maintenance", urgency: "zeitnah", safetyRisk: "none_known", cancelStage: null, partsCase: null, invoiceNotSent: true },
    { demoCase: "Bearbeitet, Planung ausstehend (2)", path: "auto", createdAt: addHours(cutoff, -9), scheduleAt: addHours(cutoff, 30), safetyRisk: "none_known", cancelStage: null },
    { demoCase: "Bearbeitet, Planung ausstehend", path: "manual", createdAt: addHours(cutoff, -5), manualHours: 0.3, scheduleAt: addHours(cutoff, 48), safetyRisk: "none_known", cancelStage: null },
  ];

  // Current-week tasks for every technician (technician 3 is absent Thursday/Friday)
  technicians.forEach((technicianId, index) => {
    for (let offset = 0; offset < 7; offset += 1) {
      const day = berlinDay(weekStart, (cutoffParts.weekday - 1 + index + offset) % 5);
      const p = berlinParts(day);
      const start = berlinTime(p.year, p.month, p.day, 9 + index, 0);
      const end = addHours(start, 2);
      if (!bookExact(technicianId, start, end)) continue;
      fixtures.push({ demoCase: `Einsatz dieser Woche (${index + 1})`, path: "auto", createdAt: nextBusinessTime(berlinDay(weekStart, -7 + index)), serviceKind: "scheduled_maintenance", urgency: "planbar", safetyRisk: "none_known", cancelStage: null, partsCase: null, scheduleAt: nextBusinessTime(berlinDay(weekStart, -5 + index)), slot: { technicianId, start, end, reserved: true } });
      break;
    }
  });

  // A visit in progress right now (or since the last working day)
  {
    const p = berlinParts(cutoff);
    const todayStart = p.weekday <= 5 && p.hour >= 8 && p.hour < 15 ? berlinTime(p.year, p.month, p.day, p.hour - 1, 0) : null;
    let start = todayStart;
    if (!start) {
      for (let d = 1; d <= 4 && !start; d += 1) {
        const q = berlinParts(berlinDay(cutoff, -d));
        if (q.weekday <= 5) start = berlinTime(q.year, q.month, q.day, 14, 0);
      }
    }
    const end = addHours(start, 2);
    const technicianId = technicians.find((id) => isFree(id, start, end));
    if (technicianId && bookExact(technicianId, start, end)) {
      fixtures.push({ demoCase: "Einsatz läuft", path: "auto", createdAt: nextBusinessTime(berlinDay(start, -6)), serviceKind: "diagnosis_repair", urgency: "zeitnah", safetyRisk: "none_known", cancelStage: null, partsCase: null, scheduleAt: nextBusinessTime(berlinDay(start, -4)), slot: { technicianId, start, end, reserved: true }, forceLongVisit: true });
    }
  }

  for (const fixture of fixtures) simulate(fixture);

  // Regular volume: 24 calendar months including the current one, seasonal and slightly growing
  const anchorParts = berlinParts(anchor);
  const specs = [];
  for (let back = 23; back >= 0; back -= 1) {
    const first = new Date(Date.UTC(anchorParts.year, anchorParts.month - 1 - back, 1));
    const monthStart = berlinTime(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
    const nextMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
    const monthEnd = new Date(Math.min(berlinTime(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1).getTime(), cutoff.getTime()));
    const fullSpan = berlinTime(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1) - monthStart;
    const share = (monthEnd - monthStart) / fullSpan;
    const trend = 0.92 + 0.16 * ((23 - back) / 23);
    const count = Math.max(0, Math.round(24.5 * SEASON[first.getUTCMonth()] * trend * share + rnd.int(-2, 2) * share));
    for (let i = 0; i < count; i += 1) {
      let createdAt;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const t = new Date(monthStart.getTime() + rnd.next() * (monthEnd - monthStart));
        const p = berlinParts(t);
        const businessHours = p.weekday <= 5 && p.hour >= 7 && p.hour < 18;
        if (businessHours || rnd.chance(0.15)) {
          createdAt = t;
          break;
        }
      }
      if (createdAt && createdAt < addHours(cutoff, -0.5)) specs.push({ createdAt });
    }
  }
  specs.sort((a, b) => a.createdAt - b.createdAt);
  for (const spec of specs) simulate(spec);

  // Unmatched incoming e-mail in a dispatcher inbox (seed-owned, not linked to a request)
  const unmatchedAt = addHours(cutoff, -4);
  const unmatched = {
    id: rnd.uuid(), request_id: null, inbox_dispatcher_id: staff.dispatchers[0], invoice_id: null, direction: "incoming",
    kind: "other", status: "received", from_address: "einkauf.unbekannt@example.com", to_address: COMPANY_DETAILS.email,
    subject: "Frage zu unserem Auftrag", body_text: "Guten Tag, wann kommt Ihr Techniker? Eine Anfragenummer liegt mir nicht vor.",
    mailbox_key: "service", gmail_message_id: `demo-in-${rnd.int(100000, 999999)}`, gmail_thread_id: `demo-thread-unmatched`,
    mime_message_id: `<unmatched-${rnd.uuid()}@kunde.example.com>`, in_reply_to: null, references_header: null,
    author_id: null, approved_by: null, received_at: iso(unmatchedAt), sent_at: null, approved_at: null, handled_at: null,
    error_text: null, created_at: iso(unmatchedAt), updated_at: iso(unmatchedAt),
  };
  out.messages.push(unmatched);
  out.automation_runs.push({
    id: rnd.uuid(), request_id: null, message_id: unmatched.id, operation_key: `demo:${anchorKey}:email_matching:unmatched`,
    workflow_execution_id: `demo-exec-${rnd.int(100000, 999999)}`, step: "email_matching", input_version: null,
    status: "succeeded", decision: "unmatched", confidence: "0.2100", result: { contract_version: "demo-1", reason: "Keine Anfragenummer und kein passender Thread" },
    error_code: null, error_text: null, corrected_by: null, corrected_at: null, correction_reason: null,
    started_at: iso(addMinutes(unmatchedAt, 1)), finished_at: iso(addMinutes(unmatchedAt, 2)), created_at: iso(addMinutes(unmatchedAt, 1)), updated_at: iso(addMinutes(unmatchedAt, 2)),
  });

  return { payload: out, cutoff, rateChange };
}
