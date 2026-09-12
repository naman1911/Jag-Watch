// Jag Watch — server.
//
// Holds the single upstream AIS Stream connection (the key never leaves this
// process), keeps the fleet register, and fans out only fleet traffic to
// browsers over a local WebSocket.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { Fleet } from './fleet.js';
import { AisStreamLink } from './aisstream.js';
import { startSimulator } from './simulate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');

const PORT = Number(process.env.PORT ?? 8080);
const API_KEY = process.env.AISSTREAM_API_KEY ?? '';
const SIMULATE = process.env.SIMULATE === '1' || !API_KEY;
const PATTERN = new RegExp(process.env.FLEET_NAME_PATTERN ?? '^JAG\\b');
const STORE = process.env.FLEET_STORE ?? path.join(ROOT, 'data', 'fleet.json');

// Where to look first. These boxes cover the Arabian Sea, the Gulf, the Red
// Sea, the Bay of Bengal and the Malacca approaches — the water a Jag hull is
// most likely to be found in. Once a hull is in the register it is followed
// worldwide by MMSI, so this only has to be good enough to meet her once.
const TRAWL_BOXES = JSON.parse(process.env.TRAWL_BOXES ?? JSON.stringify([
  [[32.0, 32.0], [0.0, 78.0]],     // Red Sea, Gulf of Aden, Arabian Sea, Gulf
  [[25.0, 78.0], [-12.0, 122.0]],  // Bay of Bengal, Malacca, South China Sea
]));

const fleet = new Fleet({ pattern: PATTERN, storePath: STORE });
const clients = new Set();
let linkStatus = { state: SIMULATE ? 'simulated' : 'starting' };
let stopSimulator = null;
let link = null;

// --- upstream -------------------------------------------------------------

function handleEnvelope(envelope) {
  fleet.ingest(envelope);
}

if (SIMULATE) {
  if (!API_KEY) {
    console.log('[jag] no AISSTREAM_API_KEY found — running the simulator.');
    console.log('[jag] positions shown are invented. Set a key in .env for live AIS.');
  }
  stopSimulator = startSimulator(handleEnvelope);
} else {
  link = new AisStreamLink({ apiKey: API_KEY, trawlBoxes: TRAWL_BOXES });
  link.on('ais', handleEnvelope);
  link.on('status', (s) => {
    linkStatus = { ...s, at: new Date().toISOString() };
    console.log('[ais]', JSON.stringify(s));
    broadcast({ type: 'status', status: publicStatus() });
  });
  link.start();

  // Hand the register to the link as it grows, and lock on once we have hulls.
  const known = new Set(fleet.knownMMSIs());
  link.setFleet([...known]);
  fleet.on('registered', (v) => {
    known.add(v.mmsi);
    link.setFleet([...known]);
  });

  // Trawl wide for a while to meet the fleet, then narrow to MMSI filters.
  const trawlFor = Number(process.env.TRAWL_MINUTES ?? 20) * 60000;
  setTimeout(() => {
    if (link.lock()) console.log(`[jag] locked on to ${known.size} hull(s) — worldwide from here.`);
    else console.log('[jag] no hulls found yet — still trawling.');
  }, known.size ? 5000 : trawlFor);
}

// --- fan-out --------------------------------------------------------------

fleet.on('vessel', (v) => broadcast({ type: 'vessel', vessel: v }));
fleet.on('log', (e) => broadcast({ type: 'log', entry: e }));
setInterval(() => fleet.save(), 30000).unref();

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function publicStatus() {
  return {
    ...linkStatus,
    simulated: SIMULATE,
    pattern: PATTERN.source,
    registered: fleet.vessels.size,
    messages: link?.stats.messages ?? null,
    phase: link?.phase ?? 'simulated',
  };
}

// --- http + ws ------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/fleet') {
    res.writeHead(200, { 'content-type': MIME['.json'] });
    res.end(JSON.stringify({ ...fleet.snapshotAll(), status: publicStatus() }));
    return;
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': MIME['.json'] });
    res.end(JSON.stringify({ ok: true, ...publicStatus() }));
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': MIME['.html'] });
      res.end('<h1>404</h1><p>Nothing charted here.</p>');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/stream' });

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'snapshot', ...fleet.snapshotAll(), status: publicStatus() }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'trawl' && link) {
      link.trawl();
      ws.send(JSON.stringify({ type: 'notice', text: 'Watching wide water again.' }));
    }
    if (msg.type === 'lock' && link) {
      const ok = link.lock();
      ws.send(JSON.stringify({
        type: 'notice',
        text: ok ? 'Locked on to the register.' : 'No hulls in the register yet.',
      }));
    }
  });

  ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`[jag] chart table at http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[jag] securing for sea — saving register.');
    fleet.save();
    link?.stop();
    stopSimulator?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
