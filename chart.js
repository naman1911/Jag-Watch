// The chart.
//
// Each hull is drawn as a chart-style vessel symbol turned to her heading,
// with a velocity vector ahead of the bow whose length is her speed — the same
// thing a navigator pencils onto a plot. Her past fixes trail behind as a ruled
// course line. Between fixes she is advanced by dead reckoning and drawn hollow,
// so an estimated position never masquerades as a reported one.

import { deadReckon, knots, compassPoint } from './format.js';

const DR_CEILING_S = 20 * 60;   // stop advancing after twenty minutes of silence
const MAX_VECTOR_PX = 34;

export class Chart {
  constructor(el, { onSelect }) {
    this.onSelect = onSelect;
    this.markers = new Map();
    this.courses = new Map();
    this.drLines = new Map();
    this.selected = null;

    this.map = L.map(el, {
      worldCopyJump: true,
      zoomControl: true,
      minZoom: 2,
      attributionControl: true,
    }).setView([15, 68], 4);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors, &copy; CARTO &middot; AIS via aisstream.io',
    }).addTo(this.map);

    this.graticule();
    setInterval(() => this.advance(), 1000);
  }

  // A faint meridian and parallel grid, as on the paper.
  graticule() {
    const lines = [];
    for (let lon = -180; lon <= 180; lon += 10) lines.push([[-85, lon], [85, lon]]);
    for (let lat = -80; lat <= 80; lat += 10) lines.push([[lat, -180], [lat, 180]]);
    L.polyline(lines, {
      color: '#13303d', weight: 0.4, opacity: 0.12, interactive: false,
    }).addTo(this.map);
  }

  upsert(v) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return;
    const existing = this.markers.get(v.mmsi);
    const marker = existing?.marker ?? L.marker([v.lat, v.lon], {
      icon: this.icon(v),
      keyboard: true,
      title: v.name,
      riseOnHover: true,
    }).addTo(this.map).on('click', () => this.onSelect(v.mmsi));

    this.markers.set(v.mmsi, { marker, v });
    marker.setLatLng([v.lat, v.lon]);
    marker.setIcon(this.icon(v));
    this.drawCourse(v);
  }

  drawCourse(v) {
    const pts = (v.track ?? []).filter(p => Number.isFinite(p.lat)).map(p => [p.lat, p.lon]);
    if (pts.length < 2) return;
    const existing = this.courses.get(v.mmsi);
    if (existing) {
      existing.setLatLngs(pts);
      return;
    }
    const line = L.polyline(pts, {
      className: 'course-line',
      color: '#47555e',
      weight: 1.1,
      interactive: false,
    }).addTo(this.map);
    this.courses.set(v.mmsi, line);
  }

  /** Move every hull along her course by dead reckoning between fixes. */
  advance() {
    for (const [mmsi, { marker, v }] of this.markers) {
      const elapsed = v.positionAt ? (Date.now() - Date.parse(v.positionAt)) / 1000 : null;
      if (elapsed === null || elapsed < 12) continue;
      const capped = Math.min(elapsed, DR_CEILING_S);
      const dr = deadReckon(v.lat, v.lon, v.cog, v.sog, capped);
      if (!dr) continue;
      marker.setLatLng(dr);
      marker.setIcon(this.icon(v, true));
      this.drLine(mmsi, [[v.lat, v.lon], dr]);
    }
  }

  drLine(mmsi, pts) {
    const existing = this.drLines.get(mmsi);
    if (existing) {
      existing.setLatLngs(pts);
      return;
    }
    this.drLines.set(mmsi, L.polyline(pts, {
      className: 'course-line course-dr',
      color: '#bd0066',
      weight: 1.2,
      interactive: false,
    }).addTo(this.map));
  }

  icon(v, reckoned = false) {
    const moving = Number.isFinite(v.sog) && v.sog > 0.5;
    const stopped = v.navStatusCode === 1 || v.navStatusCode === 5 || !moving;
    const turn = Number.isFinite(v.heading) ? v.heading : (v.cog ?? 0);
    const vector = Math.min(MAX_VECTOR_PX, 6 + (v.sog ?? 0) * 2.2);
    const isSelected = this.selected === v.mmsi;

    const hullClass = reckoned ? 'hull-dr' : (stopped ? 'hull-stopped' : 'hull');
    const shape = stopped
      ? '<circle cx="0" cy="0" r="4.5" />'
      : '<path d="M0 -9 L4.4 7 L0 4.4 L-4.4 7 Z" />';

    const html = `
      <svg width="120" height="90" viewBox="-60 -45 120 90">
        <g transform="translate(0,0)">
          ${moving && !stopped ? `<g transform="rotate(${turn})"><line class="vector" x1="0" y1="-9" x2="0" y2="${-9 - vector}" /></g>` : ''}
          <g transform="rotate(${turn})" class="${hullClass}">${shape}</g>
          ${isSelected ? '<circle cx="0" cy="0" r="13" fill="none" stroke="#bd0066" stroke-width="1" stroke-dasharray="2 3" />' : ''}
          <text class="vessel-label" x="10" y="4">${escape(shortName(v.name))}</text>
        </g>
      </svg>`;

    return L.divIcon({
      className: 'vessel-icon',
      html,
      iconSize: [120, 90],
      iconAnchor: [60, 45],
    });
  }

  select(mmsi) {
    this.selected = mmsi;
    for (const [id, { marker, v }] of this.markers) {
      marker.setIcon(this.icon(v));
      if (id === mmsi) marker.setZIndexOffset(1000);
      else marker.setZIndexOffset(0);
    }
  }

  panTo(mmsi) {
    const hit = this.markers.get(mmsi);
    if (!hit) return;
    this.map.flyTo(hit.marker.getLatLng(), Math.max(this.map.getZoom(), 6), { duration: 0.8 });
  }

  fit() {
    const pts = [...this.markers.values()].map(({ marker }) => marker.getLatLng());
    if (!pts.length) return;
    if (pts.length === 1) {
      this.map.setView(pts[0], 6);
      return;
    }
    this.map.fitBounds(L.latLngBounds(pts).pad(0.22));
  }

  invalidate() {
    this.map.invalidateSize();
  }
}

export function courseText(v) {
  const pt = compassPoint(v.cog);
  if (!Number.isFinite(v.sog)) return v.navShort ?? 'No report';
  if (v.sog < 0.5) return v.navShort ?? 'Stopped';
  return `${knots(v.sog)} on ${pt ?? '—'}`;
}

function shortName(name) {
  return (name ?? '').replace(/^JAG\s+/i, 'Jag ');
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
