import { navalHudState } from './hud-state.js';
import { windEfficiency } from '../../src/sim/naval/handling.js';
import { NAVAL_NAVIGATION } from '../../src/data/navalNavigation.js';

/** Display-only adapter. Reuse fixed DOM/SVG nodes and write only changed attributes. */
export class NavalLabHud {
  constructor(root) {
    this.nodes = new Map();
    for (const id of ['speed', 'speed-dial', 'speed-arc', 'boost-arc', 'dial-state', 'heading', 'hud-load',
      'nav-chart', 'chart-heading', 'chart-wind', 'chart-current', 'sail', 'flow-label', 'gust-label',
      'gust-progress', 'gust-marker', 'capture', 'capture-status', 'jettison-hud', 'cargo-card-key',
      'nav-callout', 'callout-title', 'callout-detail']) this.nodes.set(id, root.getElementById(id));
    this.windowBand = root.querySelector('.gust-window');
    this.perfectBand = root.querySelector('.gust-perfect');
    this.last = null;
  }
  text(id, value) {
    const node = this.nodes.get(id);
    if (node.textContent !== value) node.textContent = value;
  }
  attribute(id, key, value) {
    const node = this.nodes.get(id), next = String(value);
    if (node.getAttribute(key) !== next) node.setAttribute(key, next);
  }
  update(context) {
    const h = navalHudState(context);
    const node = (id) => this.nodes.get(id);
    this.text('speed', h.speedText);
    this.attribute('speed-arc', 'stroke-dasharray', `${(h.speedFraction * 100).toFixed(1)} 100`);
    this.attribute('boost-arc', 'stroke-dasharray', `${(h.boostFraction * 100).toFixed(1)} 100`);
    this.attribute('speed-dial', 'aria-valuenow', h.speedText);
    this.attribute('speed-dial', 'aria-valuemax', Math.max(NAVAL_NAVIGATION.boostMaxSpeed, h.speed));
    this.attribute('speed-dial', 'aria-valuetext', `${h.speedText} unidades por segundo${h.boostActive ? `, boost ${h.boostSeconds.toFixed(1)} segundos` : ''}`);
    node('speed-dial').classList.toggle('boosting', h.boostActive);
    this.text('dial-state', h.boostActive ? 'VELA CARGADA' : 'VELOCIDAD');
    this.text('heading', `RUMBO ${h.headingText}°`);
    this.attribute('chart-heading', 'transform', `rotate(${h.headingDegrees.toFixed(1)} 50 50)`);
    for (const [id, angle] of [['chart-wind', h.windDegrees], ['chart-current', h.currentDegrees]]) {
      this.attribute(id, 'visibility', angle === null ? 'hidden' : 'visible');
      if (angle !== null) this.attribute(id, 'transform', `rotate(${angle.toFixed(1)} 50 50)`);
    }
    this.attribute('nav-chart', 'aria-label', `Rumbo ${h.headingText} grados. ${h.windDegrees === null ? 'Calma' : `Viento hacia ${Math.round(h.windDegrees) % 360} grados`}. ${h.currentDegrees === null ? 'Sin corriente activa' : `Corriente hacia ${Math.round(h.currentDegrees) % 360} grados`}.`);
    this.text('sail', context.wind.strength ? `Empuje de vela ${(windEfficiency(context.state.yaw, context.wind) * 100).toFixed(0)}%` : 'Calma · remo asistido');
    this.text('flow-label', h.flowText);
    this.text('hud-load', `Lastre ${h.cargoMass ?? '—'} · carga del casco ${h.loadPercent ?? '—'}%`);
    this.text('gust-label', h.gustText);
    this.attribute('gust-progress', 'aria-valuenow', Math.round(h.gustProgress * 100));
    this.attribute('gust-progress', 'aria-valuetext', h.gustText);
    const left = `${(h.gustProgress * 100).toFixed(2)}%`;
    if (node('gust-marker').style.left !== left) node('gust-marker').style.left = left;
    if (!this.last) {
      this.windowBand.style.left = `${h.gustMarks.windowStart * 100}%`;
      this.perfectBand.style.left = `${h.gustMarks.perfectStart * 100}%`;
      this.perfectBand.style.width = `${(h.gustMarks.perfectEnd - h.gustMarks.perfectStart) * 100}%`;
    }
    node('capture').disabled = h.captureDisabled;
    node('capture').classList.toggle('ready', h.captureReady);
    node('capture').classList.toggle('boosting', h.boostActive);
    node('jettison-hud').disabled = !h.cargoCount;
    this.text('cargo-card-key', h.cargoCount ? `J · ${h.cargoCount} ${h.cargoCount === 1 ? 'BULTO' : 'BULTOS'}` : 'SIN LASTRE');
    this.text('capture-status', h.resultText || 'Caza en verde · perfecto en oro');
    node('nav-callout').hidden = !h.calloutText;
    this.attribute('nav-callout', 'data-tone', h.calloutTone);
    this.text('callout-title', h.calloutText);
    this.text('callout-detail', h.calloutDetail);
    this.last = h;
  }
  diagnostics() { return this.last ? { ...this.last } : null; }
}
