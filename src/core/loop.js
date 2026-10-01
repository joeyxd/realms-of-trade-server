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
    this.last = 0;
    this.running = false;
    this.alpha = 0;
    this.maxFrameDt = MAX_FRAME_DT; // tools may relax this for slow headless renderers
    this.maxSteps = 5;
    this.rawDt = 0;
    this._tick = (t) => this.tick(t);
  }
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
    let simDt = realDt * this.timeScale;
    if (this.hitstop > 0) {
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
