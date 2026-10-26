import { HOSTED_CALLS, validHostedCalls } from '../net/hostedInference.js';

export const COPY = {
  es: {
    title: 'Centro de inferencia', back: 'Volver', reload: 'Recargar', connections: 'Conexiones', companions: 'Compañeros',
    pc: 'La opción «Conectar en mi PC» sigue disponible en Mis compañeros.', add: 'Añadir conexión',
    label: 'Etiqueta', url: 'URL base', urlPlaceholder: 'https://api.ejemplo.com/v1', key: 'Clave API',
    clearKey: 'Borrar la clave guardada', defaultModel: 'Modelo por defecto', save: 'Guardar', cancel: 'Cancelar',
    probe: 'Probar modelos', edit: 'Editar', remove: 'Borrar', confirm: 'Confirmar borrado', noKey: 'sin clave', keyHint: hint => `•••• ${hint}`,
    catalog: (count, date) => `${count} modelos · Catálogo: ${date}`, noCatalog: 'sin consultar',
    usage: (r, i, o) => `${r} solicitudes · ${i} tokens de entrada · ${o} tokens de salida`,
    sessionUsage: (c, m, i, o, s, min) => `Esta sesión: ${c}/${m} llamadas · ${i} tokens de entrada · ${o} de salida · ${s} resúmenes · se renueva en ${min} min`,
    memoryUsage: (e, s, kb, max) => `Memoria: ${e} recuerdos · ${s} resúmenes · ${kb} KB de ${max} KB`,
    summaryBlocked: 'El resumen automático se detuvo en esta sesión.',
    calls: `Llamadas por 2 h (${HOSTED_CALLS.min}–${HOSTED_CALLS.max})`, windowOver: 'La ventana de 2 h terminó: detén e inicia para renovarla.',
    model: 'Modelo', connection: 'Conexión', choose: 'Elige una conexión', prompt: 'Mensaje de prueba (1–2000 caracteres)', test: 'Probar',
    result: 'Respuesta de prueba', detail: (ms, model) => `${ms} ms · Modelo servido: ${model}`,
    mismatch: 'Aviso: el modelo servido es distinto del solicitado.', companion: n => `Compañero ${n}`,
    start: 'Iniciar en el servidor', stop: 'Detener', stoppedStatus: 'Detenido', starting: 'Iniciando', running: 'En marcha', failed: 'Falló',
    controls: 'Vuelve a Mis compañeros: crea el compañero, permite su conexión e invoca su cuerpo con los controles existentes.',
    empty: 'Aún no hay conexiones.', noCompanions: 'Aún no hay compañeros.', success: 'Operación completada.', pending: 'Operación en curso…',
    uncertain: 'El resultado es incierto. Recarga el estado del servidor antes de repetir la operación.',
    offline: 'Conéctate al mundo para usar el centro.', signed_out: 'Inicia sesión para usar el centro.', loading: 'Cargando…',
    forbidden: 'No tienes permiso.', disabled: 'La inferencia en el servidor está desactivada.', not_allowed: 'Tu cuenta no tiene acceso a la inferencia en el servidor.',
    misconfigured: 'La inferencia en el servidor necesita configuración.', invalid_request: 'Revisa los campos de la solicitud.', busy: 'Hay demasiadas operaciones. Espera un momento.',
    limit: 'Se alcanzó el límite disponible.', endpoint_unknown: 'La conexión ya no existe.', model_unknown: 'El modelo no está disponible.',
    egress_blocked: 'El servidor no puede acceder de forma segura a esa dirección.', not_created: 'El compañero aún no está creado.',
    stopped: 'La conexión del compañero no está permitida.', presence_body_required: 'Invoca primero el cuerpo del compañero.', unavailable: 'El servicio no está disponible.',
    http_status: 'El proveedor rechazó la solicitud.', invalid_json: 'El proveedor devolvió datos ilegibles.', invalid_response: 'La respuesta del proveedor no es válida.',
    transport_error: 'No se pudo conectar con el proveedor.', timeout: 'El proveedor tardó demasiado.', response_too_large: 'La respuesta es demasiado grande.',
    content_type: 'El proveedor devolvió un formato incompatible.', output_limit: 'Se alcanzó el límite de salida.', truncated: 'La respuesta llegó cortada.',
    content_filter: 'El proveedor filtró el contenido.', incomplete: 'La respuesta está incompleta.', storage_error: 'No se pudo guardar en el servidor.',
  },
  en: {
    title: 'Inference center', back: 'Back', reload: 'Reload', connections: 'Connections', companions: 'Companions',
    pc: '“Connect on my PC” remains available in My companions.', add: 'Add connection',
    label: 'Label', url: 'Base URL', urlPlaceholder: 'https://api.example.com/v1', key: 'API key',
    clearKey: 'Delete the stored key', defaultModel: 'Default model', save: 'Save', cancel: 'Cancel',
    probe: 'List models', edit: 'Edit', remove: 'Delete', confirm: 'Confirm deletion', noKey: 'no key', keyHint: hint => `•••• ${hint}`,
    catalog: (count, date) => `${count} models · Catalog: ${date}`, noCatalog: 'not queried',
    usage: (r, i, o) => `${r} requests · ${i} input tokens · ${o} output tokens`,
    sessionUsage: (c, m, i, o, s, min) => `This session: ${c}/${m} calls · ${i} input tokens · ${o} output · ${s} summaries · renews in ${min} min`,
    memoryUsage: (e, s, kb, max) => `Memory: ${e} memories · ${s} summaries · ${kb} KB of ${max} KB`,
    summaryBlocked: 'Automatic summary stopped for this session.',
    calls: `Calls per 2 h (${HOSTED_CALLS.min}–${HOSTED_CALLS.max})`, windowOver: 'The 2-hour window ended: stop and start to renew it.',
    model: 'Model', connection: 'Connection', choose: 'Choose a connection', prompt: 'Test prompt (1–2000 characters)', test: 'Test',
    result: 'Test reply', detail: (ms, model) => `${ms} ms · Served model: ${model}`,
    mismatch: 'Warning: the served model differs from the requested model.', companion: n => `Companion ${n}`,
    start: 'Start on the server', stop: 'Stop', stoppedStatus: 'Stopped', starting: 'Starting', running: 'Running', failed: 'Failed',
    controls: 'Return to My companions: create the companion, allow its connection and summon its body with the existing controls.',
    empty: 'No connections yet.', noCompanions: 'No companions yet.', success: 'Operation completed.', pending: 'Operation in progress…',
    uncertain: 'The result is uncertain. Reload the server state before repeating the operation.',
    offline: 'Connect to the world to use the center.', signed_out: 'Sign in to use the center.', loading: 'Loading…',
    forbidden: 'You do not have permission.', disabled: 'Server inference is disabled.', not_allowed: 'Your account does not have access to server inference.',
    misconfigured: 'Server inference needs configuration.', invalid_request: 'Check the request fields.', busy: 'Too many operations. Wait a moment.',
    limit: 'The available limit was reached.', endpoint_unknown: 'The connection no longer exists.', model_unknown: 'The model is unavailable.',
    egress_blocked: 'The server cannot safely access that address.', not_created: 'The companion has not been created yet.',
    stopped: 'The companion connection is not allowed.', presence_body_required: 'Summon the companion body first.', unavailable: 'The service is unavailable.',
    http_status: 'The provider rejected the request.', invalid_json: 'The provider returned unreadable data.', invalid_response: 'The provider response is invalid.',
    transport_error: 'Could not connect to the provider.', timeout: 'The provider took too long.', response_too_large: 'The response is too large.',
    content_type: 'The provider returned an unsupported format.', output_limit: 'The output limit was reached.', truncated: 'The response was cut short.',
    content_filter: 'The provider filtered the content.', incomplete: 'The response is incomplete.', storage_error: 'Could not save on the server.',
  },
};
const node = (tag, className = '', text = '') => {
  const el = document.createElement(tag); el.className = className; el.textContent = text; return el;
};
const models = endpoint => [...new Set([endpoint?.defaultModel, ...(endpoint?.models || [])].filter(Boolean))];
// The owner's calls per window is a per-browser convenience; storage may be missing or blocked.
const CALLS_KEY = 'mn.hosted.maxCalls';
const storedCalls = () => {
  try { const value = Number(globalThis.localStorage?.getItem(CALLS_KEY)); return validHostedCalls(value) ? value : HOSTED_CALLS.default; }
  catch { return HOSTED_CALLS.default; }
};
const storeCalls = value => { try { globalThis.localStorage?.setItem(CALLS_KEY, String(value)); } catch {} };
let sequence = 0;

export class HostedInferenceUI {
  constructor(parent, { client, lang = 'es', onClose = () => {} } = {}) {
    Object.assign(this, { client, lang: lang === 'en' ? 'en' : 'es', onClose });
    this.id = ++sequence; this.active = false; this.formEndpoint = undefined; this.deleteConfirmation = null;
    this.choices = new Map(); this.testDrafts = new Map();
    this.state = client.snapshot();
    this.container = node('section', 'mn-hosted-inference'); this.element = this.container; this.container.hidden = true;
    this.container.setAttribute('aria-labelledby', `mn-hosted-title-${this.id}`);
    this.header = node('header', 'mn-hosted-header'); this.title = node('h3'); this.title.id = `mn-hosted-title-${this.id}`;
    this.backButton = this.button('back', () => { this.close(); this.onClose(); });
    this.header.append(this.title, this.backButton);
    this.status = node('p', 'mn-hosted-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.body = node('div', 'mn-hosted-body'); this.form = node('form', 'mn-hosted-card mn-hosted-form'); this.form.hidden = true;
    this.reloadButton = this.button('reload', () => client.load(), 'load');
    this.container.append(this.header, this.status, this.body, this.form, this.reloadButton); parent.append(this.container);
    this.container.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); this.close(); this.onClose(); }
    });
    this.unsubscribe = client.subscribe(state => {
      this.state = state;
      if (['offline', 'signed_out'].includes(state.status)) { this.reset(); return; }
      this.render();
    });
    this.render();
  }
  text() { return COPY[this.lang]; }
  why(code) { return this.text()[code] || this.text().unavailable; }
  get isOpen() { return this.active; }
  open() { this.active = true; this.container.hidden = false; this.render(); this.client.load(); return true; }
  close() { const was = this.active; this.active = false; this.container.hidden = true; this.clearForm(); this.deleteConfirmation = null; return was; }
  reset() { this.close(); this.choices.clear(); this.testDrafts.clear(); this.body.replaceChildren(); this.status.textContent = ''; }
  destroy() { this.reset(); this.unsubscribe?.(); this.container.remove?.(); }
  setLanguage(lang) {
    this.lang = lang === 'en' ? 'en' : 'es';
    // Rebuild labels without carrying a credential across view rebuilds.
    if (this.formEndpoint !== undefined) this.edit(this.formEndpoint);
    this.render();
  }
  pending(op) { return (this.state.pendingOps || []).includes(op); }
  button(key, action, op = '', primary = false) {
    const el = node('button', primary ? 'mn-companions-refresh mn-companion-primary' : 'mn-companions-refresh', this.text()[key]);
    el.type = 'button'; el.dataset.action = key; el.dataset.op = op; el.disabled = !!op && this.pending(op);
    el.addEventListener('click', action); return el;
  }
  field(parent, key, input) { const label = node('label'); label.append(node('span', '', this.text()[key]), input); parent.append(label); return input; }
  select(parent, key, options, value, change) {
    const el = node('select');
    for (const [id, text] of options) { const option = node('option', '', text); option.value = id; el.append(option); }
    el.value = value; el.addEventListener('change', () => change(el.value)); this.field(parent, key, el); return el;
  }
  clearForm() { if (this.keyInput) this.keyInput.value = ''; this.formEndpoint = undefined; this.form.hidden = true; this.form.replaceChildren(); }
  edit(endpoint = null) {
    this.clearForm(); this.formEndpoint = endpoint; this.form.hidden = false;
    const copy = this.text(); this.form.append(node('h4', '', endpoint ? copy.edit : copy.add));
    this.labelInput = this.field(this.form, 'label', node('input')); this.labelInput.value = endpoint?.label || ''; this.labelInput.required = true; this.labelInput.maxLength = 48;
    this.urlInput = this.field(this.form, 'url', node('input')); this.urlInput.type = 'url'; this.urlInput.required = true;
    this.urlInput.maxLength = 300; this.urlInput.placeholder = copy.urlPlaceholder; this.urlInput.value = endpoint?.baseUrl || '';
    this.keyInput = this.field(this.form, 'key', node('input')); this.keyInput.type = 'password'; this.keyInput.autocomplete = 'new-password'; this.keyInput.maxLength = 400;
    this.clearKey = node('input'); this.clearKey.type = 'checkbox';
    if (endpoint) this.field(this.form, 'clearKey', this.clearKey);
    this.modelInput = this.field(this.form, 'defaultModel', node('input')); this.modelInput.maxLength = 200; this.modelInput.value = endpoint?.defaultModel || '';
    const list = node('datalist'); list.id = `mn-hosted-models-${this.id}`; this.modelInput.setAttribute('list', list.id);
    for (const id of models(endpoint)) { const option = node('option'); option.value = id; list.append(option); }
    this.form.append(list);
    this.saveButton = node('button', 'mn-companions-refresh mn-companion-primary', copy.save); this.saveButton.type = 'submit'; this.saveButton.dataset.op = 'save';
    this.form.onsubmit = event => { event.preventDefault(); this.save(); };
    const actions = node('div', 'mn-hosted-actions'); actions.append(this.saveButton, this.button('cancel', () => this.clearForm())); this.form.append(actions);
    this.render(); this.labelInput.focus?.();
  }
  save() {
    if (this.pending('save') || this.formEndpoint === undefined || !this.form.reportValidity?.()) return false;
    const endpoint = { id: this.formEndpoint?.id || null, label: this.labelInput.value, baseUrl: this.urlInput.value, defaultModel: this.modelInput.value || null };
    if (this.clearKey.checked) endpoint.apiKey = '';
    else if (this.keyInput.value) endpoint.apiKey = this.keyInput.value;
    this.keyInput.value = '';
    const sent = this.client.save(endpoint); if (sent) this.clearForm(); return sent;
  }
  remove(endpoint) {
    if (this.pending('delete')) return;
    if (this.deleteConfirmation?.id === endpoint.id && Date.now() < this.deleteConfirmation.until) {
      this.deleteConfirmation = null; this.client.remove(endpoint.id);
    } else { this.deleteConfirmation = { id: endpoint.id, until: Date.now() + 4000 }; this.render(); }
  }
  render() {
    const copy = this.text(), state = this.state;
    this.title.textContent = copy.title; this.backButton.textContent = copy.back; this.reloadButton.textContent = copy.reload;
    this.reloadButton.disabled = this.pending('load');
    this.status.textContent = this.why(state.message || (state.status === 'ready' ? 'success' : state.status));
    this.body.replaceChildren();
    if (!state.available) {
      this.body.append(node('p', '', this.why(state.reason || state.status)), node('p', 'mn-hosted-note', copy.pc));
      this.clearForm(); return;
    }
    const connections = node('section', 'mn-hosted-list'); connections.append(node('h4', '', copy.connections));
    if (!state.endpoints.length) connections.append(node('p', '', copy.empty));
    for (const endpoint of state.endpoints) connections.append(this.connectionNode(endpoint));
    if (state.endpoints.length < state.limits.maxEndpoints) connections.append(this.button('add', () => this.edit(), 'save', true));
    const companions = node('section', 'mn-hosted-list'); companions.append(node('h4', '', copy.companions));
    if (!state.companions.length) companions.append(node('p', '', copy.noCompanions));
    state.companions.forEach((row, index) => companions.append(this.companionNode(row, index)));
    this.body.append(connections, companions);
    if (state.test) {
      const result = node('section', 'mn-hosted-card'); result.append(node('h4', '', copy.result), node('p', 'mn-hosted-reply', state.test.text),
        node('p', '', copy.usage(1, state.test.usage?.inputTokens || 0, state.test.usage?.outputTokens || 0)),
        node('p', '', copy.detail(state.test.latencyMs, state.test.servedModel)));
      if (state.test.modelMismatch) result.append(node('p', 'mn-hosted-warning', copy.mismatch)); this.body.append(result);
    }
    for (const el of this.form.querySelectorAll('input, button')) el.disabled = this.pending('save');
  }
  connectionNode(endpoint) {
    const copy = this.text(), card = node('article', 'mn-hosted-card'); card.dataset.endpoint = endpoint.id;
    let host = ''; try { host = new URL(endpoint.baseUrl).host; } catch { host = endpoint.baseUrl; }
    card.append(node('h4', '', endpoint.label), node('p', 'mn-hosted-note', host), node('p', '', endpoint.keyHint ? copy.keyHint(endpoint.keyHint) : copy.noKey),
      node('p', '', copy.catalog(endpoint.models.length, endpoint.catalogUpdatedAt || copy.noCatalog)));
    if (endpoint.catalogError) card.append(node('p', 'mn-hosted-warning', this.why(endpoint.catalogError)));
    card.append(node('p', 'mn-hosted-note', copy.usage(endpoint.usage?.requests || 0, endpoint.usage?.promptTokens || 0, endpoint.usage?.completionTokens || 0)));
    const actions = node('div', 'mn-hosted-actions'); actions.append(this.button('probe', () => this.client.probe(endpoint.id), 'probe'),
      this.button('edit', () => this.edit(endpoint), 'save'),
      this.button(this.deleteConfirmation?.id === endpoint.id && Date.now() < this.deleteConfirmation.until ? 'confirm' : 'remove', () => this.remove(endpoint), 'delete'));
    card.append(actions);
    const availableModels = models(endpoint), draft = this.testDrafts.get(endpoint.id) || { modelId: '', prompt: '' };
    if (!availableModels.includes(draft.modelId)) draft.modelId = availableModels[0] || '';
    this.testDrafts.set(endpoint.id, draft);
    this.select(card, 'model', availableModels.map(id => [id, id]), draft.modelId, value => { draft.modelId = value; });
    const prompt = this.field(card, 'prompt', node('textarea')); prompt.value = draft.prompt; prompt.maxLength = 2000; prompt.minLength = 1; prompt.rows = 2;
    prompt.addEventListener('input', () => { draft.prompt = prompt.value; test.disabled = this.pending('test') || !draft.modelId || !draft.prompt.trim() || draft.prompt.length > 2000; });
    const test = this.button('test', () => { if (draft.modelId && draft.prompt.trim() && draft.prompt.length <= 2000) this.client.test(endpoint.id, draft.modelId, draft.prompt); }, 'test');
    test.disabled ||= !draft.modelId || !draft.prompt.trim() || draft.prompt.length > 2000; card.append(test); return card;
  }
  companionNode(row, index) {
    const copy = this.text(), card = node('article', 'mn-hosted-card'); card.dataset.character = row.character;
    card.append(node('h4', '', row.name || copy.companion(index + 1)), node('span', 'mn-hosted-badge', copy[row.status === 'stopped' ? 'stoppedStatus' : row.status] || copy.failed));
    if (row.usage) {
      const u = row.usage, minutes = Math.max(0, Math.ceil((u.expiresAtMs - Date.now()) / 60000));
      card.append(node('p', 'mn-hosted-note', copy.sessionUsage(u.calls, u.maxCalls, u.inputTokens, u.outputTokens, u.summaries, minutes)));
      if (minutes === 0) card.append(node('p', 'mn-hosted-warning', copy.windowOver));
    }
    if (row.memory) {
      const m = row.memory;
      card.append(node('p', 'mn-hosted-note', copy.memoryUsage(m.episodes, m.summaries, Math.ceil(m.bytes / 1024), Math.ceil(m.maxBytes / 1024))));
    }
    if (row.autoSummary === 'blocked') card.append(node('p', 'mn-hosted-note', copy.summaryBlocked));
    const choice = this.choices.get(row.character) || { endpointId: row.endpointId || this.state.endpoints[0]?.id || '', modelId: row.modelId || '',
      maxCalls: storedCalls() };
    this.choices.set(row.character, choice);
    const endpoint = this.state.endpoints.find(item => item.id === choice.endpointId), availableModels = models(endpoint);
    if (!availableModels.includes(choice.modelId)) choice.modelId = availableModels[0] || '';
    const connection = this.select(card, 'connection', [['', copy.choose], ...this.state.endpoints.map(item => [item.id, item.label])], choice.endpointId,
      value => { choice.endpointId = value; choice.modelId = ''; this.render(); });
    const model = this.select(card, 'model', availableModels.map(id => [id, id]), choice.modelId, value => { choice.modelId = value; this.render(); });
    const calls = this.field(card, 'calls', node('input')); calls.type = 'number'; calls.min = String(HOSTED_CALLS.min);
    calls.max = String(HOSTED_CALLS.max); calls.step = '1'; calls.value = String(choice.maxCalls);
    calls.addEventListener('change', () => {
      const value = Number(calls.value);
      if (validHostedCalls(value)) { choice.maxCalls = value; storeCalls(value); } else calls.value = String(choice.maxCalls);
    });
    const running = ['starting', 'running'].includes(row.status), op = running ? 'stop' : 'start';
    connection.disabled = model.disabled = calls.disabled = running || this.pending('start') || this.pending('stop');
    const action = this.button(op, () => running ? this.client.stop(row.character)
      : this.client.start(row.character, choice.endpointId, choice.modelId, choice.maxCalls), op, !running);
    action.disabled ||= !running && (!endpoint || !choice.modelId); card.append(action);
    if (row.error) card.append(node('p', 'mn-hosted-warning', this.why(row.error)));
    if (['presence_body_required', 'stopped', 'not_created'].includes(row.error)) card.append(node('p', 'mn-hosted-note', copy.controls));
    return card;
  }
}
