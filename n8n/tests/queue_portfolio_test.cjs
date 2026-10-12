// User explicitly approved this recipient for the integration test.
// Release this one synthetic request using the existing demo dispatcher's real login.
async function main() {
  const { execFileSync } = await import('node:child_process');
  const requestId = 'fd420000-0000-4000-8000-000000000002';
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '54321') throw new Error('Local Supabase required');
  const sql = `select json_build_object('version',r.version,'company',r.company_name,'recipient',r.business_email,'dispatcher_email',u.email,'message_id',m.id,'message_status',m.status) from public.requests r join auth.users u on u.id=r.dispatcher_id join public.messages m on m.request_id=r.id and m.kind='clarification' where r.id='${requestId}' and m.direction='outgoing';`;
  const data = execFileSync('docker', ['exec', 'supabase_db_A.Sadkovojs_Project', 'psql', '-U', 'postgres', '-qAt', '-c', sql], { encoding: 'utf8' }).trim();
  const item = JSON.parse(data);
  if (item.company !== 'Portfolio Integration Test' || item.recipient !== 'fuzz.cube.studio@gmail.com' || item.message_status !== 'draft') throw new Error('Expected synthetic draft not found');
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!key || !password) throw new Error('Demo login configuration missing');
  const auth = await fetch(`${url.origin}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: item.dispatcher_email, password }) });
  if (!auth.ok) throw new Error(`Demo login failed (${auth.status}); details suppressed`);
  const session = await auth.json();
  const response = await fetch(`${url.origin}/rest/v1/rpc/queue_message`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message_id: item.message_id, expected_version: item.version }) });
  if (!response.ok) throw new Error(`Queue release failed (${response.status}): ${await response.text()}`);
  const queued = await response.json();
  console.log(JSON.stringify({ message_id: queued.id, status: queued.status, recipient: queued.to_address, request_id: queued.request_id }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
