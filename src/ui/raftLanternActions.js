import { LANTERN_REACH, isLanternLit, lanternDistance } from '../sim/naval/lantern.js';

const RETRY_MS = 1000;
const TIMEOUT_MS = 5000;

const COPY = {
  es: {
    light: 'Encender farol', darken: 'Apagar farol', lighting: 'Encendiendo…', darkening: 'Apagando…',
    lit: 'Farol encendido.', dark: 'Farol apagado.', delayed: 'La conexión tarda. El farol sigue bajo control del servidor.',
    busy: 'Termina tu acción antes de usar el farol.', far: 'Acércate al farol.', condition: 'El farol ya no está en condiciones de usarse.',
    revision: 'La balsa cambió. Vuelve a intentarlo.', command: 'No se pudo validar la solicitud del farol.',
    saveSize: 'La partida supera el límite de guardado.', duplicate: 'La solicitud ya corresponde a otra acción.',
  },
  en: {
    light: 'Light lantern', darken: 'Extinguish lantern', lighting: 'Lighting…', darkening: 'Extinguishing…',
    lit: 'Lantern lit.', dark: 'Lantern extinguished.', delayed: 'The connection is taking longer. The server still controls the lantern.',
    busy: 'Finish your current action before using the lantern.', far: 'Move closer to the lantern.', condition: 'The lantern is no longer in usable condition.',
    revision: 'The raft changed. Try again.', command: 'The lantern request could not be validated.',
    saveSize: 'The save exceeds its size limit.', duplicate: 'This request already belongs to another action.',
  },
};
const REASONS = ['busy', 'far', 'condition', 'revision', 'command', 'saveSize', 'duplicate'];

export class RaftLanternActions {
  constructor({ client, locale = () => 'es', toast = () => {}, now = () => performance.now() }) {
    Object.assign(this, { client, locale, toast, now });
    this.pending = null;
    this.owner = null;
    this.entity = 0;
  }

  get copy() { return COPY[this.locale()] || COPY.es; }

  reset() { this.pending = null; this.owner = null; this.entity = 0; }
  dispose() { this.reset(); }

  update() {
    const c = this.client();
    if (c !== this.owner || !c?.joined || !c.youServer || c.youServer !== this.entity) {
      this.reset();
      if (c?.joined && c.youServer) { this.owner = c; this.entity = c.youServer; }
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    const record = c.pred?.rafts?.find((raft) => raft.id === pending.command.id);
    const part = record?.partHealth?.find((row) => row.id === pending.command.partId && Number.isFinite(row.hp) && row.hp > 0 &&
      Array.isArray(row.part) && row.part[0] === 'lantern' && JSON.stringify(row.part) === pending.partKey);
    if (!record || !part) { this.pending = null; return; }
    const elapsed = this.now() - pending.sentAt;
    if (elapsed >= TIMEOUT_MS) { this.pending = null; this.toast(this.copy.delayed); return; }
    if (!pending.retried && elapsed >= RETRY_MS) {
      pending.retried = true;
      try { c.send(pending.command); } catch { /* Retain the exact intent until its bounded timeout. */ }
    }
  }

  interaction() {
    this.update();
    const c = this.client();
    if (!c?.joined || !c.youServer || (c.naval?.active && !c.deck?.active)) return null;
    if (this.owner !== c || this.entity !== c.youServer) return null;
    const position = c.cur;
    if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;

    if (this.pending) {
      const lighting = this.pending.command.lit;
      const progress = lighting ? this.copy.lighting : this.copy.darkening;
      return { key: 'V', prompt: progress, verb: progress, icon: 'lantern', lantern: true, distance: -Infinity, run() {} };
    }

    let nearest = null, distance = Infinity;
    for (const record of c.pred?.rafts || []) {
      if (!record || !Array.isArray(record.partHealth)) continue;
      for (const part of record.partHealth) {
        if (!part || !Number.isFinite(part.hp) || part.hp <= 0 || !Array.isArray(part.part) || part.part[0] !== 'lantern' || typeof part.id !== 'string') continue;
        const d = lanternDistance(record, part.part, position);
        if (d <= LANTERN_REACH && (!nearest || d < distance)) { nearest = { record, part }; distance = d; }
      }
    }
    if (!nearest) return null;
    const { record, part } = nearest;
    const lit = isLanternLit(record.litLanterns, part.part);
    const prompt = lit ? this.copy.darken : this.copy.light;
    return { key: 'V', prompt, verb: prompt, icon: 'lantern', lantern: true, distance,
      run: () => this.send(record, part, lit) };
  }

  send(record, part, expectedLit) {
    if (this.pending) return false;
    const c = this.client();
    if (!c?.joined || !c.youServer || c !== this.owner || c.youServer !== this.entity) return false;
    const command = Object.freeze({ t: 'cmd', type: 'raftLantern', id: record.id, partId: part.id,
      expectedRev: record.rev, expectedLit, lit: !expectedLit, opId: globalThis.crypto.randomUUID() });
    const pending = { command, partKey: JSON.stringify(part.part), sentAt: this.now(), retried: false };
    this.pending = pending;
    try { c.send(command); } catch { this.pending = null; return false; }
    return true;
  }

  acknowledge(ev) {
    this.update();
    const pending = this.pending;
    if (!ev || ev.type !== 'raftLantern' || !pending || ev.opId !== pending.command.opId) return false;
    this.pending = null;
    if (ev.ok === true) this.toast(pending.command.lit ? this.copy.lit : this.copy.dark);
    else if (REASONS.includes(ev.why)) this.toast(this.copy[ev.why]);
    return true;
  }
}
