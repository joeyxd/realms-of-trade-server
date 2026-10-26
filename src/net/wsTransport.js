// WebSocket transport to the Node game server (server/index.mjs): the SAME interface as WorkerTransport.
// Wire format: one JSON object per frame, exactly the messages in protocol.js (the server compresses
// with permessage-deflate). Extras over the local transports: onClose(cb), rtt (ms, from ping/pong every
// 2 s), byte counters, optional artificial latency (?lag=&jitter=, per direction) through LagLink.
import { MSG } from './protocol.js';
import { LagLink } from './lagLink.js';

export class WsTransport {
  constructor(url, { lagMs = 0, jitterMs = 0, WebSocketImpl = globalThis.WebSocket } = {}) {
    this.kind = 'ws';
    this.url = url;
    this.snapCbs = [];
    this.msgCbs = [];
    this.closeCbs = [];
    this.outbox = [];
    this.stats = { sent: 0, recv: 0, snaps: 0, bytesIn: 0, bytesOut: 0 };
    this.held = [];
    this.live = false;
    this.rtt = 0;
    this.closed = false;
    this.pingTimer = null;
    this.inLink = new LagLink((m) => this.dispatch(m), lagMs, jitterMs);
    this.outLink = new LagLink((data) => { if (this.ws.readyState === 1) this.ws.send(data); }, lagMs, jitterMs);
    this.ws = new WebSocketImpl(url);
    this.opened = new Promise((resolve) => {
      this.ws.onopen = () => {
        resolve(true);
        this.dispatch({ t: MSG.READY });
        this.ping();
        this.pingTimer = setInterval(() => this.ping(), 2000);
      };
      this.ws.onerror = () => resolve(false);
    });
    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      this.stats.bytesIn += ev.data.length;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.inLink.push(msg);
    };
    this.ws.onclose = (ev) => {
      this.closed = true;
      clearInterval(this.pingTimer);
      for (const cb of this.closeCbs) cb({ code: ev.code, reason: ev.reason });
    };
  }

  start() {
    this.live = true;
    const list = this.held;
    this.held = [];
    for (const m of list) this.dispatch(m);
  }
  onSnapshot(cb) { this.snapCbs.push(cb); }
  onMessage(cb) { this.msgCbs.push(cb); }
  onClose(cb) { this.closeCbs.push(cb); }
  sendInput(_tick, cmd) { this.outbox.push(cmd); }
  flush() {
    if (!this.outbox.length) return;
    this.send({ t: MSG.INPUTS, cmds: this.outbox });
    this.outbox = [];
  }
  send(msg) {
    if (this.ws.readyState !== 1) return;
    const data = JSON.stringify(msg);
    this.stats.sent++;
    this.stats.bytesOut += data.length;
    this.outLink.push(data);
  }
  ping() { this.send({ t: MSG.PING, t0: performance.now() }); }
  dispatch(msg) {
    if (msg.t === MSG.PONG) {
      const r = performance.now() - msg.t0;
      if (r >= 0 && r < 10000) this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.3 : r;
    }
    if (!this.live) { if (msg.t !== MSG.SNAPSHOT) this.held.push(msg); return; }
    this.stats.recv++;
    if (msg.t === MSG.SNAPSHOT) { this.stats.snaps++; for (const cb of this.snapCbs) cb(msg); }
    else for (const cb of this.msgCbs) cb(msg);
  }
  close() {
    clearInterval(this.pingTimer);
    this.inLink.close(); this.outLink.close();
    try { this.ws.close(1000); } catch { /* already closed */ }
  }
}
