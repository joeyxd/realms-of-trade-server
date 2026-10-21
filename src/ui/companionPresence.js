const COPY = {
  es: {
    title: 'Presencia en Salty Shore', join: 'Salir conmigo', follow: 'Sígueme', wait: 'Espera aquí',
    return: 'Volver al ancla', retire: 'Descansar en el puerto', refresh: 'Actualizar presencia',
    safe: 'Piloto de zona segura: no habilita combate ni recolección.', separate: 'La IA emparejada habla y se mueve como este cuerpo (seguir, esperar, volver).',
    first: 'Primero vuelve al punto de llegada de Salty Shore.', disabled: 'El control de presencia está apagado. Se conserva aquí el último estado recibido.',
    loading: 'Consultando presencia…', mutating: 'Guardando la orden…', offline: 'Conéctate al mundo para consultar la presencia.',
    signed_out: 'Inicia sesión para consultar la presencia.', ready: 'Estado actualizado.', error: 'No se pudo completar la solicitud.',
    uncertain: 'No se pudo confirmar la orden. Actualiza la presencia antes de volver a intentarlo.', timeout: 'La consulta tardó demasiado.',
    forbidden: 'Esta cuenta no puede controlar este compañero.', invalid_request: 'La solicitud no es válida.', unavailable: 'La presencia no está disponible.',
    busy: 'Hay otra operación en curso.', conflict: 'El estado cambió. Actualiza la presencia.', no_companion: 'Esta cuenta todavía no tiene un compañero.',
    outside_anchor: 'Primero vuelve al punto de llegada de Salty Shore.', outside_zone: 'El compañero debe estar dentro de la zona segura.',
    danger: 'No se puede cambiar la presencia durante un peligro.', hurt: 'Está herido: no puede retirarse. Su estado necesita revisión.',
    dead: 'No se puede cambiar la presencia mientras el compañero está derrotado.', full: 'No hay una plaza disponible en la zona.',
    paired: 'El compañero está emparejado; el control de presencia requiere resolver ese estado primero.',
    recovery_required: 'El compañero quedó fuera durante un reinicio. Su presencia requiere revisión; no se invocará de nuevo.',
    blocked: 'El servidor bloqueó esta orden por seguridad.',
    mindOn: 'Mente conectada: habla por este cuerpo y solo puede pedirle seguir, esperar o volver.', mindOff: 'Ninguna mente conectada a este cuerpo.',
    state: p => p ? `${p.name}: ${({ resting: 'en reposo', present: 'presente', recovery: 'requiere revisión', unavailable: 'no disponible' })[p.status]}. Orden: ${{ wait: 'esperar', follow: 'seguir', return: 'volver', gather: 'recolectar' }[p.order]}.` : 'Sin presencia activa.',
    reason: value => value === 'recovery' ? 'El compañero quedó fuera durante un reinicio. Su presencia requiere revisión; no se invocará de nuevo.' : '',
  },
  en: {
    title: 'Presence at Salty Shore', join: 'Come with me', follow: 'Follow me', wait: 'Wait here',
    return: 'Return to anchor', retire: 'Rest at the harbor', refresh: 'Refresh presence',
    safe: 'Safe-zone pilot: combat and harvesting are unavailable.', separate: 'The paired AI speaks and moves as this body (follow, wait, return).',
    first: 'First return to the Salty Shore arrival point.', disabled: 'Presence control is off. The last received state is kept here.',
    loading: 'Checking presence…', mutating: 'Saving the order…', offline: 'Join the world to check presence.',
    signed_out: 'Sign in to check presence.', ready: 'Presence updated.', error: 'The request could not be completed.',
    uncertain: 'The order could not be confirmed. Refresh presence before trying again.', timeout: 'The request took too long.',
    forbidden: 'This account cannot control this companion.', invalid_request: 'The request is invalid.', unavailable: 'Presence is unavailable.',
    busy: 'Another operation is in progress.', conflict: 'The state changed. Refresh presence.', no_companion: 'This account has no companion yet.',
    outside_anchor: 'First return to the Salty Shore arrival point.', outside_zone: 'The companion must be inside the safe zone.',
    danger: 'Presence cannot change while there is danger.', hurt: 'Injured: the companion cannot retire. Its state needs review.',
    dead: 'Presence cannot change while the companion is defeated.', full: 'There is no open slot in this zone.',
    paired: 'The companion is paired; resolve that state before changing presence.',
    recovery_required: 'The companion was left out during a restart. Its presence needs review; it will not be summoned again.',
    blocked: 'The server blocked this order for safety.',
    mindOn: 'Mind connected: it speaks through this body and may only ask it to follow, wait, or return.', mindOff: 'No mind is connected to this body.',
    state: p => p ? `${p.name}: ${{ resting: 'resting', present: 'present', recovery: 'needs review', unavailable: 'unavailable' }[p.status]}. Order: ${{ wait: 'wait', follow: 'follow', return: 'return', gather: 'gather' }[p.order]}.` : 'No active presence.',
    reason: value => value === 'recovery' ? 'The companion was left out during a restart. Its presence needs review; it will not be summoned again.' : '',
  },
};
const node = (tag, className = '', text = '') => { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; };
const ACTIONS = ['join', 'follow', 'wait', 'return', 'retire'];
const CSS = `.mn-companion-presence{display:grid;gap:8px;min-width:0;width:100%;box-sizing:border-box;padding:10px;border:1px solid #514736;border-radius:10px;background:#211e19}.mn-companion-presence[hidden],.mn-companion-presence [hidden]{display:none!important}.mn-companion-presence>*{min-width:0;overflow-wrap:anywhere}.mn-companion-presence h3{margin:0;font-size:1rem}.mn-companion-presence-status,.mn-companion-presence-note{margin:0;color:#d6c6aa;font-size:.9rem}.mn-companion-presence-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:8px}.mn-companion-presence button{min-height:44px;border:1px solid #8c7656;border-radius:9px;background:#29241e;color:#f4ead6;padding:9px 12px;font:600 14px/1.3 system-ui,sans-serif;cursor:pointer}.mn-companion-presence button:disabled{opacity:.55;cursor:wait}.mn-companion-presence button:focus-visible{outline:2px solid #e5c477;outline-offset:2px}`;
let styleInstalled = false;

/** Compact owner controls rendered before the companion list. */
export class CompanionPresenceUI {
  constructor(parent, { client, lang = 'es', onCommand } = {}) {
    if (!parent?.append || !client?.load || !client?.command || !client?.subscribe) throw new TypeError('CompanionPresenceUI requiere parent y client.');
    this.parent = parent; this.client = client; this.lang = lang === 'en' ? 'en' : 'es';
    this.onCommand = typeof onCommand === 'function' ? onCommand : op => this.client.command(op);
    this.state = client.snapshot?.() || { status: 'offline', enabled: false, presence: null, message: '' };
    this.container = node('section', 'mn-companion-presence');
    this.title = node('h3'); this.status = node('p', 'mn-companion-presence-status');
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.stateText = node('p', 'mn-companion-presence-status');
    this.mindNote = node('p', 'mn-companion-presence-note'); this.mindNote.hidden = true;
    this.separateNote = node('p', 'mn-companion-presence-note'); this.safeNote = node('p', 'mn-companion-presence-note');
    this.anchorNote = node('p', 'mn-companion-presence-note'); this.hostNote = node('p', 'mn-companion-presence-note');
    this.hostNote.textContent = '';
    this.actions = node('div', 'mn-companion-presence-actions'); this.buttons = {};
    for (const op of ACTIONS) {
      const button = node('button'); button.type = 'button'; button.dataset.op = op;
      button.addEventListener('click', () => {
        if (button.disabled || !this.canAct()) return;
        this.onCommand(op);
      });
      this.buttons[op] = button; this.actions.append(button);
    }
    this.refreshButton = node('button'); this.refreshButton.type = 'button';
    this.refreshButton.addEventListener('click', () => this.client.load({ refresh: true }));
    this.container.append(this.title, this.status, this.stateText, this.mindNote, this.hostNote, this.separateNote, this.safeNote, this.anchorNote, this.actions, this.refreshButton);
    this.element = this.container; parent.append(this.container); this.installStyles();
    this.unsubscribe = client.subscribe(state => this.setState(state)); this.render();
  }
  installStyles() {
    if (styleInstalled || !document.head || document.getElementById?.('mn-companion-presence-style')) return;
    const style = node('style'); style.id = 'mn-companion-presence-style'; style.textContent = CSS; document.head.append(style); styleInstalled = true;
  }
  text() { return COPY[this.lang]; }
  setLanguage(lang) { this.lang = lang === 'en' ? 'en' : 'es'; this.render(); }
  setState(state) { this.state = { ...state, presence: state?.presence ? { ...state.presence } : null }; this.render(); }
  canAct() { return this.state.status === 'ready' && this.state.enabled && this.state.presence
    && !['recovery', 'unavailable'].includes(this.state.presence.status); }
  render() {
    const c = this.text(); this.title.textContent = c.title; this.separateNote.textContent = c.separate; this.safeNote.textContent = c.safe;
    this.anchorNote.textContent = c.first;
    this.status.textContent = this.state.message ? c[this.state.message] || c.error : c[this.state.status] || c.error;
    this.hostNote.textContent = this.state.enabled ? '' : c.disabled;
    const p = this.state.presence;
    this.stateText.textContent = `${c.state(p)}${c.reason(p?.status) ? ` ${c.reason(p.status)}` : p?.reason && c[p.reason] ? ` ${c[p.reason]}` : ''}`;
    // L03g-b: say whether a paired mind is attached to the present body (null while unknown).
    const mind = this.client.mindConnected?.() ?? null;
    this.mindNote.hidden = !this.state.enabled || p?.status !== 'present' || typeof mind !== 'boolean';
    this.mindNote.textContent = mind ? c.mindOn : c.mindOff;
    for (const op of ACTIONS) this.buttons[op].textContent = c[op];
    const available = this.canAct();
    for (const [op, button] of Object.entries(this.buttons)) {
      button.hidden = !this.state.enabled;
      button.disabled = !available || (op === 'join' ? p?.status !== 'resting' : p?.status !== 'present');
    }
    this.actions.hidden = !this.state.enabled;
    this.refreshButton.textContent = c.refresh;
    this.refreshButton.disabled = ['loading', 'mutating'].includes(this.state.status) || !['ready', 'error', 'uncertain'].includes(this.state.status);
    this.anchorNote.hidden = this.state.message !== 'outside_anchor' && Boolean(this.state.presence);
  }
  destroy() { this.unsubscribe?.(); this.container.remove?.(); }
}
