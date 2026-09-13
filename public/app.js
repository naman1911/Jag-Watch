// Jag Watch — front end controller.

import { Chart, courseText } from './chart.js';
import {
  latLonText, hhmm, fullTime, age, knots, degrees, metres,
  compassPoint, distanceRun,
} from './format.js';

const el = id => document.getElementById(id);
const vessels = new Map();
let selected = null;
let firstPaint = true;

const chart = new Chart(el('chart'), { onSelect: select });

// --- socket ---------------------------------------------------------------

let socket;
let backoff = 1000;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${proto}//${location.host}/stream`);

  socket.addEventListener('open', () => { backoff = 1000; });

  socket.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') {
      for (const v of msg.vessels) store(v);
      el('log').replaceChildren();
      for (const e of msg.log) appendLog(e, false);
      paintLedger();
      setStatus(msg.status);
      if (firstPaint && msg.vessels.length) {
        chart.fit();
        firstPaint = false;
      }
    }
    if (msg.type === 'vessel') { store(msg.vessel); paintLedger(); }
    if (msg.type === 'log') appendLog(msg.entry, true);
    if (msg.type === 'status') setStatus(msg.status);
  });

  socket.addEventListener('close', () => {
    setLamp('down', 'Link down', 'reconnecting');
    setTimeout(connect, backoff);
    backoff = Math.min(20000, backoff * 1.8);
  });
}

connect();

// --- state ----------------------------------------------------------------

function store(v) {
  vessels.set(v.mmsi, v);
  chart.upsert(v);
  if (selected === v.mmsi) paintSheet(v);
}

function select(mmsi) {
  selected = mmsi;
  chart.select(mmsi);
  chart.panTo(mmsi);
  const v = vessels.get(mmsi);
  if (v) paintSheet(v);
  paintLedger();
  if (window.matchMedia('(max-width: 860px)').matches) setView('chart');
}

// --- register -------------------------------------------------------------

function paintLedger() {
  const list = [...vessels.values()].sort(byActivity);
  el('fleet-count').textContent = `${list.length} hull${list.length === 1 ? '' : 's'}`;
  el('ledger-empty').hidden = list.length > 0;

  el('ledger').replaceChildren(...list.map((v) => {
    const li = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `ledger-row${v.stale ? ' is-stale' : ''}`;
    row.setAttribute('aria-current', String(selected === v.mmsi));
    row.addEventListener('click', () => select(v.mmsi));

    const ship = document.createElement('span');
    ship.className = 'ship';
    ship.textContent = `${v.flagEmoji ?? ''} ${title(v.name)}`.trim();

    const speed = document.createElement('span');
    speed.className = 'speed';
    speed.textContent = Number.isFinite(v.sog) ? v.sog.toFixed(1) : '—';

    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = `${courseText(v)} \u00b7 ${age(v.positionAt)}`;

    row.append(ship, speed, where);
    li.append(row);
    return li;
  }));
}

function byActivity(a, b) {
  if (a.stale !== b.stale) return a.stale ? 1 : -1;
  return (Date.parse(b.positionAt ?? 0) || 0) - (Date.parse(a.positionAt ?? 0) || 0);
}

// --- deck log -------------------------------------------------------------

function appendLog(entry, live) {
  const li = document.createElement('li');
  li.className = 'log-row';
  li.dataset.kind = entry.kind;

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = hhmm(entry.at);

  const text = document.createElement('span');
  const ship = document.createElement('span');
  ship.className = 'ship';
  ship.textContent = title(entry.ship);
  ship.addEventListener('click', () => select(entry.mmsi));
  text.append(ship, document.createTextNode(` ${entry.text}.`));

  li.append(time, text);
  el('log').prepend(li);
  while (el('log').childElementCount > 200) el('log').lastElementChild.remove();
  if (live) paintLedger();
}

// --- particulars ----------------------------------------------------------

function paintSheet(v) {
  const sheet = el('sheet');
  const body = el('sheet-body');
  sheet.hidden = false;

  const run = distanceRun(v.track ?? []);
  const cog = compassPoint(v.cog);
  const laden = v.draught && v.maxDraught
    ? (v.draught > v.maxDraught * 0.82 ? 'loaded' : 'light or part-laden')
    : null;

  body.replaceChildren();
  body.insertAdjacentHTML('beforeend', `
    <h3>${esc(title(v.name))}</h3>
    <p class="flagline">${v.flagEmoji ?? ''} ${esc(v.flag)} flag \u00b7 ${esc(v.type ?? 'type not reported')}</p>

    <div class="fixline">
      ${esc(latLonText(v.lat, v.lon))}
      <small>last reported ${esc(fullTime(v.positionAt))} \u00b7 ${esc(age(v.positionAt))}</small>
    </div>

    <dl class="particulars">
      <dt>Speed</dt><dd>${knots(v.sog)}</dd>
      <dt>Course</dt><dd>${degrees(v.cog)}${cog ? ` (${cog})` : ''}</dd>
      <dt>Heading</dt><dd>${degrees(v.heading)}</dd>
      <dt>Rate of turn</dt><dd>${esc(v.rotLabel ?? 'Not available')}</dd>
      <dt>Status</dt><dd>${esc(v.navStatus ?? 'Not reported')}</dd>
    </dl>

    <h4>Voyage</h4>
    <dl class="particulars">
      <dt>Bound for</dt><dd>${esc(v.destination ?? 'Not reported')}</dd>
      <dt>ETA</dt><dd>${esc(v.eta ? fullTime(v.eta) : 'Not reported')}</dd>
      <dt>Draught</dt><dd>${metres(v.draught)}${laden ? ` \u00b7 ${laden}` : ''}</dd>
      <dt>Run on record</dt><dd>${run > 0.5 ? `${run.toFixed(0)} nm over ${v.track.length} fixes` : 'Not enough fixes'}</dd>
    </dl>

    <h4>Particulars</h4>
    <dl class="particulars">
      <dt>MMSI</dt><dd>${esc(v.mmsi)}</dd>
      <dt>IMO</dt><dd>${esc(v.imo ?? 'Not reported')}</dd>
      <dt>Call sign</dt><dd>${esc(v.callSign ?? 'Not reported')}</dd>
      <dt>Length overall</dt><dd>${metres(v.dim?.loa, 0)}</dd>
      <dt>Beam</dt><dd>${metres(v.dim?.beam, 0)}</dd>
      <dt>Position fix</dt><dd>${esc(v.fixType ?? 'Not reported')}</dd>
      <dt>Accuracy</dt><dd>${v.positionAccuracy === null ? '—' : (v.positionAccuracy ? 'High (&lt;10 m)' : 'Low (&gt;10 m)')}</dd>
      <dt>First logged</dt><dd>${esc(fullTime(v.firstSeen))}</dd>
    </dl>

    <p class="dr-note">
      Between reports she is advanced along her course at her last speed and drawn hollow.
      That is an estimate, not a fix — the solid symbol only appears when she speaks again.
    </p>
  `);
}

el('sheet-close').addEventListener('click', () => {
  el('sheet').hidden = true;
  selected = null;
  chart.select(null);
  paintLedger();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('sheet').hidden) el('sheet-close').click();
});

// --- link state -----------------------------------------------------------

function setStatus(s) {
  if (!s) return;
  el('sim-banner').hidden = !s.simulated;

  if (s.simulated) {
    setLamp('warn', 'Simulator', 'invented positions');
    return;
  }
  const detail = [
    s.registered ? `${s.registered} in register` : null,
    s.phase === 'lock' ? 'following by MMSI' : 'reading wide water',
  ].filter(Boolean).join(' \u00b7 ');

  if (s.state === 'subscribed' || s.state === 'open') setLamp('live', 'Receiving', detail);
  else if (s.state === 'reconnecting' || s.state === 'connecting') setLamp('warn', 'Reopening the link', detail);
  else if (s.state === 'error') setLamp('down', 'Link fault', s.detail ?? '');
  else setLamp('down', 'Link closed', detail);
}

function setLamp(state, text, detail) {
  el('lamp').dataset.state = state;
  el('link-state').textContent = text;
  el('link-detail').textContent = detail ? `\u00b7 ${detail}` : '';
}

// --- chrome ---------------------------------------------------------------

el('fit').addEventListener('click', () => chart.fit());

for (const btn of document.querySelectorAll('.tabs button')) {
  btn.addEventListener('click', () => setView(btn.dataset.view));
}

function setView(view) {
  document.body.dataset.view = view;
  for (const btn of document.querySelectorAll('.tabs button')) {
    btn.classList.toggle('on', btn.dataset.view === view);
  }
  if (view === 'chart') requestAnimationFrame(() => chart.invalidate());
}

setInterval(paintLedger, 30000);

// --- text -----------------------------------------------------------------

function title(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\b[a-z]/g, c => c.toUpperCase());
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
