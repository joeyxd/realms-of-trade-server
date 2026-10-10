import { DOOR_REACH, doorDistance, isDoorOpen } from '../sim/naval/shelter.js';

const RETRY_MS = 1000;
const TIMEOUT_MS = 5000;

const COPY = {
  es: {
    open: 'Abrir puerta', close: 'Cerrar puerta', opening: 'Abriendo…', closing: 'Cerrando…',
    opened: 'Puerta abierta.', closed: 'Puerta cerrada.', delayed: 'La conexión tarda. La puerta sigue bajo control del servidor.',
    busy: 'Termina tu acción antes de usar la puerta.', far: 'Acércate a la puerta.', occupied: 'La puerta está bloqueada.',
    revision: 'La balsa cambió. Vuelve a intentarlo.', condition: 'La puerta ya no está en condiciones de usarse.',
    command: 'No se pudo validar la solicitud de la puerta.', saveSize: 'La partida supera el límite de guardado.',
    duplicate: 'La solicitud ya corresponde a otra acción.',
  },
  en: {
    open: 'Open door', close: 'Close door', opening: 'Opening…', closing: 'Closing…',
    opened: 'Door opened.', closed: 'Door closed.', delayed: 'The connection is taking longer. The server still controls the door.',
    busy: 'Finish your current action before using the door.', far: 'Move closer to the door.', occupied: 'The doorway is blocked.',
    revision: 'The raft changed. Try again.', condition: 'The door is no longer in usable condition.',
    command: 'The door request could not be validated.', saveSize: 'The save exceeds its size limit.',
    duplicate: 'This request already belongs to another action.',
  },
};

const REASONS = ['busy', 'far', 'occupied', 'revision', 'condition', 'command', 'saveSize', 'duplicate'];

export class RaftDoorActions {
  constructor({ client, locale = () => 'es', toast = () => {}, now = () => performance.now() }) {
    Object.assign(this, { client, locale, toast, now });
    this.pending = null;
    this.owner = null;
    this.entity = 0;
  }

  get copy() { return COPY[this.locale()] || COPY.es; }

  reset() {
    this.pending = null;
    this.owner = null;
    this.entity = 0;
  }

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
    const part = record?.partHealth?.find((row) => row.id === pending.command.partId && Number.isFinite(row.hp) && row.hp > 0);
    if (!record || !part || !Array.isArray(part.part) || part.part[0] !== 'door') {
      this.pending = null;
      return;
    }
    const elapsed = this.now() - pending.sentAt;
    if (elapsed >= TIMEOUT_MS) {
      this.pending = null;
      this.toast(this.copy.delayed);
      return;
    }
    if (!pending.retried && elapsed >= RETRY_MS) {
      pending.retried = true;
      try { c.send(pending.command); } catch { /* Keep the exact intent pending until its bounded timeout. */ }
    }
  }

  interaction() {
    this.update();
    const c = this.client();
    if (!c?.joined || !c.youServer || c.naval?.active && !c.deck?.active) return null;
    if (this.owner !== c || this.entity !== c.youServer) return null;
    const position = c.cur;
    if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;

    if (this.pending) {
      const opening = this.pending.command.open;
      const progress = opening ? this.copy.opening : this.copy.closing;
      return { key: 'F', prompt: progress, verb: progress, icon: 'door', run() {} };
    }

    let nearest = null, distance = Infinity;
    for (const record of c.pred?.rafts || []) {
      if (!record || !Array.isArray(record.partHealth)) continue;
      for (const part of record.partHealth) {
        if (!part || !Number.isFinite(part.hp) || part.hp <= 0 || !Array.isArray(part.part) || part.part[0] !== 'door' || typeof part.id !== 'string') continue;
        const d = doorDistance(record, part.part, position);
        if (d <= DOOR_REACH && (!nearest || d < distance)) { nearest = { record, part }; distance = d; }
      }
    }
    if (!nearest) return null;
    const { record, part } = nearest;
    const open = isDoorOpen(record.openDoors, part.part);
    const prompt = open ? this.copy.close : this.copy.open;
    return { key: 'F', prompt, verb: prompt, icon: 'door', run: () => this.send(record, part, open) };
  }

  send(record, part, expectedOpen) {
    if (this.pending) return false;
    const c = this.client();
    if (!c?.joined || !c.youServer || c !== this.owner || c.youServer !== this.entity) return false;
    const command = Object.freeze({ t: 'cmd', type: 'raftDoor', id: record.id, partId: part.id,
      expectedRev: record.rev, expectedOpen, open: !expectedOpen, opId: globalThis.crypto.randomUUID() });
    const pending = { command, sentAt: this.now(), retried: false };
    this.pending = pending;
    try { c.send(command); } catch { this.pending = null; return false; }
    return true;
  }

  acknowledge(ev) {
    this.update();
    const pending = this.pending;
    if (!ev || ev.type !== 'raftDoor' || !pending || ev.opId !== pending.command.opId) return false;
    this.pending = null;
    if (ev.ok === true) this.toast(pending.command.open ? this.copy.opened : this.copy.closed);
    else if (REASONS.includes(ev.why)) this.toast(this.copy[ev.why]);
    return true;
  }
}
