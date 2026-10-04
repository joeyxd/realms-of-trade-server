// Artificial latency for testing the netcode on one machine: every message is delivered `ms` later,
// ± `jitter`, in order (a WebSocket is TCP: a late message holds back the ones behind it). One link per
// direction. Used by the Node server (LAG_MS / JITTER_MS), the client (?lag=&jitter=) and tools/nettest.mjs.
export class LagLink {
  constructor(deliver, ms = 0, jitter = 0, now = () => performance.now()) {
    this.deliver = deliver;
    this.ms = Math.max(0, +ms || 0);
    this.jitter = Math.max(0, +jitter || 0);
    this.now = now;
    this.q = [];
    this.last = 0;
    this.timer = null;
  }

  get active() { return this.ms > 0 || this.jitter > 0; }

  push(msg) {
    if (!this.active) { this.deliver(msg); return; }
    const at = Math.max(this.last, this.now() + this.ms + (Math.random() * 2 - 1) * this.jitter);
    this.last = at;
    this.q.push({ at, msg });
    if (!this.timer) this.arm();
  }

  arm() {
    const head = this.q[0];
    this.timer = head ? setTimeout(() => this.drain(), Math.max(0, head.at - this.now())) : null;
  }

  drain() {
    const t = this.now();
    let n = 0;
    while (n < this.q.length && this.q[n].at <= t + 0.5) n++;
    const due = this.q.splice(0, n);
    this.timer = null;
    for (const d of due) this.deliver(d.msg);
    if (this.q.length) this.arm();
  }

  close() { clearTimeout(this.timer); this.timer = null; this.q.length = 0; }
}
