// Upstream link to aisstream.io.
//
// The service requires a subscription within three seconds of the socket
// opening, sends binary frames of UTF-8 JSON, and closes the connection if you
// replace a subscription more than once a second. All three shape this file.
//
// Two phases:
//   trawl — watch broad boxes over the fleet's trading grounds and keep every
//           hull whose name matches the pattern.
//   lock  — once hulls are known, resubscribe with an MMSI filter so the feed
//           carries almost nothing but our own ships, anywhere on earth.

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const ENDPOINT = 'wss://stream.aisstream.io/v0/stream';
const SUBSCRIBE_WITHIN_MS = 2000;   // service allows 3s; leave headroom
const RESUBSCRIBE_FLOOR_MS = 1500;  // service allows 1/s; leave headroom
const MMSI_FILTER_LIMIT = 200;
const WORLD = [[[-90, -180], [90, 180]]];

export class AisStreamLink extends EventEmitter {
  constructor({ apiKey, trawlBoxes, messageTypes }) {
    super();
    this.apiKey = apiKey;
    this.trawlBoxes = trawlBoxes?.length ? trawlBoxes : WORLD;
    this.messageTypes = messageTypes ?? ['PositionReport', 'ShipStaticData', 'StandardClassBPositionReport'];
    this.ws = null;
    this.mmsis = [];
    this.phase = 'trawl';
    this.attempt = 0;
    this.lastSubscribeAt = 0;
    this.pendingResubscribe = null;
    this.stopped = false;
    this.stats = { messages: 0, connectedSince: null, lastMessageAt: null, compression: null };
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.pendingResubscribe);
    this.ws?.close();
  }

  /** Hand the link the MMSIs we now know about. Switches it into lock phase. */
  setFleet(mmsis) {
    const next = [...new Set(mmsis)].filter(m => /^\d{9}$/.test(m)).slice(0, MMSI_FILTER_LIMIT);
    const changed = next.length !== this.mmsis.length
      || next.some((m, i) => m !== this.mmsis[i]);
    this.mmsis = next;
    if (changed && next.length) this.scheduleSubscribe();
  }

  /** Go back to watching wide water — useful for picking up hulls we've missed. */
  trawl() {
    this.phase = 'trawl';
    this.scheduleSubscribe();
  }

  lock() {
    if (!this.mmsis.length) return false;
    this.phase = 'lock';
    this.scheduleSubscribe();
    return true;
  }

  connect() {
    if (this.stopped) return;
    this.emit('status', { state: 'connecting', attempt: this.attempt });

    const ws = new WebSocket(ENDPOINT, { perMessageDeflate: true });
    this.ws = ws;

    const guard = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.terminate();
      }
    }, 15000);

    ws.on('open', () => {
      clearTimeout(guard);
      this.attempt = 0;
      this.stats.connectedSince = new Date().toISOString();
      // Must land inside the service's three-second window.
      setTimeout(() => this.sendSubscription(), 50);
      this.emit('status', { state: 'open', phase: this.phase });
    });

    ws.on('message', (data) => {
      // Frames arrive binary; decode before parsing.
      let envelope;
      try {
        envelope = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
      } catch {
        return;
      }
      if (envelope.MessageType === 'SubscriptionConfirmation') {
        this.stats.compression = envelope?.Message?.CompressionEnabled ?? null;
        this.emit('status', {
          state: 'subscribed',
          phase: this.phase,
          watching: this.phase === 'lock' ? this.mmsis.length : this.trawlBoxes.length,
          compression: this.stats.compression,
        });
        return;
      }
      if (envelope.MessageType === 'Error' || envelope.Error) {
        this.emit('status', { state: 'error', detail: envelope.Error ?? envelope.Message });
        return;
      }
      this.stats.messages += 1;
      this.stats.lastMessageAt = new Date().toISOString();
      this.emit('ais', envelope);
    });

    ws.on('close', (code, reason) => {
      clearTimeout(guard);
      this.stats.connectedSince = null;
      this.emit('status', { state: 'closed', code, reason: reason?.toString() || null });
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.emit('status', { state: 'error', detail: err.message });
    });
  }

  scheduleReconnect() {
    if (this.stopped) return;
    this.attempt += 1;
    const base = Math.min(30000, 1000 * 2 ** Math.min(this.attempt, 5));
    const wait = base / 2 + Math.random() * base / 2; // backoff with jitter
    this.emit('status', { state: 'reconnecting', inMs: Math.round(wait), attempt: this.attempt });
    this.retryTimer = setTimeout(() => this.connect(), wait);
  }

  scheduleSubscribe() {
    clearTimeout(this.pendingResubscribe);
    const since = Date.now() - this.lastSubscribeAt;
    const wait = Math.max(0, RESUBSCRIBE_FLOOR_MS - since);
    this.pendingResubscribe = setTimeout(() => this.sendSubscription(), wait);
  }

  sendSubscription() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const sub = {
      APIKey: this.apiKey,
      BoundingBoxes: this.phase === 'lock' ? WORLD : this.trawlBoxes,
      FilterMessageTypes: this.messageTypes,
    };
    if (this.phase === 'lock' && this.mmsis.length) {
      sub.FiltersShipMMSI = this.mmsis;
    }
    this.ws.send(JSON.stringify(sub));
    this.lastSubscribeAt = Date.now();
  }
}

export { SUBSCRIBE_WITHIN_MS, MMSI_FILTER_LIMIT };
