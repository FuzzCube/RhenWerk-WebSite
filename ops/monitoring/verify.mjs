// Read-only verification on the VPS. No browser, passwords or SMTP settings in output.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = '/opt/monitoring';
const c = JSON.parse(fs.readFileSync(`${root}/access.json`));
const authResponse = await fetch('http://127.0.0.1:18090/api/collections/users/auth-with-password', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: c.beszelEmail, password: c.beszelPassword }),
  signal: AbortSignal.timeout(10000),
});
if (!authResponse.ok) throw new Error('Beszel login failed');
const auth = await authResponse.json();
const get = async (collection) => {
  const r = await fetch(`http://127.0.0.1:18090/api/collections/${collection}/records?perPage=1&sort=-created`, {
    headers: { Authorization: auth.token }, signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Beszel ${collection}: ${r.status}`);
  return r.json();
};
const systems = await get('systems');
const stats = await get('system_stats');
const containers = await get('container_stats');
console.log(JSON.stringify({ beszel: { status: systems.items[0]?.status, stats: stats.totalItems,
  containerSamples: containers.totalItems, latest: stats.items[0]?.created } }));
if (systems.items[0]?.status !== 'up' || !stats.totalItems || !containers.totalItems) process.exitCode = 1;
const code = `
  const fs = require('fs'); const {io} = require('socket.io-client');
  const c = JSON.parse(fs.readFileSync(0, 'utf8'));
  const s = io('http://127.0.0.1:13001', {reconnection:false});
  let monitors = {}; const beats = new Map();
  const finish = () => {
    console.log(JSON.stringify({kuma:{monitors:Object.keys(monitors).length,up:Object.values(monitors).filter(m => beats.get(m.id) === 1).length}}));
    s.close(); process.exit(Object.keys(monitors).length === 7 && Object.values(monitors).every(m => beats.get(m.id) === 1) ? 0 : 1);
  };
  const check = () => { if (Object.keys(monitors).length === 7 && beats.size >= 7) finish(); };
  const timer = setTimeout(finish, 65000);
  s.on('monitorList', list => {monitors=list;check();});
  s.on('heartbeatList', (id,list) => {if(list.length) beats.set(Number(id),list.at(-1).status);check();});
  s.on('heartbeat', beat => {beats.set(Number(beat.monitorID),beat.status);check();});
  s.on('connect', () => s.emit('login', {username:c.kumaUsername,password:c.kumaPassword,token:''}, r => {
    if(!r.ok){clearTimeout(timer);console.error('Kuma login failed');s.close();process.exit(1);}
  }));
`;
try {
  execFileSync('docker', ['compose', 'exec', '-T', 'kuma', 'node', '-e', code], {
    cwd: root, input: JSON.stringify(c), stdio: ['pipe', 'inherit', 'inherit'], timeout: 70000,
  });
} catch { process.exitCode = 1; }
