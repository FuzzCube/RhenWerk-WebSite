import { issueSignedToken, presignUrl } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requiresHumanReview, validatePayload, type Attachment, type InvalidField, type ServiceRequestPayload } from "@/lib/form-contract";
import { accessHeaders } from "@/lib/supabase/access";

const windows = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(ip: string) {
  const now = Date.now();
  const current = windows.get(ip);
  if (!current || current.resetAt <= now) {
    windows.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT;
}

async function verifyTurnstile(token: string | undefined, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, cache: "no-store" });
  if (!response.ok) return false;
  const result = await response.json() as { success?: boolean };
  return result.success === true;
}

async function addSignedUrls(attachments: Attachment[]) {
  return Promise.all(attachments.map(async (attachment) => {
    const validUntil = Date.now() + 60 * 60 * 1000;
    const token = await issueSignedToken({ pathname: attachment.pathname, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(token, { access: "private", operation: "get", pathname: attachment.pathname, validUntil });
    return { ...attachment, url: presignedUrl, download_url: presignedUrl };
  }));
}

function validateAttachments(payload: ServiceRequestPayload): InvalidField[] {
  const attachments = payload.contract_and_attachments?.attachments;
  if (!Array.isArray(attachments) || attachments.length > 3) return ["contract_and_attachments.attachments"];
  const prefix = `service-requests/${payload.submission_id}/`;
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
  const invalid = attachments.some((item) =>
    !item || !item.pathname?.startsWith(prefix) || !item.file_name || !allowed.has(item.mime_type) || item.size_bytes <= 0 || item.size_bytes > 5 * 1024 * 1024 || item.upload_status !== "uploaded"
  );
  return invalid ? ["contract_and_attachments.attachments"] : [];
}

function validateEnvelope(payload: ServiceRequestPayload): InvalidField[] {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuid.test(payload.submission_id ?? "") ? [] : ["submission_id"];
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (isRateLimited(ip)) return NextResponse.json({ status: "rate_limited", message: "Too many requests. Please try again later." }, { status: 429 });

  let payload: ServiceRequestPayload;
  try {
    payload = await request.json() as ServiceRequestPayload;
  } catch {
    return NextResponse.json({ status: "invalid", message: "Required fields are missing or privacy consent was not given.", invalid_fields: validatePayload(null) }, { status: 400 });
  }

  const invalidFields: InvalidField[] = [...validatePayload(payload), ...validateEnvelope(payload), ...validateAttachments(payload)];
  if (invalidFields.length) {
    return NextResponse.json({ status: "invalid", message: "Required fields are missing or privacy consent was not given.", invalid_fields: invalidFields }, { status: 400 });
  }
  if (!await verifyTurnstile(payload.turnstile_token, ip)) {
    return NextResponse.json({ status: "turnstile_failed", message: "Die Sicherheitsprüfung ist abgelaufen oder fehlgeschlagen." }, { status: 400 });
  }
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
  const webhookUrl = n8nWebhookUrl || process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) return NextResponse.json({ status: "not_configured", message: "The service request webhook is not configured." }, { status: 503 });

  let attachments: Attachment[];
  try {
    attachments = await addSignedUrls(payload.contract_and_attachments.attachments);
  } catch {
    return NextResponse.json({ status: "upload_unavailable", message: "Uploaded files could not be prepared for processing." }, { status: 503 });
  }
  const { turnstile_token: _turnstileToken, ...forwardPayload } = payload;
  void _turnstileToken;
  const humanReview = requiresHumanReview(payload);
  const integrationPayload = {
    ...forwardPayload,
    request: { ...payload.request, requires_human_review: humanReview },
    contract_and_attachments: { ...payload.contract_and_attachments, attachments },
  };
  try {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (n8nWebhookUrl) Object.assign(headers, accessHeaders());
    else if (process.env.MAKE_API_KEY) headers["x-make-apikey"] = process.env.MAKE_API_KEY;
    const integrationResponse = await fetch(webhookUrl, { method: "POST", headers, body: JSON.stringify(integrationPayload), cache: "no-store", signal: AbortSignal.timeout(175_000) });
    const responseText = await integrationResponse.text();
    let responseBody: unknown;
    try { responseBody = responseText ? JSON.parse(responseText) : {}; } catch { responseBody = { status: "upstream_error", message: responseText || "Unexpected response from the service request workflow." }; }
    if (integrationResponse.status >= 500) {
      return NextResponse.json({ status: "upstream_error", message: "Die Serviceanfrage konnte im Verarbeitungssystem nicht abgeschlossen werden." }, { status: 502 });
    }
    if (integrationResponse.status === 201 && responseBody && typeof responseBody === "object") {
      responseBody = { ...responseBody, human_review: humanReview || (responseBody as { human_review?: boolean }).human_review === true };
    }
    return NextResponse.json(responseBody, { status: integrationResponse.status });
  } catch {
    return NextResponse.json({ status: "upstream_error", message: "Die Serviceanfrage konnte nicht gesendet werden." }, { status: 502 });
  }
}
