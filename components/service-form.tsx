"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Breadcrumb, Container, Icon, Panel, Section } from "./ui";
import { Turnstile } from "./turnstile";
import type { Attachment, InvalidField, ServiceRequestPayload } from "@/lib/form-contract";

type FormValues = {
  company: string; contactName: string; email: string; phone: string; customerNumber: string;
  siteName: string; street: string; postalCode: string; city: string; equipmentType: string; manufacturer: string; model: string; machineNumber: string;
  serviceType: string; description: string; urgency: string; safetyHazard: string; desiredDate: string; desiredTime: string;
  slaNumber: string; sla247: string; privacyConsent: boolean;
};
type FormKey = keyof FormValues;
type FormErrors = Partial<Record<FormKey, string>>;
type FileItem = { id: string; file: File; status: "ready" | "uploading" | "done" | "error"; progress: number; error?: string; attachment?: Attachment };

const emptyForm: FormValues = { company: "", contactName: "", email: "", phone: "", customerNumber: "", siteName: "", street: "", postalCode: "", city: "", equipmentType: "", manufacturer: "", model: "", machineNumber: "", serviceType: "", description: "", urgency: "", safetyHazard: "", desiredDate: "", desiredTime: "", slaNumber: "", sla247: "", privacyConsent: false };
const steps = ["Kontakt", "Standort und Anlage", "Anfrage", "Vertrag und Anhänge", "Prüfen und senden"];
const acceptedTypes = ["application/pdf", "image/jpeg", "image/png"];
const maxFileSize = 5 * 1024 * 1024;

const fieldMap: Partial<Record<InvalidField, FormKey>> = {
  "contact.company_name": "company", "contact.contact_name": "contactName", "contact.business_email": "email", "contact.phone": "phone",
  "site_and_equipment.street_and_number": "street", "site_and_equipment.postal_code": "postalCode", "site_and_equipment.city": "city", "site_and_equipment.equipment_type": "equipmentType",
  "request.service_type": "serviceType", "request.description": "description", "request.urgency": "urgency", "request.known_safety_hazard": "safetyHazard", "request.preferred_service_date": "desiredDate", privacy_consent: "privacyConsent",
};
const labels: Record<FormKey, string> = {
  company: "Unternehmen", contactName: "Kontaktperson", email: "E-Mail-Adresse", phone: "Telefonnummer", customerNumber: "Kundennummer", siteName: "Standortbezeichnung", street: "Straße und Hausnummer", postalCode: "PLZ", city: "Ort", equipmentType: "Anlage oder Gerät", manufacturer: "Hersteller", model: "Modell oder Typ", machineNumber: "Maschinennummer", serviceType: "Art der Leistung", description: "Beschreibung", urgency: "Dringlichkeit", safetyHazard: "Sicherheitsgefahr", desiredDate: "Gewünschter Einsatztermin", desiredTime: "Gewünschte Uhrzeit", slaNumber: "SLA-Vertragsnummer", sla247: "24/7-Notfall-SLA", privacyConsent: "Zustimmung zur Datenverarbeitung",
};

function validate(values: FormValues, step: number): FormErrors {
  const errors: FormErrors = {};
  const text = (key: FormKey) => String(values[key] ?? "").trim();
  if (step === 1) {
    if (text("company").length < 2) errors.company = "Bitte geben Sie das Unternehmen an.";
    if (text("contactName").length < 2) errors.contactName = "Bitte geben Sie Vor- und Nachname der Kontaktperson an.";
    if (!/^[^@\s]+@(?:[^@\s.]+\.)+[a-z]{2,}$/i.test(text("email"))) errors.email = "Bitte geben Sie eine geschäftliche E-Mail-Adresse mit @ und Domain an.";
    if (!/^[+0][\d\s()/-]{6,}$/.test(text("phone"))) errors.phone = "Bitte geben Sie eine Telefonnummer mit Vorwahl an.";
  }
  if (step === 2) {
    if (text("street").length < 4) errors.street = "Bitte geben Sie Straße und Hausnummer an.";
    if (!/^\d{5}$/.test(text("postalCode"))) errors.postalCode = "Die PLZ besteht aus fünf Ziffern, z. B. 68169.";
    if (text("city").length < 2) errors.city = "Bitte geben Sie den Ort an.";
    if (!text("equipmentType")) errors.equipmentType = "Bitte wählen Sie die Anlage oder das Gerät.";
  }
  if (step === 3) {
    if (!text("serviceType")) errors.serviceType = "Bitte wählen Sie die Art der Leistung.";
    if (text("description").length < 10) errors.description = "Bitte beschreiben Sie die Aufgabe oder Störung in einem Satz.";
    if (!text("urgency")) errors.urgency = "Bitte wählen Sie die Dringlichkeit.";
    if (!text("safetyHazard")) errors.safetyHazard = "Bitte wählen Sie, ob eine Sicherheitsgefahr bekannt ist.";
    if (!text("desiredDate")) errors.desiredDate = "Bitte geben Sie einen gewünschten Einsatztermin an.";
  }
  if (step === 5 && !values.privacyConsent) errors.privacyConsent = "Ohne diese Zustimmung können wir die Anfrage nicht annehmen.";
  return errors;
}

const isCritical = (values: FormValues) => values.urgency === "Produktionsstillstand" || values.safetyHazard === "Ja" || values.safetyHazard === "Unklar";
const safeFileName = (name: string) => name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
const equipmentValues: Record<string, string> = { Pumpe: "pump", Kompressor: "compressor", Lüftungsanlage: "ventilation", Sonstiges: "other" };
const serviceValues: Record<string, string> = { Inspektion: "inspection", "Planmäßige Wartung": "maintenance", "Diagnose und Reparatur": "repair" };
// Wished time (task-19-3): the database holds this window for a free technician, otherwise the next free one
const timeOptions = ["Beliebig", "Vormittag", "Nachmittag", ...["07", "08", "09", "10", "11", "12", "13", "14"].map((hour) => `${hour}:00 Uhr`)];
const timeValues: Record<string, string> = { Beliebig: "any", Vormittag: "morning", Nachmittag: "afternoon", ...Object.fromEntries(["07", "08", "09", "10", "11", "12", "13", "14"].map((hour) => [`${hour}:00 Uhr`, `${hour}:00`])) };
const urgencyValues: Record<string, string> = { Planbar: "planned", Zeitnah: "time_sensitive", Erheblich: "significant", Produktionsstillstand: "production_stop" };
const safetyValues: Record<string, string> = { Nein: "no", Ja: "yes", Unklar: "unclear" };

export function ServiceRequestForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [files, setFiles] = useState<FileItem[]>([]);
  const [submissionId, setSubmissionId] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [sending, setSending] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [feedbackScrollRequest, setFeedbackScrollRequest] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = sessionStorage.getItem("rheinwerk-service-request");
        if (saved) setValues({ ...emptyForm, ...JSON.parse(saved) });
        const storedId = sessionStorage.getItem("rheinwerk-submission-id") || crypto.randomUUID();
        sessionStorage.setItem("rheinwerk-submission-id", storedId);
        setSubmissionId(storedId);
      } catch { setSubmissionId(crypto.randomUUID()); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (submissionId) sessionStorage.setItem("rheinwerk-service-request", JSON.stringify(values));
  }, [submissionId, values]);
  useEffect(() => {
    if (!feedbackScrollRequest) return;
    feedbackRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
    });
  }, [feedbackScrollRequest]);

  const update = <K extends FormKey>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setFormMessage("");
  };
  const goTo = (next: number) => { setStep(next); };
  const next = () => {
    const found = validate(values, step);
    if (Object.keys(found).length) {
      setErrors((current) => ({ ...current, ...found }));
      return;
    }
    goTo(Math.min(step + 1, 5));
  };
  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    const available = Math.max(0, 3 - files.length);
    if (selected.length > available) setFormMessage("Sie können höchstens drei Dateien anhängen.");
    const incoming = Array.from(selected).slice(0, available).map<FileItem>((file) => {
      const invalidType = !acceptedTypes.includes(file.type);
      const invalidSize = file.size > maxFileSize;
      return { id: crypto.randomUUID(), file, status: invalidType || invalidSize ? "error" : "ready", progress: 0, error: invalidType ? "Nur PDF, JPG und PNG sind erlaubt." : invalidSize ? "Die Datei ist größer als 5 MB." : undefined };
    });
    setFiles((current) => [...current, ...incoming]);
  };

  const uploadFiles = async () => {
    const uploaded: Attachment[] = [];
    for (const item of files) {
      if (item.status === "error") throw new Error("Bitte entfernen oder korrigieren Sie fehlerhafte Dateien.");
      if (item.attachment) { uploaded.push(item.attachment); continue; }
      setFiles((current) => current.map((file) => file.id === item.id ? { ...file, status: "uploading", progress: 1 } : file));
      try {
        const blob = await upload(`service-requests/${submissionId}/${safeFileName(item.file.name)}`, item.file, {
          access: "private",
          handleUploadUrl: "/api/upload",
          contentType: item.file.type,
          onUploadProgress: ({ percentage }) => setFiles((current) => current.map((file) => file.id === item.id ? { ...file, progress: percentage } : file)),
        });
        const attachment: Attachment = { file_name: item.file.name, pathname: blob.pathname, mime_type: blob.contentType, size_bytes: item.file.size, upload_status: "uploaded", url: blob.url, download_url: blob.downloadUrl };
        uploaded.push(attachment);
        setFiles((current) => current.map((file) => file.id === item.id ? { ...file, status: "done", progress: 100, attachment } : file));
      } catch {
        setFiles((current) => current.map((file) => file.id === item.id ? { ...file, status: "error", error: "Die Datei konnte nicht übertragen werden." } : file));
        throw new Error("Mindestens eine Datei konnte nicht übertragen werden.");
      }
    }
    return uploaded;
  };

  const submit = async () => {
    const found = validate(values, 5);
    if (Object.keys(found).length) { setErrors(found); setFeedbackScrollRequest((current) => current + 1); return; }
    if (!turnstileToken) { setFormMessage("Bitte schließen Sie die Sicherheitsprüfung ab."); setFeedbackScrollRequest((current) => current + 1); return; }
    setSending(true); setFormMessage("");
    try {
      const attachments = await uploadFiles();
      const id = submissionId || crypto.randomUUID();
      const payload: ServiceRequestPayload = {
        schema_version: "1.0", submission_id: id, source: "rheinwerk_website_service_request", locale: "de-DE", submitted_at: new Date().toISOString(),
        contact: { company_name: values.company.trim(), contact_name: values.contactName.trim(), business_email: values.email.trim(), phone: values.phone.trim(), customer_number: values.customerNumber.trim() || undefined },
        site_and_equipment: { site_name: values.siteName.trim(), street_and_number: values.street.trim(), postal_code: values.postalCode.trim(), city: values.city.trim(), equipment_type: equipmentValues[values.equipmentType], manufacturer: values.manufacturer.trim() || undefined, model_or_type: values.model.trim() || undefined, machine_number: values.machineNumber.trim() },
        request: { service_type: serviceValues[values.serviceType], preferred_service_date: values.desiredDate, preferred_time: timeValues[values.desiredTime] ?? "any", description: values.description.trim(), urgency: urgencyValues[values.urgency], known_safety_hazard: safetyValues[values.safetyHazard], requires_human_review: isCritical(values) },
        contract_and_attachments: { customer_or_sla_contract_number: values.slaNumber.trim() || undefined, emergency_sla_24_7: values.sla247 === "Ja", attachments },
        privacy_consent: values.privacyConsent, turnstile_token: turnstileToken || undefined,
      };
      const response = await fetch("/api/service-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})) as { status?: string; ticket_key?: string; human_review?: boolean; message?: string; invalid_fields?: InvalidField[] };
      if (response.status === 201 && result.status === "created") {
        sessionStorage.removeItem("rheinwerk-service-request"); sessionStorage.removeItem("rheinwerk-submission-id");
        router.push(`/bestaetigung?ticket=${encodeURIComponent(result.ticket_key || "")}&human_review=${result.human_review === true}&attachments=${attachments.length}`); return;
      }
      if (response.status === 409 && result.status === "duplicate") {
        sessionStorage.removeItem("rheinwerk-service-request"); sessionStorage.removeItem("rheinwerk-submission-id");
        router.push(`/bestaetigung?duplicate=1&attachments=${attachments.length}`); return;
      }
      if (response.status === 400 && result.invalid_fields?.length) {
        setTurnstileToken(""); setTurnstileResetSignal((current) => current + 1);
        const mapped: FormErrors = {};
        let attachmentError = false;
        result.invalid_fields.forEach((field) => {
          if (field === "contract_and_attachments.attachments") { attachmentError = true; return; }
          const key = fieldMap[field]; if (key) mapped[key] = `${labels[key]}: Bitte prüfen Sie diese Angabe.`;
        });
        setErrors(mapped);
        const first = Object.keys(mapped)[0] as FormKey | undefined;
        if (first) setStep(stepForField(first));
        else if (attachmentError) setStep(4);
        setFormMessage(attachmentError ? "Bitte prüfen Sie Dateityp, Dateigröße und Anzahl der Anhänge." : "Bitte korrigieren Sie die aufgeführten Angaben.");
        setFeedbackScrollRequest((current) => current + 1);
        return;
      }
      setTurnstileToken(""); setTurnstileResetSignal((current) => current + 1);
      if (response.status === 400 && result.status === "turnstile_failed") setFormMessage("Die Sicherheitsprüfung ist abgelaufen oder fehlgeschlagen. Bitte führen Sie sie erneut aus.");
      else if (response.status === 400) setFormMessage("Bitte prüfen Sie Ihre Angaben und die Zustimmung zur Datenverarbeitung.");
      else if (response.status === 429) setFormMessage("Zu viele Versuche. Bitte warten Sie einige Minuten und versuchen Sie es erneut.");
      else setFormMessage("Die Serviceanfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.");
      setFeedbackScrollRequest((current) => current + 1);
    } catch (error) {
      setTurnstileToken(""); setTurnstileResetSignal((current) => current + 1);
      const message = error instanceof Error && /^(Bitte|Mindestens)/.test(error.message) ? error.message : "Die Serviceanfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.";
      setFormMessage(message);
      setFeedbackScrollRequest((current) => current + 1);
    } finally { setSending(false); }
  };

  const errorList = useMemo(() => Object.entries(errors) as Array<[FormKey, string]>, [errors]);
  const onTurnstile = useCallback((token: string) => setTurnstileToken(token), []);

  return <Section tone="page"><Container><div className="request-page">
    <Breadcrumb items={[{ label: "Startseite", href: "/" }, { label: "Serviceanfrage" }]} />
    <h1>Serviceanfrage</h1><p className="lead">Fünf Schritte. Eingaben bleiben erhalten, bis Sie senden. Mit dem Senden entsteht kein Auftrag. Priorität, Termin und Konditionen bestätigt der Service Desk nach Prüfung.</p>
    <div className="urgent-strip"><Alert lead="Kritische Fälle.">Bei Produktionsstillstand oder Sicherheitsgefahr melden Sie den Fall zusätzlich telefonisch unter <a href="tel:+4962100000">+49 621 00000-0</a>.</Alert></div>
    <form className="multi-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
      <ol className="form-steps" aria-label="Formularschritte">{steps.map((label, index) => <li key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""}><button type="button" onClick={() => index + 1 < step && goTo(index + 1)} disabled={index + 1 > step}><span>{index + 1}</span>{label}</button></li>)}</ol>
      {(errorList.length > 0 || formMessage) && <div ref={feedbackRef}>{errorList.length > 0 && <div className="error-summary" role="alert"><h2>Bitte korrigieren Sie folgende Angaben:</h2><ul>{errorList.map(([key, message]) => <li key={key}><button type="button" onClick={() => document.getElementById(`f-${key}`)?.focus()}>{message}</button></li>)}</ul></div>}{formMessage && <Alert tone="danger">{formMessage}</Alert>}</div>}
      <div className="form-body">
        {step === 1 && <StepOne values={values} errors={errors} update={update} />}
        {step === 2 && <StepTwo values={values} errors={errors} update={update} />}
        {step === 3 && <StepThree values={values} errors={errors} update={update} />}
        {step === 4 && <StepFour values={values} errors={errors} update={update} files={files} setFiles={setFiles} addFiles={addFiles} inputRef={inputRef} />}
        {step === 5 && <StepFive values={values} errors={errors} update={update} files={files} edit={goTo} onTurnstile={onTurnstile} turnstileResetSignal={turnstileResetSignal} />}
        {step >= 3 && isCritical(values) && <Alert tone="danger" lead="Menschliche Prüfung erforderlich.">Dieser Fall wird als kritisch behandelt und muss durch einen Menschen geprüft werden. Bitte melden Sie ihn zusätzlich telefonisch unter +49 621 00000-0.</Alert>}
      </div>
      <div className="form-actions">{step > 1 && <button className="button button--secondary" type="button" onClick={() => goTo(step - 1)}><Icon name="arrow-left" size={18} />Zurück</button>}<div />{step < 5 ? <button className="button button--primary" type="button" onClick={(event) => { event.preventDefault(); next(); }}>Weiter<Icon name="arrow-right" size={18} /></button> : <button className="button button--primary" type="submit" disabled={sending} aria-busy={sending}>{sending ? "Wird gesendet …" : <>Anfrage senden<Icon name="arrow-right" size={18} /></>}</button>}</div>
    </form>
  </div></Container></Section>;
}

function stepForField(field: FormKey) { if (["company", "contactName", "email", "phone", "customerNumber"].includes(field)) return 1; if (["siteName", "street", "postalCode", "city", "equipmentType", "manufacturer", "model", "machineNumber"].includes(field)) return 2; if (["serviceType", "description", "urgency", "safetyHazard", "desiredDate", "desiredTime"].includes(field)) return 3; if (["slaNumber", "sla247"].includes(field)) return 4; return 5; }
type StepProps = { values: FormValues; errors: FormErrors; update: <K extends FormKey>(key: K, value: FormValues[K]) => void };
function Field({ name, label, value, error, update, type = "text", optional = false, placeholder, helper }: { name: FormKey; label: string; value: string; error?: string; update: StepProps["update"]; type?: string; optional?: boolean; placeholder?: string; helper?: string }) { return <label className="field" htmlFor={`f-${name}`}><span>{label}<small>{optional ? "Optional" : "Pflichtangabe"}</small></span><input id={`f-${name}`} type={type} value={value} onChange={(event) => update(name, event.target.value)} placeholder={placeholder} aria-invalid={!!error} aria-describedby={error ? `e-${name}` : undefined} />{helper && <em>{helper}</em>}{error && <strong id={`e-${name}`}>{error}</strong>}</label>; }
function TextAreaField({ values, errors, update }: StepProps) { return <label className="field" htmlFor="f-description"><span>Beschreibung der Aufgabe oder Störung<small>Pflichtangabe</small></span><textarea id="f-description" value={values.description} onChange={(event) => update("description", event.target.value)} aria-invalid={!!errors.description} /><em>Beschreiben Sie, was Sie beobachten, Geräusch, Leckage, Messwert oder Meldung.</em>{errors.description && <strong>{errors.description}</strong>}</label>; }
function RadioCards({ name, legend, options, value, error, update, optional = false }: { name: FormKey; legend: string; options: string[]; value: string; error?: string; update: StepProps["update"]; optional?: boolean }) { return <fieldset className="radio-field" id={`f-${name}`} tabIndex={-1}><legend>{legend}<small>{optional ? "Optional" : "Pflichtangabe"}</small></legend><div>{options.map((option) => <label key={option} className={value === option ? "selected" : ""}><input type="radio" name={name} value={option} checked={value === option} onChange={() => update(name, option)} /><span>{option}</span></label>)}</div>{error && <strong>{error}</strong>}</fieldset>; }
function StepOne({ values, errors, update }: StepProps) { return <div className="form-grid"><Field name="company" label="Unternehmen" value={values.company} error={errors.company} update={update} placeholder="z. B. Rhein-Neckar Logistik GmbH" /><Field name="contactName" label="Vor- und Nachname der Kontaktperson" value={values.contactName} error={errors.contactName} update={update} /><Field name="email" label="Geschäftliche E-Mail-Adresse" value={values.email} error={errors.email} update={update} type="email" placeholder="name@firma.de" /><Field name="phone" label="Telefonnummer" value={values.phone} error={errors.phone} update={update} type="tel" placeholder="+49 621 000000" /><Field name="customerNumber" label="Kundennummer" value={values.customerNumber} update={update} optional helper="Falls bekannt. Beschleunigt die Zuordnung." /></div>; }
function StepTwo({ values, errors, update }: StepProps) { return <div className="form-stack"><div className="form-grid"><Field name="siteName" label="Standortbezeichnung" value={values.siteName} update={update} optional placeholder="z. B. Werk Süd, Halle 3" /><Field name="street" label="Straße und Hausnummer" value={values.street} error={errors.street} update={update} /><Field name="postalCode" label="PLZ" value={values.postalCode} error={errors.postalCode} update={update} /><Field name="city" label="Ort" value={values.city} error={errors.city} update={update} /></div><RadioCards name="equipmentType" legend="Anlage oder Gerät" options={["Pumpe", "Kompressor", "Lüftungsanlage", "Sonstiges"]} value={values.equipmentType} error={errors.equipmentType} update={update} /><div className="form-grid"><Field name="manufacturer" label="Hersteller" value={values.manufacturer} update={update} optional /><Field name="model" label="Modell oder Typ" value={values.model} update={update} optional /><Field name="machineNumber" label="Maschinennummer" value={values.machineNumber} update={update} optional helper="Vom Typenschild, z. B. P-114-2019." /></div></div>; }
function StepThree({ values, errors, update }: StepProps) { return <div className="form-stack"><div className="form-grid"><label className="field" htmlFor="f-serviceType"><span>Art der Leistung<small>Pflichtangabe</small></span><select id="f-serviceType" value={values.serviceType} onChange={(event) => update("serviceType", event.target.value)} aria-invalid={!!errors.serviceType}><option value="">Bitte wählen</option>{["Inspektion", "Planmäßige Wartung", "Diagnose und Reparatur"].map((option) => <option key={option}>{option}</option>)}</select>{errors.serviceType && <strong>{errors.serviceType}</strong>}</label><Field name="desiredDate" label="Gewünschter Einsatztermin" value={values.desiredDate} error={errors.desiredDate} update={update} type="date" helper="Wunschtermin, keine Zusage." /><label className="field" htmlFor="f-desiredTime"><span>Gewünschte Uhrzeit<small>Optional</small></span><select id="f-desiredTime" value={values.desiredTime} onChange={(event) => update("desiredTime", event.target.value)}><option value="">Beliebig</option>{timeOptions.slice(1).map((option) => <option key={option}>{option}</option>)}</select><em>Ist die Zeit frei, merken wir sie sofort für Sie vor; sonst den nächsten freien Termin.</em></label></div><TextAreaField values={values} errors={errors} update={update} /><RadioCards name="urgency" legend="Dringlichkeit" options={["Planbar", "Zeitnah", "Erheblich", "Produktionsstillstand"]} value={values.urgency} error={errors.urgency} update={update} /><RadioCards name="safetyHazard" legend="Bekannte Sicherheitsgefahr" options={["Nein", "Ja", "Unklar"]} value={values.safetyHazard} error={errors.safetyHazard} update={update} /></div>; }
function StepFour({ values, update, files, setFiles, addFiles, inputRef }: StepProps & { files: FileItem[]; setFiles: React.Dispatch<React.SetStateAction<FileItem[]>>; addFiles: (files: FileList | null) => void; inputRef: React.RefObject<HTMLInputElement | null> }) { return <div className="form-stack"><div className="form-grid"><Field name="slaNumber" label="Kunden- oder SLA-Vertragsnummer" value={values.slaNumber} update={update} optional helper="Falls vorhanden. Vereinbarte Konditionen haben Vorrang." /></div><RadioCards name="sla247" legend="Besteht ein vereinbartes 24/7-Notfall-SLA?" options={["Nein", "Ja"]} value={values.sla247} update={update} optional /><div className="upload-zone"><input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple onChange={(event) => addFiles(event.target.files)} /><button type="button" onClick={() => inputRef.current?.click()} disabled={files.length >= 3}><Icon name="upload" size={22} />Dateien auswählen</button><p>PDF, JPG oder PNG · maximal 3 Dateien · je höchstens 5 MB</p>{files.length > 0 && <ul>{files.map((item) => <li key={item.id}><div><strong>{item.file.name}</strong><span>{(item.file.size / 1024 / 1024).toFixed(1)} MB · {item.status === "ready" ? "Bereit" : item.status === "uploading" ? `${Math.round(item.progress)} %` : item.status === "done" ? "Übertragen" : item.error}</span></div><button type="button" onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))} aria-label={`${item.file.name} entfernen`}><Icon name="x" size={18} /></button></li>)}</ul>}</div></div>; }
function StepFive({ values, errors, update, files, edit, onTurnstile, turnstileResetSignal }: StepProps & { files: FileItem[]; edit: (step: number) => void; onTurnstile: (token: string) => void; turnstileResetSignal: number }) { const groups = [{ name: "Kontakt", step: 1, rows: [["Unternehmen", values.company], ["Kontaktperson", values.contactName], ["E-Mail", values.email], ["Telefon", values.phone], ["Kundennummer", values.customerNumber]] }, { name: "Standort und Anlage", step: 2, rows: [["Standort", values.siteName], ["Adresse", [values.street, values.postalCode, values.city].filter(Boolean).join(", ")], ["Anlage", values.equipmentType], ["Hersteller / Modell", [values.manufacturer, values.model].filter(Boolean).join(" · ")], ["Maschinennummer", values.machineNumber]] }, { name: "Anfrage", step: 3, rows: [["Leistung", values.serviceType], ["Beschreibung", values.description], ["Dringlichkeit", values.urgency], ["Sicherheitsgefahr", values.safetyHazard], ["Wunschtermin", [values.desiredDate, values.desiredTime || "Uhrzeit beliebig"].filter(Boolean).join(", ")]] }, { name: "Vertrag und Anhänge", step: 4, rows: [["SLA-Nummer", values.slaNumber], ["24/7-Notfall-SLA", values.sla247], ["Dateien", String(files.length)]] }]; return <div className="form-stack"><div className="review-groups">{groups.map((group) => <Panel key={group.name}><div className="review-heading"><h3>{group.name}</h3><button type="button" onClick={() => edit(group.step)}>Ändern</button></div><dl>{group.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "–"}</dd></div>)}</dl></Panel>)}</div><label className="consent" htmlFor="f-privacyConsent"><input id="f-privacyConsent" type="checkbox" checked={values.privacyConsent} onChange={(event) => update("privacyConsent", event.target.checked)} /><span>Ich stimme der Verarbeitung der angegebenen personenbezogenen Daten zur Bearbeitung dieser Serviceanfrage zu und darf die übermittelten Dateien dafür verwenden.</span></label>{errors.privacyConsent && <strong className="field-error">{errors.privacyConsent}</strong>}<Turnstile onToken={onTurnstile} resetSignal={turnstileResetSignal} /><Alert>Priorität, Termin und kommerzielle Bedingungen werden erst nach Prüfung durch den Service Desk bestätigt. Mit dem Senden entsteht kein Auftrag.</Alert></div>; }
