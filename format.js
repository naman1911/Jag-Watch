// Turning numbers into the forms a navigator reads them in.

// Charts and logbooks write positions in degrees and decimal minutes, not
// decimal degrees. 19.0716 N becomes 19° 04.3' N.
export function latLonText(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'No fix';
  return `${dm(lat, 2, 'N', 'S')}   ${dm(lon, 3, 'E', 'W')}`;
}

function dm(value, pad, pos, neg) {
  const hemi = value >= 0 ? pos : neg;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${String(deg).padStart(pad, '0')}\u00b0 ${min.toFixed(1).padStart(4, '0')}'\u2009${hemi}`;
}

export function hhmm(iso) {
  if (!iso) return '----';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '----';
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function fullTime(iso) {
  if (!iso) return 'Not reported';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not reported';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
  return `${day} ${month} ${hhmm(iso)} UTC`;
}

export function age(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'never';
  if (ms < 60000) return 'just now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function knots(v) {
  return Number.isFinite(v) ? `${v.toFixed(1)} kn` : '—';
}

export function degrees(v) {
  return Number.isFinite(v) ? `${v.toFixed(0).padStart(3, '0')}\u00b0` : '—';
}

export function metres(v, dp = 1) {
  return Number.isFinite(v) ? `${v.toFixed(dp)} m` : '—';
}

export function compassPoint(deg) {
  if (!Number.isFinite(deg)) return null;
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(deg / 22.5) % 16];
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // nautical miles
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Advance a position along a course at a speed — the dead-reckoning plot.
export function deadReckon(lat, lon, cog, sog, seconds) {
  if (![lat, lon, cog, sog].every(Number.isFinite) || sog < 0.3) return null;
  const nm = (sog * seconds) / 3600;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = (nm * Math.cos(toRad(cog))) / 60;
  const dLon = (nm * Math.sin(toRad(cog))) / (60 * Math.max(0.05, Math.cos(toRad(lat))));
  return [lat + dLat, lon + dLon];
}

export function distanceRun(track) {
  let nm = 0;
  for (let i = 1; i < track.length; i += 1) {
    nm += haversine(track[i - 1].lat, track[i - 1].lon, track[i].lat, track[i].lon);
  }
  return nm;
}
