// ITU-R M.1371 code tables, plus the small conversions that turn raw AIS
// integers into something a person on a bridge would actually say.

export const NAV_STATUS = {
  0: 'Under way using engine',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted manoeuvrability',
  4: 'Constrained by her draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Engaged in fishing',
  8: 'Under way sailing',
  9: 'Reserved (HSC)',
  10: 'Reserved (WIG)',
  11: 'Towing astern',
  12: 'Pushing ahead or towing alongside',
  13: 'Reserved',
  14: 'AIS-SART, MOB-AIS or EPIRB-AIS',
  15: 'Undefined',
};

// Short forms for the fleet ledger, where space is tight.
export const NAV_SHORT = {
  0: 'Under way', 1: 'At anchor', 2: 'NUC', 3: 'RAM', 4: 'Draught-constrained',
  5: 'Moored', 6: 'Aground', 7: 'Fishing', 8: 'Sailing', 15: 'Undefined',
};

const TYPE_SECOND_DIGIT_TANKER = {
  0: 'Tanker', 1: 'Tanker (hazard A)', 2: 'Tanker (hazard B)',
  3: 'Tanker (hazard C)', 4: 'Tanker (hazard D)', 9: 'Tanker',
};

export function shipType(code) {
  const n = Number(code);
  if (!Number.isFinite(n) || n <= 0) return { label: 'Not reported', family: 'unknown' };
  if (n >= 80 && n <= 89) {
    return { label: TYPE_SECOND_DIGIT_TANKER[n % 10] ?? 'Tanker', family: 'tanker' };
  }
  if (n >= 70 && n <= 79) return { label: 'Cargo', family: 'cargo' };
  if (n >= 60 && n <= 69) return { label: 'Passenger', family: 'passenger' };
  if (n >= 50 && n <= 59) {
    const special = {
      50: 'Pilot vessel', 51: 'Search and rescue', 52: 'Tug', 53: 'Port tender',
      54: 'Anti-pollution', 55: 'Law enforcement', 58: 'Medical transport',
    };
    return { label: special[n] ?? 'Special craft', family: 'service' };
  }
  if (n >= 40 && n <= 49) return { label: 'High-speed craft', family: 'hsc' };
  if (n === 30) return { label: 'Fishing', family: 'fishing' };
  if (n === 31 || n === 32) return { label: 'Towing', family: 'service' };
  if (n === 33) return { label: 'Dredger', family: 'service' };
  if (n === 35) return { label: 'Military', family: 'military' };
  if (n === 36) return { label: 'Sailing', family: 'sailing' };
  if (n === 37) return { label: 'Pleasure craft', family: 'pleasure' };
  return { label: `Type ${n}`, family: 'other' };
}

export const FIX_TYPE = {
  0: 'Undefined', 1: 'GPS', 2: 'GLONASS', 3: 'Combined GPS/GLONASS',
  4: 'Loran-C', 5: 'Chayka', 6: 'Integrated navigation system',
  7: 'Surveyed', 8: 'Galileo',
};

// AIS reports hull dimensions as distances from the transponder to bow (A),
// stern (B), port (C) and starboard (D). Length and beam fall out of that.
export function dimensions(dim) {
  if (!dim) return null;
  const a = num(dim.A), b = num(dim.B), c = num(dim.C), d = num(dim.D);
  if ([a, b, c, d].every(v => v === null)) return null;
  const loa = a !== null && b !== null ? a + b : null;
  const beam = c !== null && d !== null ? c + d : null;
  return { a, b, c, d, loa, beam };
}

// ETA arrives as month/day/hour/minute with no year. Resolve it against now,
// rolling into next year when the month has already passed.
export function etaToISO(eta, now = new Date()) {
  if (!eta) return null;
  const { Month, Day, Hour, Minute } = eta;
  if (!Month || !Day || Month > 12 || Day > 31) return null;
  if (Hour === undefined || Hour > 24 || Minute > 59) return null;
  let year = now.getUTCFullYear();
  if (Month < now.getUTCMonth() + 1 - 6) year += 1;
  const d = new Date(Date.UTC(year, Month - 1, Day, Hour % 24, Minute || 0));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// AIS strings are padded with '@'. Strip them before anyone has to read it.
export function cleanText(s) {
  if (typeof s !== 'string') return null;
  const out = s.replace(/@+/g, ' ').replace(/\s+/g, ' ').trim();
  return out.length ? out : null;
}

export function rateOfTurnLabel(rot) {
  const n = Number(rot);
  if (!Number.isFinite(n) || n === -128) return 'Not available';
  if (n === 0) return 'Steady';
  // AIS encodes ROT as 4.733 * sqrt(deg/min), signed.
  const degPerMin = Math.sign(n) * (n / 4.733) ** 2;
  const dir = n > 0 ? 'starboard' : 'port';
  return `${Math.abs(degPerMin).toFixed(0)}\u00b0/min to ${dir}`;
}

export function compassPoint(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n) || n >= 360) return null;
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(n / 22.5) % 16];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
