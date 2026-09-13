s// The fleet register.
//
// AIS Stream can filter by MMSI but not by name, so the register is built the
// way a ship's agent would build one: watch the traffic, write down every hull
// whose name matches, and from then on hail only those.

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { flagFromMMSI, flagEmoji } from './mid.js';
import {
  NAV_STATUS, NAV_SHORT, shipType, FIX_TYPE, dimensions,
  etaToISO, cleanText, rateOfTurnLabel, compassPoint,
} from './aiscodes.js';

const TRACK_LIMIT = 500;      // fixes kept per vessel
const LOG_LIMIT = 400;        // entries kept in the log
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export class Fleet extends EventEmitter {
  constructor({ pattern, storePath }) {
    super();
    this.pattern = pattern;
    this.storePath = storePath;
    this.vessels = new Map();   // mmsi -> vessel record
    this.log = [];
    this.load();
  }

  // --- persistence -------------------------------------------------------

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      for (const v of raw.vessels ?? []) {
        v.track = (v.track ?? []).slice(-TRACK_LIMIT);
        this.vessels.set(String(v.mmsi), v);
      }
      this.log = (raw.log ?? []).slice(-LOG_LIMIT);
      console.log(`[fleet] register loaded: ${this.vessels.size} vessel(s)`);
    } catch {
      console.log('[fleet] no register on disk yet — starting a fresh one');
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({
        savedAt: new Date().toISOString(),
        vessels: [...this.vessels.values()],
        log: this.log.slice(-LOG_LIMIT),
      }, null, 1));
    } catch (err) {
      console.warn('[fleet] could not write register:', err.message);
    }
  }

  knownMMSIs() {
    return [...this.vessels.keys()];
  }

  // --- ingest ------------------------------------------------------------

  matchesName(name) {
    return typeof name === 'string' && this.pattern.test(name.trim().toUpperCase());
  }

  /**
   * Feed one decoded AIS Stream envelope in. Returns the vessel record if the
   * message belonged to a fleet ship, otherwise null.
   */
  ingest(envelope) {
    const meta = envelope?.MetaData ?? {};
    const type = envelope?.MessageType;
    const body = envelope?.Message?.[type] ?? {};

    const mmsi = String(meta.MMSI ?? body.UserID ?? '').trim();
    if (!/^\d{9}$/.test(mmsi)) return null;

    const reported = cleanText(meta.ShipName ?? body.Name);
    const known = this.vessels.get(mmsi);
    if (!known && !this.matchesName(reported)) return null;

    const v = known ?? this.register(mmsi, reported);
    const before = snapshot(v);

    if (reported) v.name = reported;
    v.lastMessageType = type;

    const utc = meta.time_utc ?? meta.TimeUtc ?? null;
    const at = parseUTC(utc) ?? new Date().toISOString();

    if (type === 'ShipStaticData') this.applyStatic(v, body);
    if (isPositionMessage(type)) this.applyPosition(v, body, meta, at);

    v.updatedAt = at;
    this.diff(v, before);
    this.emit('vessel', v);
    return v;
  }

  register(mmsi, name) {
    const flag = flagFromMMSI(mmsi);
    const v = {
      mmsi,
      name: name ?? `MMSI ${mmsi}`,
      flag: flag.country,
      flagCode: flag.code,
      flagEmoji: flagEmoji(flag.code),
      imo: null,
      callSign: null,
      type: null,
      typeFamily: 'unknown',
      typeCode: null,
      dim: null,
      draught: null,
      maxDraught: null,
      destination: null,
      eta: null,
      fixType: null,
      lat: null,
      lon: null,
      sog: null,
      cog: null,
      heading: null,
      rot: null,
      rotLabel: null,
      navStatus: null,
      navStatusCode: null,
      navShort: null,
      positionAccuracy: null,
      firstSeen: new Date().toISOString(),
      updatedAt: null,
      positionAt: null,
      track: [],
    };
    this.vessels.set(mmsi, v);
    this.entry(v, `entered the register — ${v.flag} flag`, 'register');
    this.emit('registered', v);
    console.log(`[fleet] new hull: ${v.name} (${mmsi}, ${v.flag})`);
    return v;
  }

  applyStatic(v, m) {
    const imo = Number(m.ImoNumber);
    if (Number.isFinite(imo) && imo > 0) v.imo = imo;
    v.callSign = cleanText(m.CallSign) ?? v.callSign;
    if (m.Type !== undefined && m.Type !== null) {
      const t = shipType(m.Type);
      v.typeCode = Number(m.Type);
      v.type = t.label;
      v.typeFamily = t.family;
    }
    const d = dimensions(m.Dimension);
    if (d) v.dim = d;
    const draught = Number(m.MaximumStaticDraught);
    if (Number.isFinite(draught) && draught > 0) {
      v.draught = draught;
      v.maxDraught = Math.max(v.maxDraught ?? 0, draught);
    }
    v.destination = cleanText(m.Destination) ?? v.destination;
    v.eta = etaToISO(m.Eta) ?? v.eta;
    if (m.FixType !== undefined) v.fixType = FIX_TYPE[Number(m.FixType)] ?? null;
  }

  applyPosition(v, m, meta, at) {
    const lat = firstFinite(m.Latitude, meta.latitude, meta.Latitude);
    const lon = firstFinite(m.Longitude, meta.longitude, meta.Longitude);
    if (lat === null || lon === null) return;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

    v.lat = lat;
    v.lon = lon;
    v.positionAt = at;

    const sog = firstFinite(m.Sog);
    if (sog !== null && sog < 102.3) v.sog = sog;
    const cog = firstFinite(m.Cog);
    if (cog !== null && cog < 360) v.cog = cog;
    const hdg = firstFinite(m.TrueHeading);
    v.heading = hdg !== null && hdg < 360 ? hdg : null;
    if (m.RateOfTurn !== undefined) {
      v.rot = m.RateOfTurn;
      v.rotLabel = rateOfTurnLabel(m.RateOfTurn);
    }
    if (m.NavigationalStatus !== undefined) {
      const c = Number(m.NavigationalStatus);
      v.navStatusCode = c;
      v.navStatus = NAV_STATUS[c] ?? 'Undefined';
      v.navShort = NAV_SHORT[c] ?? v.navStatus;
    }
    if (m.PositionAccuracy !== undefined) v.positionAccuracy = !!m.PositionAccuracy;

    const last = v.track[v.track.length - 1];
    const moved = !last || haversine(last.lat, last.lon, lat, lon) > 0.03;
    if (moved) {
      v.track.push({ lat, lon, t: at, sog: v.sog, cog: v.cog });
      if (v.track.length > TRACK_LIMIT) v.track.shift();
    }
  }

  // --- the log -----------------------------------------------------------

  // Compare before/after and write anything worth a line in the deck log.
  diff(v, before) {
    if (!before.positionAt && v.positionAt) {
      const where = v.cog !== null ? ` making ${fmtKn(v.sog)} on ${compassPoint(v.cog) ?? '-'}` : '';
      this.entry(v, `first fix received${where}`, 'fix');
    }
    if (before.navStatusCode !== v.navStatusCode && v.navStatus) {
      this.entry(v, phraseStatus(v), 'status');
    }
    if (before.destination !== v.destination && v.destination) {
      this.entry(v, `destination now reads ${v.destination}`, 'voyage');
    }
    if (before.draught !== v.draught && v.draught && before.draught) {
      const dir = v.draught > before.draught ? 'deeper' : 'lighter';
      const cond = v.maxDraught && v.draught < v.maxDraught * 0.7 ? ' — in ballast' : '';
      this.entry(v, `draught ${dir}, ${v.draught.toFixed(1)} m${cond}`, 'cargo');
    }
    if (before.imo === null && v.imo) {
      this.entry(v, `identified as IMO ${v.imo}${v.type ? `, ${v.type.toLowerCase()}` : ''}`, 'register');
    }
  }

  entry(v, text, kind = 'note') {
    const e = {
      id: `${v.mmsi}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      mmsi: v.mmsi,
      ship: v.name,
      text,
      kind,
      at: new Date().toISOString(),
    };
    this.log.push(e);
    if (this.log.length > LOG_LIMIT) this.log.shift();
    this.emit('log', e);
  }

  // --- views -------------------------------------------------------------

  snapshotAll() {
    const now = Date.now();
    return {
      vessels: [...this.vessels.values()].map(v => ({
        ...v,
        stale: v.positionAt ? now - Date.parse(v.positionAt) > STALE_AFTER_MS : true,
        track: v.track.slice(-120),
      })),
      log: this.log.slice(-120),
    };
  }
}

// --- helpers -------------------------------------------------------------

function isPositionMessage(type) {
  return type === 'PositionReport'
    || type === 'StandardClassBPositionReport'
    || type === 'ExtendedClassBPositionReport'
    || type === 'LongRangeAisBroadcastMessage';
}

function phraseStatus(v) {
  switch (v.navStatusCode) {
    case 0: return `full away on passage, ${fmtKn(v.sog)}`;
    case 1: return 'brought up to anchor';
    case 5: return 'all fast alongside';
    case 2: return 'reporting not under command';
    case 3: return 'reporting restricted in ability to manoeuvre';
    case 4: return 'reporting constrained by her draught';
    case 6: return 'reporting aground';
    default: return `status now ${v.navStatus.toLowerCase()}`;
  }
}

function fmtKn(sog) {
  return Number.isFinite(sog) ? `${sog.toFixed(1)} kn` : 'speed not reported';
}

function snapshot(v) {
  return {
    positionAt: v.positionAt, navStatusCode: v.navStatusCode,
    destination: v.destination, draught: v.draught, imo: v.imo,
  };
}

function firstFinite(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseUTC(s) {
  if (!s) return null;
  // AIS Stream stamps look like "2024-01-01 12:00:00.000 +0000 UTC".
  const cleaned = String(s).replace(' +0000 UTC', 'Z').replace(' ', 'T');
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Great-circle distance in nautical miles.
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
