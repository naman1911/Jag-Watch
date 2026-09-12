# Jag Watch

A live chart table for the Jag fleet. Every hull whose AIS name begins **Jag** gets found, written into a register, and plotted on a chart styled after a British Admiralty paper sheet — courses ruled in pencil, vessels marked in Admiralty magenta, positions written in degrees and decimal minutes the way a navigator reads them.

Data comes from [aisstream.io](https://aisstream.io), a free real-time AIS feed over WebSocket.

---

## How it finds the fleet

AIS Stream can filter a subscription by MMSI, but not by ship name. So Jag Watch works the way a ship's agent would, in two phases:

**Trawl.** It subscribes to broad bounding boxes over the water a Jag hull actually trades in — the Red Sea, Gulf of Aden, Arabian Sea, the Gulf, the Bay of Bengal and the Malacca approaches — and reads everything that passes. Any hull whose name matches `^JAG\b` goes into the register, along with her MMSI.

**Lock.** Once hulls are in the register, it resubscribes with `FiltersShipMMSI` set to exactly those MMSIs and the bounding box opened to the whole world. From then on the feed carries almost nothing but the fleet, and a Jag ship is followed wherever she goes — Brazil, the US Gulf, anywhere.

The register is written to `data/fleet.json`, so a restart does not start from nothing. A handful of hulls usually appear within minutes; the full fleet takes a few hours of trawling, since a ship only enters the register when she happens to transmit inside one of the boxes.

Flag comes from the MMSI itself: the first three digits are the issuing administration, so `419…` is India and `538…` is the Marshall Islands. Both appear across the fleet.

## What you see

- **Chart.** Each ship is a chart-style vessel symbol turned to her true heading, with a velocity vector drawn ahead of the bow whose length is her speed. Anchored and moored hulls are hollow circles instead. Past fixes trail behind as a ruled course line.
- **Dead reckoning.** AIS positions arrive every few minutes, not every second. Between fixes each ship is advanced along her course at her last reported speed and redrawn hollow with a dotted line back to the last real fix. An estimate never gets drawn as though it were a report, and the advance stops after twenty minutes of silence.
- **Register.** One ruled row per hull — flag, name, speed, what she's doing, how long since she spoke. Silent ships fade and sort to the bottom.
- **Deck log.** Events written in log voice, timed in UTC: `0412 Jag Aparna full away on passage, 12.4 kn.` Entries are raised for first fix, status changes, a new destination, a draught change (with a guess at loaded or in ballast), and identification against an IMO number.
- **Particulars.** Tap any hull for everything AIS carries about her: MMSI, IMO, call sign, type, navigational status, rate of turn, length overall and beam derived from the transponder offsets, draught, destination, ETA, fix quality, and distance run across the fixes on record.

## Running it

```bash
git clone <your-repo-url> jag-watch
cd jag-watch
npm install
cp .env.example .env      # then paste your key into .env
npm start                 # http://localhost:8080
```

Get a free API key at [aisstream.io](https://aisstream.io) — sign in with GitHub, then create one under Account.

With no key set, the server runs a simulator instead so you can see the chart working. Simulated hulls are invented, the front end says so in a magenta banner, and nothing from that mode should ever be read as a real position.

```bash
npm run demo    # force the simulator even with a key present
```

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AISSTREAM_API_KEY` | — | Your key. Blank means simulator. |
| `PORT` | `8080` | Local port. |
| `FLEET_NAME_PATTERN` | `^JAG\b` | Anchored regex, tested against the uppercased AIS name. |
| `TRAWL_MINUTES` | `20` | How long to watch wide water before locking onto MMSIs. |
| `TRAWL_BOXES` | Indian Ocean set | JSON array of `[[lat,lon],[lat,lon]]` corner pairs. |
| `FLEET_STORE` | `data/fleet.json` | Where the register is kept. |

## Why there's a server

AIS Stream does not permit direct browser connections — the key has to sit on your own machine, with only the data each client needs proxied onward. So this is a small Node process holding one upstream socket, not a static page. That turns out to be the right shape anyway: one connection feeds any number of browsers, and the register survives a page reload.

The server respects the service's stated limits: the subscription goes out inside the three-second window, resubscriptions are throttled to well under one per second, MMSI filters are capped at 200, `permessage-deflate` is enabled, and reconnects use exponential backoff with jitter.

**Never commit `.env`.** It is gitignored. If a key does get pushed, rotate it from your AIS Stream account.

## Deploying

Any host that runs a Node process and allows outbound WebSockets works — Railway, Render, Fly.io, or a small VPS. Set `AISSTREAM_API_KEY` as a secret in the host's dashboard, not in the repo. GitHub Pages will not work: it serves static files only, and this needs a running process.

Note that AIS Stream allows three connections per account and three per originating IP, so don't run several copies from the same machine.

## Notes and limits

- AIS is line-of-sight to shore receivers and satellites. Mid-ocean gaps of hours are normal and mean nothing is wrong.
- `^JAG\b` will also catch any unrelated vessel that happens to be named Jag-something. The register shows each hull's flag and IMO, which makes an impostor easy to spot.
- Everything shown is what the ship's own transponder broadcast. AIS fields like destination and ETA are typed in by hand on the bridge and are often stale or approximate.
- No SLA, no replay. Treat it as a window, not a record.

## Design

Palette and type are taken from the paper the subject already lives on. Land in chart buff `#f1e6c8`, deep water near-white, a pale shoal tint, and magenta `#bd0066` reserved — as on a real Admiralty sheet — for the things you are meant to look at. Vessel names are set in Newsreader italic, following the chart convention of italic lettering for floating and underwater features; readouts are Barlow Condensed for tabular numerals. The one piece of unprompted motion is the course lines ruling themselves in on load, like a pencil drawn along a parallel rule. Reduced motion is respected.

## Licence

MIT.
