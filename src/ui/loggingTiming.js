// Small, lazily mounted timing aid for the authoritative palm challenge.
import { DT } from '../data/tuning.js';

export class LoggingTimingPanel {
  constructor({ doc = globalThis.document, onHit = () => {}, locale = () => 'es', now = () => performance.now() } = {}) {
    if (!doc?.createElement || !doc.body) throw new TypeError('Logging timing panel needs a document body');
    Object.assign(this, { doc, onHit, locale, now });
    this.root = null; this.challenge = null; this.receivedAt = 0; this.frame = 0;
  }

  ensure() {
    if (this.root) return;
    const root = this.doc.createElement('section');
    root.className = 'logging-timing'; root.hidden = true; root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite'); root.setAttribute('aria-label', 'Tala a tiempo');
    root.innerHTML = '<div class="logging-timing__head"><b data-title></b><span data-countdown></span></div>'
      + '<div class="logging-timing__track" role="meter" aria-label="Ventana de golpe" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">'
      + '<i data-perfect></i><i data-target></i><b data-marker></b></div>'
      + '<div class="logging-timing__foot"><small data-hint></small><button type="button" data-hit></button></div>';
    root.querySelector('[data-hit]').addEventListener('click', () => this.onHit());
    this.doc.body.append(root); this.root = root;
  }

  show(challenge, elapsedTicks = 0) {
    this.ensure();
    this.challenge = challenge; this.receivedAt = this.now() - Math.max(0, elapsedTicks) * DT * 1000; this.root.hidden = false;
    const english = String(this.locale()).toLowerCase().startsWith('en');
    this.root.setAttribute('aria-label', english ? 'Logging timing challenge' : 'Desafío de ritmo de tala');
    this.root.querySelector('.logging-timing__track').setAttribute('aria-label', english ? 'Strike timing window' : 'Ventana de golpe');
    this.root.querySelector('[data-title]').textContent = english ? 'Logging rhythm' : 'Ritmo de tala';
    this.root.querySelector('[data-hint]').textContent = english
      ? 'Press F or tap at the marker. The server confirms the hit.'
      : 'Pulsa F o toca al llegar la marca. El servidor confirma el golpe.';
    this.root.querySelector('[data-hit]').textContent = english ? 'Strike' : 'Golpear';
    this.root.querySelector('[data-hit]').setAttribute('aria-label', english ? 'Strike now' : 'Golpear ahora');
    const targetPercent = (challenge.targetTick - challenge.startTick) / (challenge.endTick - challenge.startTick) * 100;
    const perfectWidth = challenge.width / (challenge.endTick - challenge.startTick) * 100;
    const perfect = this.root.querySelector('[data-perfect]');
    perfect.style.left = `${targetPercent - perfectWidth}%`;
    perfect.style.width = `${perfectWidth * 2}%`;
    this.root.querySelector('[data-target]').style.left = `${targetPercent}%`;
    this.tick();
  }

  tick() {
    if (!this.challenge || !this.root || this.root.hidden) return;
    const elapsedTicks = Math.max(0, (this.now() - this.receivedAt) / (DT * 1000));
    const span = this.challenge.endTick - this.challenge.startTick;
    const progress = Math.max(0, Math.min(100, elapsedTicks / span * 100));
    const marker = this.root.querySelector('[data-marker]');
    marker.style.left = `${progress}%`;
    const track = this.root.querySelector('.logging-timing__track');
    track.setAttribute('aria-valuenow', String(Math.round(progress)));
    const remaining = Math.max(0, (span - elapsedTicks) * DT);
    this.root.querySelector('[data-countdown]').textContent = `${remaining.toFixed(1)} s`;
    this.root.dataset.window = Math.abs(elapsedTicks - (this.challenge.targetTick - this.challenge.startTick)) <= this.challenge.width
      ? 'perfect' : 'approach';
    this.frame = this.doc.defaultView?.requestAnimationFrame?.(() => this.tick()) || 0;
  }

  close() {
    if (this.frame) this.doc.defaultView?.cancelAnimationFrame?.(this.frame);
    this.frame = 0; this.challenge = null;
    if (this.root) this.root.hidden = true;
  }

  destroy() {
    this.close(); this.root?.remove(); this.root = null;
  }
}

