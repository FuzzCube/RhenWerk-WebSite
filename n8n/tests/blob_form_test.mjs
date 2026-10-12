import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { upload } from '@vercel/blob/client';

const base = new URL(process.env.APP_URL ?? 'http://127.0.0.1:3201');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Local test server required');
const results = new URL('./results/', import.meta.url);
const resultFile = new URL('blob-form-test.json', results);
const submissionId = 'fd430000-0000-4000-8000-000000000001';

if (process.argv[2] === 'upload') {
  const attachments = [];
  for (const [name, mime] of [['nameplate.pdf', 'application/pdf'], ['nameplate.png', 'image/png']]) {
    const data = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
    const blob = await upload(`service-requests/${submissionId}/${name}`, new File([data], name, { type: mime }), {
      access: 'private', contentType: mime, handleUploadUrl: new URL('/api/upload', base).href,
    });
    attachments.push({ file_name: name, pathname: blob.pathname, mime_type: blob.contentType, size_bytes: data.length, upload_status: 'uploaded' });
    console.log(JSON.stringify({ stage: 'upload', file: name, bytes: data.length, private: true }));
  }
  await mkdir(results, { recursive: true });
  await writeFile(resultFile, JSON.stringify({ submissionId, attachments }, null, 2) + '\n');
} else if (process.argv[2] === 'submit') {
  const saved = JSON.parse(await readFile(resultFile, 'utf8'));
  assert.equal(saved.submissionId, submissionId);
  const payload = {
    schema_version: '1.0', submission_id: submissionId, source: 'rheinwerk_website_service_request',
    locale: 'de-DE', submitted_at: new Date().toISOString(), privacy_consent: true,
    contact: { company_name: 'Portfolio Attachment Test', contact_name: 'Portfolio Tester', business_email: 'fuzz.cube.studio@gmail.com', phone: '+49 151 00000000' },
    site_and_equipment: { street_and_number: 'Teststrasse 1', postal_code: '10115', city: 'Berlin', equipment_type: 'compressor' },
    request: { service_type: 'repair', description: 'PORTFOLIO TEST: Der Kompressordruck fällt von 8 auf 4 bar. Fehlercode E42. Hersteller und Modell stehen auf den beigefügten fiktiven Dokumenten.', urgency: 'planned', known_safety_hazard: 'no', preferred_service_date: '2026-10-20', requires_human_review: false },
    contract_and_attachments: { emergency_sla_24_7: false, attachments: saved.attachments },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(new URL('/api/service-request', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(175000) });
    const body = await response.json();
    console.log(JSON.stringify({ stage: 'submission', attempt, http: response.status, response: body }));
    assert.equal(response.status, 201, 'Form submission must succeed');
    assert.equal(body.request_id, submissionId);
    assert.equal(body.status, 'created');
    if (attempt === 0) saved.response = body;
    else assert.equal(body.request_number, saved.response.request_number, 'Retry must return the same request');
  }
  saved.submittedAt = new Date().toISOString();
  await writeFile(resultFile, JSON.stringify(saved, null, 2) + '\n');
} else {
  throw new Error('Choose upload or submit');
}
