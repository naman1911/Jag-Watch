// Demo mode. Produces AIS-Stream-shaped envelopes for invented hulls so the
// chart can be looked at without a key. Everything it emits is fictional and
// the UI labels it as such — never present a simulated run as fleet position.

const HULLS = [
  { mmsi: '419900101', name: 'JAG TESTUDO', imo: 9000101, type: 80, call: 'DEMO1', dest: 'JEBEL ALI', leg: [[19.0, 72.8], [25.2, 55.3]] },
  { mmsi: '419900102', name: 'JAG MIRAGE', imo: 9000102, type: 70, call: 'DEMO2', dest: 'SINGAPORE', leg: [[13.1, 80.3], [1.26, 103.8]] },
  { mmsi: '538900103', name: 'JAG CIPHER', imo: 9000103, type: 84, call: 'DEMO3', dest: 'FUJAIRAH', leg: [[12.8, 43.3], [25.1, 56.4]] },
  { mmsi: '419900104', name: 'JAG DECOY', imo: 9000104, type: 82, call: 'DEMO4', dest: 'MUNDRA', leg: [[6.9, 79.9], [22.8, 69.7]] },
  { mmsi: '538900105', name: 'JAG PHANTOM', imo: 9000105, type: 89, call: 'DEMO5', dest: 'AT ANCHOR', leg: [[18.9, 72.9], [18.93, 72.95]] },
];

export function startSimulator(onEnvelope) {
  const state = HULLS.map((h, i) => ({ ...h, p: i * 0.17, dir: 1 }));

  const staticTimer = setInterval(() => {
    for (const s of state) onEnvelope(staticMessage(s));
  }, 60000);

  const posTimer = setInterval(() => {
    for (const s of state) {
      s.p += 0.0018 * (0.6 + Math.random() * 0.8) * s.dir;
      if (s.p > 1) { s.p = 1; s.dir = -1; }
      if (s.p < 0) { s.p = 0; s.dir = 1; }
      onEnvelope(positionMessage(s));
    }
  }, 4000);

  for (const s of state) {
    onEnvelope(staticMessage(s));
    onEnvelope(positionMessage(s));
  }

  return () => { clearInterval(staticTimer); clearInterval(posTimer); };
}

function positionMessage(s) {
  const [[lat1, lon1], [lat2, lon2]] = s.leg;
  const lat = lat1 + (lat2 - lat1) * s.p + wobble();
  const lon = lon1 + (lon2 - lon1) * s.p + wobble();
  const cog = (bearing(lat1, lon1, lat2, lon2) + (s.dir < 0 ? 180 : 0) + 360) % 360;
  const anchored = Math.abs(lat2 - lat1) < 0.1;
  return {
    MessageType: 'PositionReport',
    MetaData: { MMSI: Number(s.mmsi), ShipName: s.name, latitude: lat, longitude: lon, time_utc: nowStamp() },
    Message: {
      PositionReport: {
        MessageID: 1, UserID: Number(s.mmsi), Valid: true,
        NavigationalStatus: anchored ? 1 : 0,
        RateOfTurn: Math.round((Math.random() - 0.5) * 20),
        Sog: anchored ? 0.1 : 11 + Math.random() * 3.5,
        PositionAccuracy: true,
        Longitude: lon, Latitude: lat,
        Cog: cog, TrueHeading: Math.round(cog),
        Timestamp: new Date().getUTCSeconds(),
      },
    },
  };
}

function staticMessage(s) {
  const now = new Date(Date.now() + 36e5 * (12 + Math.random() * 60));
  return {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: Number(s.mmsi), ShipName: s.name, time_utc: nowStamp() },
    Message: {
      ShipStaticData: {
        UserID: Number(s.mmsi), Valid: true, ImoNumber: s.imo,
        CallSign: s.call, Name: s.name, Type: s.type,
        Dimension: { A: 160, B: 60, C: 16, D: 16 },
        FixType: 1,
        Eta: { Month: now.getUTCMonth() + 1, Day: now.getUTCDate(), Hour: now.getUTCHours(), Minute: 0 },
        MaximumStaticDraught: 9 + Math.random() * 5,
        Destination: s.dest,
      },
    },
  };
}

const wobble = () => (Math.random() - 0.5) * 0.02;
const nowStamp = () => new Date().toISOString().replace('T', ' ').replace('Z', '.000 +0000 UTC');

function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180) / Math.PI;
}
