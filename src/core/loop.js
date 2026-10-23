// Fixed-step simulation (60 Hz accumulator) with decoupled rendering.
// timeScale (slow-mo) and hitstop scale the simulated time; the UI always runs in real time.
import { DT, MAX_FRAME_DT } from '../data/tuning.js';

export class Loop {
  constructor({ fixed, frame }) {
    this.fixed = fixed;
    this.frame = frame;
    this.acc = 0;
    this.timeScale = 1;
    this.hitstop = 0; // seconds of frozen sim remaining
    this.slowT = 0; this.slowScale = 1; // slow-mo (real seconds left, scale)
    this.paused = false; // no fixed steps, simDt = 0 (the pause menu; the server waits too)
    this.last = 0;
    this.running = false;
    this.alpha = 0;
    this.maxFrameDt = MAX_FRAME_DT; // tools may relax this for slow headless renderers
    this.maxSteps = 5;
    this.rawDt = 0;
    this._tick = (t) => this.tick(t);
  }
  // Instance time (hitstop + slow-mo), applied by the client the same way the local server does.
  addHitstop(s) { this.hitstop = Math.max(this.hitstop, s); }
  slowmo(scale, dur) { this.slowScale = scale; this.slowT = Math.max(this.slowT, dur); this.timeScale = scale; }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._tick);
  }
  tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);
    let realDt = (now - this.last) / 1000;
    this.last = now;
    this.rawDt = realDt;
    if (realDt > this.maxFrameDt) realDt = this.maxFrameDt;
    if (realDt < 0) realDt = 0;
    if (this.slowT > 0) { this.slowT = Math.max(0, this.slowT - realDt); this.timeScale = this.slowT > 0 ? this.slowScale : 1; }
    let simDt = this.paused ? 0 : realDt * this.timeScale;
    if (this.hitstop > 0 && !this.paused) {
      const h = Math.min(this.hitstop, realDt);
      this.hitstop -= h;
      simDt = Math.max(0, simDt - h * this.timeScale);
    }
    this.acc += simDt;
    let steps = 0;
    while (this.acc >= DT && steps < this.maxSteps) {
      this.acc -= DT;
      this.fixed(DT);
      steps++;
    }
    if (steps >= this.maxSteps) this.acc = 0;
    this.alpha = this.acc / DT;
    this.frame(realDt, simDt, this.alpha);
  }
}
