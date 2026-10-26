// Run on the VPS: node --env-file=/opt/rheinwerk/ops.env bootstrap.mjs
// Credentials stay in /opt/monitoring/access.json (0600); never printed.
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

process.umask(0o077);
const root = '/opt/monitoring';
const file = `${root}/access.json`;
const secret = () => randomBytes(30).toString('base64url');
const credentials = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {
  beszelEmail: process.env.ALERT_EMAILS.split(',')[0].trim(), beszelPassword: secret(),
  kumaUsername: 'admin', kumaPassword: secret(),
};
const save = () => fs.writeFileSync(file, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
save();
const api = async (route, method = 'GET', body, token) => {
  const response = await fetch(`http://127.0.0.1:18090${route}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status} ${JSON.stringify(result.data ?? {})}`);
  return result;
};
if ((await api('/api/beszel/first-run')).firstRun) {
  await api('/api/beszel/create-user', 'POST', { email: credentials.beszelEmail, password: credentials.beszelPassword });
}
const auth = await api('/api/collections/users/auth-with-password', 'POST', {
  identity: credentials.beszelEmail, password: credentials.beszelPassword,
});
const token = auth.token;
const info = await api('/api/beszel/info', 'GET', undefined, token);
let systems = await api('/api/collections/systems/records', 'GET', undefined, token);
let system = systems.items.find(s => s.name === 'OVHcloud VPS · alle Projekte');
if (!system) system = await api('/api/collections/systems/records', 'POST', {
  name: 'OVHcloud VPS · alle Projekte', host: '/beszel_socket/beszel.sock', port: '45876', users: [auth.record.id],
}, token);
let fingerprints = await api('/api/collections/fingerprints/records', 'GET', undefined, token);
let fingerprint = fingerprints.items.find(s => s.system === system.id);
if (!fingerprint) fingerprint = await api('/api/collections/fingerprints/records', 'POST', { system: system.id, token: secret() }, token);
let env = parseEnv(fs.readFileSync(`${root}/.env`, 'utf8'));
env.BESZEL_KEY = info.key.trim(); env.BESZEL_TOKEN = fingerprint.token;
// Homepage reads the Beszel superuser via HOMEPAGE_VAR_* (task-28-1); compose requires them for every command.
env.HOMEPAGE_VAR_BESZEL_EMAIL = credentials.beszelEmail; env.HOMEPAGE_VAR_BESZEL_PASSWORD = credentials.beszelPassword;
fs.writeFileSync(`${root}/.env`, Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n', { mode: 0o600 });
const superuser = await api('/api/collections/_superusers/auth-with-password', 'POST', {
  identity: credentials.beszelEmail, password: credentials.beszelPassword,
});
await api('/api/settings', 'PATCH', {
  meta: { appName: 'VPS Monitoring', appURL: 'https://monitor.rheinwerk-service.online', senderName: 'VPS Monitoring', senderAddress: process.env.SMTP_USER },
  smtp: { enabled: true, host: 'smtp.gmail.com', port: 465, username: process.env.SMTP_USER,
    password: process.env.SMTP_APP_PASSWORD.replace(/\s+/g, ''), tls: true, authMethod: 'PLAIN' },
}, superuser.token);
const settings = await api('/api/collections/user_settings/records', 'GET', undefined, token);
const userSettings = settings.items.find(s => s.user === auth.record.id);
if (userSettings) await api(`/api/collections/user_settings/records/${userSettings.id}`, 'PATCH', {
  settings: { ...userSettings.settings, emails: process.env.ALERT_EMAILS.split(',').map(s => s.trim()) },
}, token);
for (const [name, value, min] of [['CPU', 90, 5], ['Memory', 90, 5], ['Disk', 85, 5], ['Status', 0, 2]]) {
  await api('/api/beszel/user-alerts', 'POST', { name, value, min, systems: [system.id], overwrite: true }, token);
}
console.log('Beszel: Benutzer, System, SMTP und Schwellen eingerichtet.');
if (!credentials.beszelMailTested) {
  await api('/api/settings/test/email', 'POST', { email: credentials.beszelEmail, template: 'verification' }, superuser.token);
  credentials.beszelMailTested = true; save(); console.log('Beszel: Test-E-Mail versendet.');
}

if (!credentials.kumaConfigured) {
  const projects = ['rheinwerk', 'houseitems', 'personal-copilot'].map(name => ({
    name, url: `http://127.0.0.1:18091/${name}`,
  }));
  const input = { ...credentials, projects, smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_APP_PASSWORD.replace(/\s+/g, ''), email: process.env.ALERT_EMAILS };
  const code = `
    const fs = require('fs'); const { io } = require('socket.io-client');
    const c = JSON.parse(fs.readFileSync(0, 'utf8'));
    const s = io('http://127.0.0.1:13001', { reconnection: false });
    let monitors = {}; let notifications = [];
    s.on('monitorList', list => { monitors = list; });
    s.on('notificationList', list => { notifications = list; });
    const timeout = setTimeout(() => { console.error('Kuma bootstrap timeout'); process.exit(1); }, 90000);
    const call = (name, ...args) => new Promise((resolve, reject) => s.timeout(30000).emit(name, ...args, (error, result) => {
      if (error || result?.ok === false) reject(new Error(name + ': ' + (error?.message ?? result.msg))); else resolve(result);
    }));
    s.once('connect', async () => { try {
      if (await call('needSetup')) await call('setup', c.kumaUsername, c.kumaPassword);
      await call('login', { username: c.kumaUsername, password: c.kumaPassword, token: '' });
      const notification = { name: 'VPS Admin E-Mail', type: 'smtp', isDefault: true,
        smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true, smtpIgnoreTLSError: false,
        smtpUsername: c.smtpUser, smtpPassword: c.smtpPass, smtpFrom: c.smtpUser, smtpTo: c.email };
      const existingNotification = Object.values(notifications).find(n => n.name === notification.name);
      const n = existingNotification ?? await call('addNotification', notification, null);
      if (!existingNotification) await call('testNotification', notification);
      const checks = [
        { name: 'RheinWerk Website + Datenbank', url: 'https://rheinwerk-service.online/api/health' },
        ...c.projects.map(p => ({ name: p.name + ' · Container + Datenbankbereitschaft', url: p.url })),
        { name: 'RheinWerk n8n', url: 'http://127.0.0.1:5678/healthz/readiness' },
        { name: 'HouseItems n8n', url: 'http://127.0.0.1:5679/healthz/readiness' },
        { name: 'Beszel Hub', url: 'http://127.0.0.1:18090/api/health' },
      ];
      for (const m of checks) {
        const old = Object.values(monitors).find(old => old.name === m.name || (m.url.includes(':18091/') && old.name === m.name.split(' · ')[0] + ' · API + Datenbank'));
        await call(old ? 'editMonitor' : 'add', { ...(old ?? {}), ...m, headers: '', type: 'http', active: true, method: 'GET',
        conditions: [], kafkaProducerBrokers: [], kafkaProducerSaslOptions: {}, rabbitmqNodes: [],
        interval: 60, retryInterval: 30, maxretries: 2, timeout: 15, resendInterval: 0,
        maxredirects: 5, accepted_statuscodes: ['200-299'], ignoreTls: false, upsideDown: false,
        notificationIDList: { [n.id]: true } });
      }
      console.log('Kuma: 7 Prüfungen und SMTP eingerichtet; neue SMTP-Konfiguration mit Test-E-Mail geprüft.');
      clearTimeout(timeout); s.close(); process.exit(0);
    } catch (error) { console.error(error.message); s.close(); process.exit(1); } });
  `;
  execFileSync('docker', ['compose', 'exec', '-T', 'kuma', 'node', '-e', code], {
    cwd: root, input: JSON.stringify(input), stdio: ['pipe', 'inherit', 'inherit'], timeout: 95000,
  });
  credentials.kumaConfigured = true; save();
}

// Status page "vps" for the Homepage widget (task-28-1); public only on 127.0.0.1, outside behind Cloudflare Access.
if (!credentials.kumaStatusPage) {
  const code = `
    const fs = require('fs'); const { io } = require('socket.io-client');
    const c = JSON.parse(fs.readFileSync(0, 'utf8'));
    const s = io('http://127.0.0.1:13001', { reconnection: false });
    let monitors = {};
    s.on('monitorList', list => { monitors = list; });
    const timeout = setTimeout(() => { console.error('Kuma status page timeout'); process.exit(1); }, 60000);
    const call = (name, ...args) => new Promise((resolve, reject) => s.timeout(30000).emit(name, ...args, (error, result) => {
      if (error || result?.ok === false) reject(new Error(name + ': ' + (error?.message ?? result.msg))); else resolve(result);
    }));
    s.once('connect', async () => { try {
      await call('login', { username: c.kumaUsername, password: c.kumaPassword, token: '' });
      await new Promise(resolve => setTimeout(resolve, 2000));
      try { await call('getStatusPage', 'vps'); } catch { await call('addStatusPage', 'VPS', 'vps'); }
      const monitorList = Object.values(monitors).map(m => ({ id: m.id }));
      await call('saveStatusPage', 'vps', { slug: 'vps', title: 'VPS', description: '', autoRefreshInterval: 60,
        theme: 'auto', showTags: false, footerText: '', customCSS: '', showPoweredBy: false, rssTitle: '',
        showOnlyLastHeartbeat: false, showCertificateExpiry: false, analyticsId: null, analyticsScriptUrl: null,
        analyticsType: null, domainNameList: [] }, '/icon.svg', [{ name: 'Alle Prüfungen', monitorList }]);
      console.log('Kuma: Statusseite vps mit ' + monitorList.length + ' Prüfungen eingerichtet.');
      clearTimeout(timeout); s.close(); process.exit(0);
    } catch (error) { console.error(error.message); s.close(); process.exit(1); } });
  `;
  execFileSync('docker', ['compose', 'exec', '-T', 'kuma', 'node', '-e', code], {
    cwd: root, input: JSON.stringify(credentials), stdio: ['pipe', 'inherit', 'inherit'], timeout: 65000,
  });
  credentials.kumaStatusPage = true; save();
}
console.log('Zugangsdaten nur in /opt/monitoring/access.json (0600).');
