// Local health summary. Only fixed container names are inspected; no database credentials or SQL.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
const projects = {
  rheinwerk: ['rheinwerk-n8n', 'rheinwerk-cloudflared', ...['db', 'auth', 'rest', 'kong', 'storage'].map(s => `supabase_${s}_rheinwerk`)],
  houseitems: ['db', 'rest', 'gateway', 'n8n', 'cloudflared'].map(s => `houseitems-${s}`),
  'personal-copilot': ['db', 'rest', 'gateway'].map(s => `personal-copilot-${s}`),
};
createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const names = projects[req.url?.slice(1)];
  if (req.method !== 'GET' || !Array.isArray(names)) { res.writeHead(404).end('{}'); return; }
  execFile('/usr/bin/docker', ['inspect', ...names], { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, output) => {
    if (error) { res.writeHead(503).end('{"status":"unavailable"}'); return; }
    try {
      const states = JSON.parse(output).map(c => ({ name: c.Name.slice(1), running: c.State.Running,
        health: c.State.Health?.Status ?? 'no-healthcheck' }));
      const ok = states.length === names.length && states.every(s => s.running && ['healthy', 'no-healthcheck'].includes(s.health));
      res.writeHead(ok ? 200 : 503).end(JSON.stringify({ status: ok ? 'ok' : 'unavailable', containers: states }));
    } catch { res.writeHead(503).end('{"status":"unavailable"}'); }
  });
}).listen(18091, '127.0.0.1');
