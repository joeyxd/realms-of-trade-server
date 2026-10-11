import { ATTR, attrPoints, readAttrField } from '../data/attributes.js';
import { carryLimits, readCarryField } from '../data/carry.js';
import { GOODS } from '../data/goods.js';
import { readVessels } from '../data/freshwater.js';
import { holdMass, holdUsed } from '../sim/economy/cargo.js';

const MESSAGES = {
  es: {
    title: 'Carga', points: 'Puntos ganados', available: 'Disponibles', invested: 'Invertidos',
    comfortable: 'Carga cómoda', maximum: 'Límite máximo', current: 'Carga actual', volume: 'volumen', weight: 'peso (uM)',
    adopt: 'Adoptar Carga',
    adoptHelp: 'Al adoptar, tu carga cómoda será 40 uM y el límite máximo 50 uM. Conservas todos los objetos. Una mochila antigua con capacidad 10 pasa a capacidad 18.',
    adoptPreview: 'Al adoptar: 40 uM cómodos / 50 uM máximo.',
    preview: 'Con un punto: +4 de carga cómoda y +5 de límite máximo.',
    assign: 'Asignar 1 punto', reset: 'Reasignar gratis', confirm: 'Confirmar reasignación',
    resetConfirm: 'La reasignación devuelve los puntos invertidos y consume tu única reasignación gratuita.',
    cancel: 'Cancelar', retry: 'Reintentar', locked: 'Las acciones están deshabilitadas.',
    pending: 'Esperando confirmación del servidor…', waiting: 'Si tarda más de 5 segundos, puedes reintentar la misma operación.',
    synced: 'Perfil sincronizado.', sessionOnly: 'Cambio aplicado en esta sesión del servidor; no se conserva al reiniciarlo.',
    noPoints: 'No hay puntos disponibles.',
    resetEmpty: 'No hay puntos invertidos para reasignar.', resetUsed: 'Ya se usó la reasignación gratuita.',
    resetHeavy: 'La reasignación requiere que el peso actual no supere 50 uM.',
    adoptHeavy: 'No puedes adoptar mientras el peso actual supere 50 uM.',
    invalid: 'Los datos de perfil o carga no son válidos.', maxLabel: 'máx.',
    denial: {
      points: 'No hay puntos disponibles.', empty: 'No hay puntos invertidos.', used: 'Ya se usó la reasignación gratuita.',
      conflict: 'El perfil cambió; vuelve a sincronizar.', disabled: 'Las acciones están deshabilitadas.',
      profile: 'Perfil inválido.', carry: 'Datos de carga inválidos.', busy: 'Hay otra operación pendiente.',
      command: 'Operación inválida.', limit: 'Se alcanzó el límite de revisión.', adopted: 'La carga ya está adoptada.',
      authority: 'La operación fue rechazada.', forbidden: 'No tienes permiso para esta operación.',
      storage: 'No se pudo confirmar el guardado.', heavy: 'El peso supera el límite permitido.'
    }
  },
  en: {
    title: 'Carry', points: 'Points earned', available: 'Available', invested: 'Invested',
    comfortable: 'Comfortable load', maximum: 'Maximum limit', current: 'Current carry', volume: 'volume', weight: 'weight (uM)',
    adopt: 'Adopt Carry',
    adoptHelp: 'After adoption, comfortable load is 40 uM and the maximum limit is 50 uM. You keep every item. An older backpack with capacity 10 becomes capacity 18.',
    adoptPreview: 'After adoption: 40 uM comfortable / 50 uM maximum.',
    preview: 'With one point: +4 comfortable load and +5 maximum limit.',
    assign: 'Assign 1 point', reset: 'Free reallocation', confirm: 'Confirm reallocation',
    resetConfirm: 'Reallocation returns your invested points and uses your one free reallocation.',
    cancel: 'Cancel', retry: 'Retry', locked: 'Actions are disabled.',
    pending: 'Waiting for server confirmation…', waiting: 'If it takes more than 5 seconds, you can retry the same operation.',
    synced: 'Profile synchronized.', sessionOnly: 'Change applied for this server session; it does not survive a restart.',
    noPoints: 'No points are available.',
    resetEmpty: 'There are no invested points to reallocate.', resetUsed: 'The free reallocation was already used.',
    resetHeavy: 'Reallocation requires current weight at or below 50 uM.',
    adoptHeavy: 'You cannot adopt while current weight exceeds 50 uM.',
    invalid: 'Profile or carry data is invalid.', maxLabel: 'max.',
    denial: {
      points: 'No points are available.', empty: 'There are no invested points.', used: 'The free reallocation was already used.',
      conflict: 'The profile changed; synchronize again.', disabled: 'Actions are disabled.', profile: 'Invalid profile.',
      carry: 'Invalid carry data.', busy: 'Another operation is pending.', command: 'Invalid operation.',
      limit: 'Revision limit reached.', adopted: 'Carry is already adopted.', authority: 'The operation was rejected.',
      forbidden: 'You are not allowed to perform this operation.', storage: 'The save could not be confirmed.',
      heavy: 'Weight exceeds the allowed limit.'
    }
  }
};

const esc = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function ownData(object, key) {
  try {
    const descriptor = object && Object.getOwnPropertyDescriptor(object, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
      ? { present: true, value: descriptor.value }
      : { present: !!descriptor, value: undefined };
  } catch {
    return { present: true, value: undefined };
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

const same = (left, right) => stable(left) === stable(right);
const plain = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
};
function hasExactFields(value, required, optional = []) {
  if (!plain(value)) return false;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key))) return false;
    if (required.some(key => !keys.includes(key))) return false;
    return keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    });
  } catch {
    return false;
  }
}

export class AttributeControls {
  constructor({ profile, enabled, submit, onChange, now = () => performance.now(), id = () => crypto.randomUUID() }) {
    Object.assign(this, { profile, enabled, submit, onChange, now, id });
    this.pending = null;
    this.statusKey = 'synced';
    this.statusWhy = '';
    this.confirming = false;
    this.lastRenderSignature = '';
  }

  _enabled() {
    try {
      return (typeof this.enabled === 'function' ? this.enabled() : this.enabled) === true;
    } catch {
      return false;
    }
  }

  _view() {
    try {
      return this._readView();
    } catch {
      return { valid: false };
    }
  }

  _readView() {
    const profile = typeof this.profile === 'function' ? this.profile() : this.profile;
    if (!profile || typeof profile !== 'object') return { valid: false };

    const level = ownData(profile, 'lvl').value;
    const attrField = readAttrField(profile);
    const carryField = readCarryField(profile);
    const eco = ownData(profile, 'eco').value;
    const pack = ownData(eco, 'pack').value;
    const revision = ownData(eco, 'tradeRev').value;
    if (!Number.isSafeInteger(level) || level < 1 || level > 10 ||
        (attrField.present && !attrField.value) || (carryField.present && !carryField.value) ||
        !Number.isSafeInteger(revision) || revision < 0 || !plain(pack)) return { valid: false };

    const adopted = attrField.present;
    const carryless = !carryField.present;
    const carry = carryField.value;
    const attr = attrField.value || { v: ATTR.version, carga: 0, re: 0 };
    if (adopted && attr.carga > level - 1) return { valid: false };

    let volume;
    let currentMax = null;
    let targetVolume;
    if (carryless) {
      if (adopted || ownData(pack, 'cap').value !== 10 || !ownData(pack, 'goods').present ||
          ownData(pack, 'maxMass').present || !hasExactFields(pack, ['cap', 'goods'], ['vessels'])) return { valid: false };
      volume = 10;
      targetVolume = 18;
    } else {
      const carryLimit = carryLimits(carry, level);
      if (!carryLimit) return { valid: false };
      volume = carryLimit.volume;
      targetVolume = volume;
      currentMax = adopted ? 50 + 5 * attr.carga : carryLimit.maxMass;
      const expectedMax = currentMax;
      if (ownData(pack, 'cap').value !== volume || ownData(pack, 'maxMass').value !== expectedMax ||
          !hasExactFields(pack, ['cap', 'goods', 'maxMass'], ['vessels'])) {
        return { valid: false };
      }
    }

    try {
      const goods = ownData(pack, 'goods').value;
      if (!plain(goods)) return { valid: false };
      for (const key of Reflect.ownKeys(goods)) {
        const descriptor = ownData(goods, key);
        if (typeof key !== 'string' || !GOODS[key] || !descriptor.present ||
            !Number.isSafeInteger(descriptor.value) || descriptor.value <= 0) return { valid: false };
      }

      const vesselField = ownData(pack, 'vessels');
      if (vesselField.present && !Array.isArray(vesselField.value)) return { valid: false };
      const vessels = readVessels(vesselField.value);
      if (vessels.some(vessel => vessel.kind !== 'bucket')) return { valid: false };

      const used = holdUsed(pack);
      const mass = holdMass(pack);
      if (!Number.isFinite(used) || used < 0 || used > volume || !Number.isFinite(mass) || mass < 0) {
        return { valid: false };
      }
      const points = attrPoints({ lvl: level, attr }, level);
      return {
        valid: true, profile, level, revision, adopted, carryless, carry, attr, points, pack,
        volume, currentMax, targetVolume, targetMax: 50, used, mass, vessels
      };
    } catch {
      return { valid: false };
    }
  }

  _resetWhy(view) {
    if (!view.adopted) return 'adopted';
    if (view.attr.carga <= 0) return 'empty';
    if (view.attr.re !== 0) return 'used';
    if (view.mass > 50) return 'heavy';
    return '';
  }

  _adoptWhy(view) {
    return view.mass > 50 ? 'heavy' : '';
  }

  _assignWhy(view) {
    if (view.points.available < 1) return 'points';
    return view.mass > 55 + 5 * view.attr.carga ? 'heavy' : '';
  }

  html(locale = 'es') {
    const messages = MESSAGES[locale === 'en' ? 'en' : 'es'];
    const view = this._view();
    const enabled = this._enabled();
    if (!view.valid) {
      return `<section class="attribute-controls" aria-live="polite"><h3>${messages.title}</h3><p>${messages.invalid}</p></section>`;
    }

    const busy = !!this.pending;
    const canEdit = enabled && !busy;
    const status = this.statusKey === 'denial'
      ? messages.denial[this.statusWhy] || messages.denial.authority
      : messages[this.statusKey] || messages.synced;
    const limits = view.adopted
      ? `<div><dt>${messages.comfortable}</dt><dd>${40 + 4 * view.attr.carga} uM</dd></div><div><dt>${messages.maximum}</dt><dd>${50 + 5 * view.attr.carga} uM</dd></div>`
      : `<div class="attribute-controls__preview-limit"><dt>${messages.comfortable} / ${messages.maximum}</dt><dd>${messages.adoptPreview}</dd></div>`;
    const actualMaximum = view.currentMax === null ? '—' : `${view.currentMax} uM`;

    let actions;
    if (!view.adopted) {
      const why = this._adoptWhy(view);
      actions = `<p>${messages.adoptHelp}</p>${why ? `<p class="attribute-controls__reason">${messages.adoptHeavy}</p>` : ''}<button type="button" data-attribute-op="adopt" ${canEdit && !why ? '' : 'disabled'}>${messages.adopt}</button>`;
    } else {
      const resetWhy = this._resetWhy(view);
      const assignWhy = this._assignWhy(view);
      actions = `<div class="attribute-controls__actions"><button type="button" data-attribute-op="assign" ${canEdit && !assignWhy ? '' : 'disabled'}>${messages.assign}</button><button type="button" data-attribute-op="reset" ${canEdit && !resetWhy ? '' : 'disabled'}>${messages.reset}</button></div>`;
      actions += assignWhy
        ? `<p class="attribute-controls__reason">${assignWhy === 'heavy' ? messages.denial.heavy : messages.noPoints}</p>`
        : `<p>${messages.preview}</p>`;
      if (resetWhy) {
        const reasonKey = `reset${resetWhy[0].toUpperCase()}${resetWhy.slice(1)}`;
        actions += `<p class="attribute-controls__reason">${messages[reasonKey] || messages.resetUsed}</p>`;
      }
      if (this.confirming) {
        actions += `<div class="attribute-controls__confirm"><p>${messages.resetConfirm}</p><button type="button" data-attribute-op="confirmReset" ${canEdit ? '' : 'disabled'}>${messages.confirm}</button><button type="button" data-attribute-op="cancelReset">${messages.cancel}</button></div>`;
      }
    }

    const retryReady = busy && enabled && this.now() - this.pending.sentAt >= 5000;
    const actual = `${view.mass} ${messages.weight} / ${view.used} ${messages.volume} (${messages.maxLabel} ${actualMaximum} / ${view.volume} uV)`;
    return `<section class="attribute-controls" aria-live="polite"><h3>${messages.title}</h3><dl><div><dt>${messages.points}</dt><dd>${view.points.earned}</dd></div><div><dt>${messages.available}</dt><dd>${view.points.available}</dd></div><div><dt>${messages.invested}</dt><dd>${view.points.invested}</dd></div>${limits}<div><dt>${messages.current}</dt><dd>${actual}</dd></div></dl>${actions}${!enabled ? `<p>${messages.locked}</p>` : ''}<p class="attribute-controls__status" role="status">${esc(status)}${busy ? ` ${messages.waiting}` : ''}</p>${retryReady ? `<button type="button" data-attribute-op="retry">${messages.retry}</button>` : ''}</section>`;
  }

  act(operation, amount = 1) {
    if (operation === 'cancelReset') {
      this.confirming = false;
      this.update();
      return true;
    }
    if (operation === 'reset') {
      const view = this._view();
      if (!this._enabled() || this.pending || !view.valid || this._resetWhy(view)) return false;
      this.confirming = true;
      this.update();
      return true;
    }
    if (operation === 'confirmReset') {
      if (!this.confirming) return false;
      const view = this._view();
      if (!this._enabled()) {
        this.confirming = false;
        this.statusKey = 'denial';
        this.statusWhy = 'disabled';
        this.update();
        return false;
      }
      if (!view.valid || this._resetWhy(view)) {
        this.confirming = false;
        this.statusKey = 'denial';
        this.statusWhy = view.valid ? this._resetWhy(view) : 'profile';
        this.update();
        return false;
      }
      this.confirming = false;
      return this._send('reset');
    }
    if (operation === 'retry') return this.retry();
    if (operation !== 'adopt' && operation !== 'assign') return false;
    return this._send(operation, amount);
  }

  _send(operation, amount = 1) {
    if (this.pending) {
      this.statusKey = 'pending';
      this.statusWhy = '';
      this.update();
      return false;
    }
    const view = this._view();
    if (!this._enabled()) {
      this.statusKey = 'denial';
      this.statusWhy = 'disabled';
      this.update();
      return false;
    }
    if (!view.valid) {
      this.statusKey = 'denial';
      this.statusWhy = 'profile';
      this.update();
      return false;
    }
    if (operation === 'adopt' && (view.adopted || this._adoptWhy(view))) {
      this.statusKey = 'denial';
      this.statusWhy = view.adopted ? 'adopted' : 'heavy';
      this.update();
      return false;
    }
    if (operation === 'assign' && (!view.adopted || amount !== 1 || this._assignWhy(view))) {
      this.statusKey = 'denial';
      this.statusWhy = !view.adopted ? 'adopted' : this._assignWhy(view) || 'points';
      this.update();
      return false;
    }
    if (operation === 'reset' && this._resetWhy(view)) {
      this.statusKey = 'denial';
      this.statusWhy = this._resetWhy(view);
      this.update();
      return false;
    }

    const commandId = this.id();
    const command = Object.freeze(operation === 'assign'
      ? { type: 'attributes', op: 'assign', opId: commandId, expectedRev: view.revision, stat: 'carga', n: 1 }
      : { type: 'attributes', op: operation, opId: commandId, expectedRev: view.revision });
    const base = {
      revision: view.revision,
      adopted: view.adopted,
      carryless: view.carryless,
      carry: structuredClone(view.carry),
      attr: structuredClone(view.attr),
      points: structuredClone(view.points),
      targetVolume: view.targetVolume,
      pack: {
        cap: view.pack.cap,
        goods: structuredClone(view.pack.goods),
        vessels: structuredClone(view.vessels)
      }
    };
    this.pending = { command, sentAt: this.now(), base, ack: null };
    this.statusKey = 'pending';
    this.statusWhy = '';
    try {
      this.submit(command);
    } catch {
      // The send outcome is unknown; preserve the immutable command.
    }
    this.update();
    return true;
  }

  retry() {
    if (!this.pending || !this._enabled() || this.now() - this.pending.sentAt < 5000) return false;
    try {
      this.submit(this.pending.command);
    } catch {
      // The send outcome is unknown; preserve the immutable command.
    }
    this.pending.sentAt = this.now();
    this.statusKey = 'pending';
    this.statusWhy = '';
    this.update();
    return true;
  }

  onResult(event) {
    const pending = this.pending;
    if (!pending || !event || typeof event !== 'object' || Array.isArray(event)) return false;

    let result;
    try {
      const prototype = Object.getPrototypeOf(event);
      const keys = Reflect.ownKeys(event);
      if ((prototype !== Object.prototype && prototype !== null) || keys.some(key => typeof key !== 'string')) return false;
      result = {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(event, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
        result[key] = descriptor.value;
      }
    } catch {
      return false;
    }

    if (result.type !== 'attributes' || result.op !== pending.command.op || result.opId !== pending.command.opId ||
        typeof result.ok !== 'boolean' || !Number.isSafeInteger(result.rev) || result.rev < 0) return false;
    const core = ['type', 'op', 'opId', 'ok', 'why', 'rev', ...(result.ok ? ['points', 'limits'] : [])];
    const metadata = ['to', 'durable', 'replay', 'historical'];
    if (Object.keys(result).some(key => !core.includes(key) && !metadata.includes(key)) ||
        core.slice(0, 6).some(key => !Object.hasOwn(result, key)) ||
        Object.keys(result).some(key => metadata.includes(key) &&
          !(key === 'to' ? Number.isSafeInteger(result[key]) : typeof result[key] === 'boolean'))) return false;

    if (result.ok) {
      const base = pending.base;
      const old = base.attr;
      const carga = pending.command.op === 'assign' ? old.carga + 1 : 0;
      const resets = pending.command.op === 'reset' ? 1 : old.re;
      const expectedPoints = {
        earned: base.points.earned,
        invested: carga,
        available: base.points.earned - carga,
        resetsLeft: 1 - resets
      };
      const expectedLimits = {
        volume: base.targetVolume,
        comfortableMass: 40 + 4 * carga,
        maxMass: 50 + 5 * carga
      };
      if (typeof result.durable !== 'boolean' || result.why !== '' || result.rev !== pending.command.expectedRev + 1 ||
          !same(result.points, expectedPoints) || !same(result.limits, expectedLimits)) return false;
      pending.ack = {
        durable: result.durable,
        rev: result.rev,
        attr: { v: ATTR.version, carga, re: resets },
        limits: expectedLimits,
        carry: base.carryless ? { v: 1, backpack: 0 } : base.carry,
        goods: base.pack.goods,
        vessels: base.pack.vessels
      };
      this.statusKey = 'pending';
    } else {
      if (typeof result.why !== 'string' || result.rev < pending.command.expectedRev) return false;
      this.pending = null;
      this.statusKey = 'denial';
      this.statusWhy = result.why;
      this.confirming = false;
    }
    this.update();
    return true;
  }

  update() {
    if (this.pending?.ack) {
      const view = this._view();
      const ack = this.pending.ack;
      if (view.valid && view.revision >= ack.rev) {
        const resolvedByLaterProfile = view.revision > ack.rev;
        const matchesReceipt = view.adopted && same(view.attr, ack.attr) && view.volume === ack.limits.volume &&
          view.currentMax === ack.limits.maxMass && view.pack.cap === ack.limits.volume && same(view.carry, ack.carry) &&
          same(view.pack.goods, ack.goods) && same(view.vessels, ack.vessels);
        if (resolvedByLaterProfile || matchesReceipt) {
          this.pending = null;
          this.statusKey = ack.durable ? 'synced' : 'sessionOnly';
          this.statusWhy = '';
        }
      }
    }

    const view = this._view();
    const signature = stable({
      profile: view.valid ? {
        level: view.level, revision: view.revision, adopted: view.adopted, carry: view.carry,
        cap: view.pack.cap, maxMass: view.currentMax, attr: view.attr, goods: view.pack.goods, vessels: view.vessels
      } : null,
      pending: this.pending && { opId: this.pending.command.opId, sentAt: this.pending.sentAt, ack: this.pending.ack },
      status: this.statusKey, why: this.statusWhy, confirming: this.confirming,
      enabled: this._enabled(), retry: !!this.pending && this.now() - this.pending.sentAt >= 5000
    });
    if (signature !== this.lastRenderSignature) {
      this.lastRenderSignature = signature;
      this.onChange?.();
    }
  }

  resetSession() {
    this.pending = null;
    this.confirming = false;
    this.statusKey = 'synced';
    this.statusWhy = '';
    this.update();
  }
}
