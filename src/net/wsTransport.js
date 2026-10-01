// WebSocket transport stub: SAME interface as WorkerTransport. Connecting a real Node server means
// running LocalServer behind a ws endpoint (see README "Servidor real") and pointing this at it.
//
// Wire format today: one JSON object per frame, exactly the messages in protocol.js.
// Planned binary format: DESIGN.md §10 (u8 type, u32 tick, u16 count, quantized entities).
import { MSG } from './protocol.js';

export class WsTransport {
  constructor(url) {
    this.kind = 'ws';
    this.url = url;
    this.snapCbs = [];
    this.msgCbs = [];
    this.outbox = [];
    this.stats = { sent: 0, recv: 0, snaps: 0 };
    this.held = [];
    this.live = false;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.dispatch({ t: MSG.READY });
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.dispatch(msg);
    };
    this.ws.onclose = () => this.dispatch({ t: MSG.EVENT, ev: { type: 'disconnected' } });
  }
  start() {
    this.live = true;
    const list = this.held;
    this.held = [];
    for (const m of list) this.dispatch(m);
  }
  onSnapshot(cb) { this.snapCbs.push(cb); }
  onMessage(cb) { this.msgCbs.push(cb); }
  sendInput(_tick, cmd) { this.outbox.push(cmd); }
  flush() {
    if (!this.outbox.length) return;
    this.send({ t: MSG.INPUTS, cmds: this.outbox });
    this.outbox = [];
  }
  send(msg) {
    if (this.ws.readyState !== 1) return;
    this.stats.sent++;
    this.ws.send(JSON.stringify(msg));
  }
  dispatch(msg) {
    if (!this.live) { if (msg.t !== MSG.SNAPSHOT) this.held.push(msg); return; }
    this.stats.recv++;
    if (msg.t === MSG.SNAPSHOT) { this.stats.snaps++; for (const cb of this.snapCbs) cb(msg); }
    else for (const cb of this.msgCbs) cb(msg);
  }
}
