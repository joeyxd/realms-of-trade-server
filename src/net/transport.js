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
    this.server = new LocalServer({ seed, bots, debug, send: (_id, m) => this.inbox.push(m) });
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

export async function createTransport({ seed, bots = 5, preferWorker = true, timeout = 4000, debug = false }) {
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
