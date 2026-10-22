// Cloudflare Access in front of the Supabase API and n8n on the VPS (task-18-4, docs/betrieb.md 3.1): every request of
// the server carries the headers of the service token. Locally (variables not set) nothing is added. Never import
// into client components: the secret must not reach the browser bundle.
export function accessHeaders(): Record<string, string> {
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  return id && secret ? { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } : {};
}
