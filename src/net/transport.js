// Transport interface used by the client. Every implementation exposes:
//   sendInput(tick, cmd)  queue one input command (flushed once per frame)
//   send(msg)             reliable message (hello, cmd, ping)
//   flush()               push queued inputs to the server
//   onSnapshot(cb)        unreliable 20 Hz state
//   onMessage(cb)         reliable stream (welcome, spawn, despawn, event, pong)
//   start()               begin delivering messages (everything received before is replayed)
//   kind                  'worker' | 'inprocess' | 'ws'
import { MSG } from './protocol.js';
import { LocalServer } from './localServer.js';
import { WsTransport } from './wsTransport.js';
import { GAME } from '../data/meta.js';

class BaseTransport {
  constructor() {
    this.snapCbs = [];
    this.msgCbs = [];
    this.outbox = [];
    this.stats = { sent: 0, recv: 0, snaps: 0 };
    this.held = [];
    this.live = false;
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
  dispatch(msg) {
    if (!this.live) { if (msg.t !== MSG.SNAPSHOT) this.held.push(msg); return; }
    this.stats.recv++;
    if (msg.t === MSG.SNAPSHOT) { this.stats.snaps++; for (const cb of this.snapCbs) cb(msg); }
    else for (const cb of this.msgCbs) cb(msg);
  }
}

export class WorkerTransport extends BaseTransport {
  constructor(worker) {
    super();
    this.kind = 'worker';
    this.worker = worker;
    worker.onmessage = (ev) => this.dispatch(ev.data);
  }
  send(msg) { this.stats.sent++; this.worker.postMessage(msg); }
}

// Fallback when module workers are unavailable (old browsers, restrictive sandboxes).
export class InProcessTransport extends BaseTransport {
  constructor(seed, bots, debug = false) {
    super();
    this.kind = 'inprocess';
    this.inbox = [];
    this.server = new LocalServer({ fire: true, seed, bots, debug, send: (_id, m) => this.inbox.push(m) });
    this.server.connect(1);
    this.server.start();
    this.inbox.push({ t: MSG.READY });
    this.drainTimer = setInterval(() => this.drain(), 4);
  }
  drain() {
    const list = this.inbox;
    if (!list.length) return;
    this.inbox = [];
    // Structured-clone-like isolation so client code can't mutate server arrays.
    for (const m of list) this.dispatch(m.t === MSG.SNAPSHOT ? { ...m, ents: m.ents.map((e) => e.slice()), you: m.you && m.you.slice() } : m);
  }
  send(msg) { this.stats.sent++; this.server.receive(1, JSON.parse(JSON.stringify(msg))); }
}

// Is this page served by our game server? → its /status ({game, players, max…}), else null.
export async function probeServer(base = location.href, ms = 1500) {
  if (typeof fetch === 'undefined' || !/^https?:/.test(String(base))) return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(new URL('status', base), { cache: 'no-store', signal: ctl && ctl.signal });
    if (!r.ok) return null;
    const st = await r.json();
    return st && st.game === GAME.title ? st : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

// The Node server marks the page it serves (<meta name="mn-server">): no probing, no 404 elsewhere.
export function servedByGameServer() {
  return typeof document !== 'undefined' && !!document.querySelector('meta[name="mn-server"]');
}

export function httpUrlFor(ws) { return ws.replace(/^ws/, 'http').replace(/\/ws$/, '/'); }

export function wsUrlFor(base = location.href) {
  const u = new URL('ws', base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = ''; u.hash = '';
  return u.href;
}

// Online when a server is named (?server=ws://…) or this page came from one (and not ?solo); otherwise the
// Worker (or in-process) local server. Result: the transport, plus `status` when online.
export async function createTransport({ seed, bots = 5, preferWorker = true, timeout = 4000, debug = false, server = null, solo = false, lagMs = 0, jitterMs = 0 }) {
  if (!solo) {
    let url = server;
    if (!url && servedByGameServer()) url = wsUrlFor();
    if (url) {
      try {
        const t = new WsTransport(url, { lagMs, jitterMs });
        const ok = await Promise.race([t.opened, new Promise((r) => setTimeout(() => r(false), timeout))]);
        if (ok) { t.status = await probeServer(httpUrlFor(url)); return t; }
        t.close();
        console.warn('[net] game server unreachable, playing solo');
      } catch (err) { console.warn('[net] websocket failed:', err); }
    }
  }
  if (preferWorker && typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      const t = new WorkerTransport(worker);
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeout);
        worker.addEventListener('error', () => { clearTimeout(timer); resolve(false); }, { once: true });
        worker.addEventListener('message', (ev) => { if (ev.data && ev.data.t === MSG.READY) { clearTimeout(timer); resolve(true); } });
        worker.postMessage({ t: 'boot', seed, bots, debug });
      });
      if (ok) return t;
      worker.terminate();
      console.warn('[net] worker unavailable, falling back to in-process server');
    } catch (err) {
      console.warn('[net] worker failed:', err);
    }
  }
  return new InProcessTransport(seed, bots, debug);
}
