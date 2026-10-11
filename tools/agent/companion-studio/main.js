const $ = id => document.getElementById(id);
const ROLE_LABELS = { sailor: 'Marinero', marine: 'Infante de marina', builder: 'Constructor', harvester: 'Recolector', resident: 'Residente de Salty Shore' };
const THINKING_LABELS = { server_default: 'Predeterminado del servidor', disabled: 'Sin razonamiento extendido' };
const FILE_LABELS = { personality: 'Personalidad', objectives: 'Objetivos', memory: 'Memoria', guide: 'Guía' };
const STATE_LABELS = { not_created: 'Sin crear', stopped: 'Detenido', starting: 'Iniciando', ready: 'En servicio', error: 'Revisar estado' };
const WHY_COPY = {
  unauthorized: 'El acceso local no es válido. Abre el panel con el enlace de acceso vigente.',
  not_created: 'Primero crea a tu compañero.', already_created: 'Ya hay un compañero en esta sesión.',
  invalid_request: 'Revisa los datos e inténtalo de nuevo.', invalid_draft: 'Revisa los datos del compañero.',
  invalid_model: 'El modelo local no está disponible. Revisa el servidor y el nombre del modelo.',
  runner_unavailable: 'El servicio local no está disponible en este momento.', already_running: 'Tu compañero ya está en marcha.',
  not_running: 'Tu compañero ya está detenido.', busy: 'Hay otra acción en curso. Espera un momento.',
  max_calls: 'Se alcanzó el límite de llamadas.', max_tokens: 'Se alcanzó el límite de tokens locales.',
  local_resource_outcome_unresolved: 'El resultado de una llamada anterior sigue sin resolverse. No se enviaron más llamadas; revisa el estado del compañero.',
  inference_timeout: 'La llamada tardó demasiado. El resultado puede seguir sin resolverse; revisa el estado antes de continuar.',
  inference_busy: 'El compañero ya está atendiendo otra solicitud. Espera a que termine.',
  chat_outcome_unresolved: 'No se pudo confirmar si el mensaje llegó. Revisa la conversación antes de enviarlo de nuevo.',
  start_cancelled: 'El inicio se canceló antes de confirmar el estado. Actualiza para comprobarlo.',
  local_resource_budget_expired: 'La cuota local caducó. Sus archivos permanecen y el consumo conserva su contador.',
  invalid_memory_sources: 'Selecciona de uno a ocho episodios válidos.',
  memory_summary_exists: 'Esos episodios ya tienen un resumen. Los originales siguen disponibles.',
  memory_source_unavailable: 'Alguna fuente ya no está disponible o caducó. Actualiza la lista.',
  memory_sources_over_budget: 'Las fuentes no caben en una consulta de resumen. Elige menos episodios.',
  memory_summary_declined: 'El modelo decidió no resumir. No se guardó un resumen y los originales siguen intactos.',
  invalid_decision: 'La respuesta del modelo no cumple el formato. No se aplicó su propuesta; revisa el consumo confirmado.',
  context_reload_failed: 'No se pudieron validar los archivos. Se canceló la consulta anterior; revisa los documentos antes de continuar.',
  memory_capture_failed: 'No se pudo guardar la captura. El mensaje ya entregado permanece en la conversación.',
  network: 'No se pudo contactar el panel local. Revisa la conexión e inténtalo de nuevo.',
};
const LOOK_SWATCHES = ['#536b78', '#783e37', '#52706d', '#805636', '#75434a'];
let accessKey = null;
let snapshot = null;
let templates = null;
let step = 0;
let pending = new Set();
let currentFile = 'personality';
let currentFiles = null;
let initialDraftLoaded = false;
const selectedEpisodeIds = new Set();

export function keyFromFragment(fragment) {
  const match = String(fragment || '').replace(/^#/, '').match(/(?:^|&)key=([a-f0-9]{64})(?:&|$)/i);
  return match ? match[1].toLowerCase() : null;
}

export function isLocalEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && /^\d{1,5}$/.test(url.port)
      && Number(url.port) >= 1 && Number(url.port) <= 65535 && url.pathname.replace(/\/$/, '') === '/v1'
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function checkedLimits(calls, tokens) {
  const maxCalls = Number(calls), maxTokens = Number(tokens);
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 8
      || !Number.isSafeInteger(maxTokens) || maxTokens < 32768 || maxTokens > 1_000_000) return null;
  return { maxCalls, maxTokens };
}

export function normalizeChatInput(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
  const text = value.normalize('NFC').trim();
  if (!text || [...text].length > 280) return null;
  return text;
}

export function validateWizardDraft(draft, limits) {
  if (!draft || draft.v !== 1 || typeof draft.name !== 'string' || !draft.name.trim() || draft.name.trim().length > 16
      || !Object.hasOwn(ROLE_LABELS, draft.role) || typeof draft.personality !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(draft.personality)
      || !Array.isArray(draft.traits) || draft.traits.length > 3 || new Set(draft.traits).size !== draft.traits.length
      || draft.traits.some(trait => typeof trait !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(trait))
      || !Number.isInteger(draft.skin) || draft.skin < 0 || draft.skin > 4
      || typeof draft.modelId !== 'string' || !/^[A-Za-z0-9._:/-]{1,160}$/.test(draft.modelId.trim())
      || !isLocalEndpoint(draft.baseUrl) || !['server_default', 'disabled'].includes(draft.thinkingMode)
      || !limits || !checkedLimits(limits.maxCalls, limits.maxTokens)) return false;
  return true;
}

function announce(message = '', error = false) {
  const box = $('notice'); if (!box) return;
  box.textContent = message; box.classList.toggle('error', error); box.hidden = !message;
}
export function fixedWhy(why) { return WHY_COPY[why] || 'No se pudo confirmar el resultado. Actualiza el estado antes de decidir si vuelves a intentarlo.'; }
function fmt(value) { return Number.isSafeInteger(value) ? new Intl.NumberFormat('es-MX').format(value) : '—'; }
function textNode(tag, text, className = '') { const el = document.createElement(tag); if (className) el.className = className; el.textContent = text; return el; }
function created() { return Boolean(snapshot?.created || (snapshot?.status?.state && snapshot.status.state !== 'not_created')); }
function gameConnected() { return snapshot?.status?.connected === true; }
function setPill(el, text, kind) { el.textContent = text; el.className = `pill ${kind}`; }

async function api(path, body) {
  if (!accessKey) throw new Error('unauthorized');
  let response;
  try {
    response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { Authorization: `Bearer ${accessKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Error('network'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('response'); }
  if (!response.ok || data?.ok === false) throw new Error(typeof data?.why === 'string' ? data.why : 'request_failed');
  return data;
}

function setPending(name, value) {
  if (value) pending.add(name); else pending.delete(name);
  const globalBusy = pending.size > 0 || snapshot?.status?.inFlight === true;
  for (const id of ['start', 'send', 'remember', 'remember-inline', 'reenter']) if ($(id)) $(id).disabled = globalBusy || !created();
  if ($('create')) $('create').disabled = globalBusy || created();
  if ($('chat-input')) $('chat-input').disabled = globalBusy || snapshot?.status?.state !== 'ready';
  if ($('stop')) $('stop').disabled = !created() || pending.has('stop') || snapshot?.status?.state === 'stopped';
  if ($('refresh')) $('refresh').disabled = pending.has('refresh');
  if ($('files-refresh')) $('files-refresh').disabled = pending.has('files');
  if ($('chat-status') && name === 'chat') $('chat-status').textContent = value ? 'Esperando respuesta confirmada…' : '';
}

function populateTemplates(module) {
  templates = module;
  const personality = $('personality'), traits = $('traits'), looks = $('looks');
  personality.replaceChildren(); traits.replaceChildren(); looks.replaceChildren();
  for (const [id, item] of Object.entries(module.PERSONALITY_TEMPLATES)) {
    const option = document.createElement('option'); option.value = id; option.textContent = item.label; personality.append(option);
  }
  for (const [id, label] of Object.entries(module.TRAIT_TEMPLATES)) {
    const labelEl = document.createElement('label'); labelEl.className = 'trait-choice';
    const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'trait'; input.value = id;
    input.addEventListener('change', () => { if (selectedTraits().length > 3) input.checked = false; });
    labelEl.append(input, textNode('span', label)); traits.append(labelEl);
  }
  for (const look of module.COMPANION_LOOKS) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'look-choice'; button.dataset.skin = String(look.skin);
    button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', 'false'); button.setAttribute('aria-label', `Aspecto ${look.name}`);
    const emblem = textNode('span', '✦', 'look-emblem'); emblem.style.setProperty('--look-color', LOOK_SWATCHES[look.skin] || LOOK_SWATCHES[0]);
    button.append(emblem, textNode('strong', look.name), textNode('small', 'Aspecto del juego'));
    button.addEventListener('click', () => selectSkin(look.skin)); looks.append(button);
  }
}
function selectedTraits() { return [...document.querySelectorAll('input[name="trait"]:checked')].map(el => el.value); }
function selectSkin(skin) { for (const el of document.querySelectorAll('.look-choice')) { const selected = Number(el.dataset.skin) === skin; el.setAttribute('aria-checked', String(selected)); el.classList.toggle('selected', selected); } }
function collectDraft() {
  return { v: 1, name: $('name').value.trim(), role: $('role').value, personality: $('personality').value,
    traits: selectedTraits(), skin: Number(document.querySelector('.look-choice[aria-checked="true"]')?.dataset.skin ?? 0),
    modelId: $('modelId').value.trim(), baseUrl: $('baseUrl').value.trim(), thinkingMode: $('thinkingMode').value };
}
function fillDraft(draft) {
  if (!draft) return;
  $('name').value = draft.name || ''; $('role').value = draft.role || 'sailor'; $('personality').value = draft.personality || 'warm';
  $('modelId').value = draft.modelId || 'local-model'; $('baseUrl').value = draft.baseUrl || 'http://127.0.0.1:8080/v1'; $('thinkingMode').value = draft.thinkingMode || 'server_default';
  document.querySelectorAll('input[name="trait"]').forEach(el => { el.checked = (draft.traits || []).includes(el.value); });
  selectSkin(Number.isInteger(draft.skin) ? draft.skin : 0);
}
function validateStep(index) {
  if (index === 0) {
    if (!$('name').value.trim() || $('name').value.trim().length > 16) return 'Escribe un nombre de hasta 16 caracteres.';
    if (!Object.hasOwn(ROLE_LABELS, $('role').value)) return 'Elige un oficio.';
  }
  if (index === 1 && selectedTraits().length > 3) return 'Elige hasta tres rasgos.';
  if (index === 2) {
    if (!isLocalEndpoint($('baseUrl').value.trim())) return 'Usa la dirección local del servidor de modelos.';
    if (!$('modelId').value.trim() || $('modelId').value.trim().length > 160) return 'Elige un modelo local disponible.';
    if (!checkedLimits($('maxCalls').value, $('maxTokens').value)) return 'Los límites deben ser números enteros finitos dentro del rango.';
  }
  return '';
}
function reviewDraft() {
  const d = collectDraft(), role = templates.ROLE_TEMPLATES[d.role], personality = templates.PERSONALITY_TEMPLATES[d.personality];
  const look = templates.COMPANION_LOOKS.find(item => item.skin === d.skin);
  const lines = [['Nombre', d.name], ['Oficio', role?.label || ROLE_LABELS[d.role]], ['Aspecto', look?.name || 'Corsario'],
    ['Personalidad', personality?.label || d.personality], ['Rasgos', d.traits.map(id => templates.TRAIT_TEMPLATES[id]).join(', ') || 'Aún por definir'],
    ['Modelo local', d.modelId], ['Servidor', d.baseUrl], ['Razonamiento', THINKING_LABELS[d.thinkingMode]],
    ['Límites', `${fmt(Number($('maxCalls').value))} llamadas · ${fmt(Number($('maxTokens').value))} tokens`]];
  const dl = $('review'); dl.replaceChildren();
  for (const [term, value] of lines) { dl.append(textNode('dt', term), textNode('dd', value)); }
}
function renderStep() {
  for (const panel of document.querySelectorAll('.wizard-step')) panel.hidden = Number(panel.dataset.step) !== step;
  for (const indicator of document.querySelectorAll('[data-step-indicator]')) {
    const n = Number(indicator.dataset.stepIndicator); indicator.classList.toggle('current', n === step); indicator.classList.toggle('done', n < step);
  }
  $('step-count').textContent = `Paso ${step + 1} de 4`; $('previous').disabled = step === 0;
  $('next').hidden = step === 3; $('create').hidden = step !== 3;
  if (step === 3) reviewDraft();
}

function showWorkspace() {
  const exists = created(); $('wizard').hidden = exists; $('workspace').hidden = !exists;
  $('companion-name').textContent = exists ? (snapshot.draft?.name || snapshot.status?.name || 'Compañero local') : 'Aún sin crear';
  $('game-status').textContent = gameConnected() ? 'Juego: conectado (confirmado)' : 'Juego: sin conexión confirmada';
  $('scope-detail').textContent = snapshot?.scope?.worldId ? `Mundo ${snapshot.scope.worldId}` : 'Vinculado a este panel local.';
  const modelSelect = $('modelId'), selectedModel = snapshot?.draft?.modelId || modelSelect.value;
  const modelIds = Array.isArray(snapshot?.models) ? snapshot.models.filter(id => typeof id === 'string' && /^[A-Za-z0-9._:/-]{1,160}$/.test(id)) : [];
  const choices = [...new Set([...(modelIds.length ? [] : ['local-model']), ...modelIds])];
  if (!exists) {
    if (choices.length) {
      modelSelect.replaceChildren();
      for (const id of choices) { const option = document.createElement('option'); option.value = id; option.textContent = id; modelSelect.append(option); }
      modelSelect.value = choices.includes(selectedModel) ? selectedModel : choices[0];
    }
    setPill($('connection'), accessKey ? 'Panel local conectado' : 'Esperando acceso', accessKey ? 'ok' : 'muted'); return;
  }
  const state = snapshot.status?.state || 'stopped';
  const labels = { ...STATE_LABELS, stopped: 'Detenido' };
  $('runner-state').textContent = labels[state] || 'Estado recibido';
  $('runner-summary').textContent = snapshot.status?.why ? fixedWhy(snapshot.status.why) : gameConnected() ? 'El servidor confirma la conexión con el juego.' : 'El compañero está local; el juego aún no confirmó conexión.';
  $('runner-badge').textContent = labels[state] || 'Estado recibido'; $('runner-badge').className = `pill ${state === 'ready' ? 'ok' : state === 'error' ? 'warn' : 'muted'}`;
  $('identity-summary').textContent = `${ROLE_LABELS[snapshot.draft?.role] || ''} · ${templates?.COMPANION_LOOKS.find(x => x.skin === snapshot.draft?.skin)?.name || ''}`;
  $('conversation-title').textContent = `Habla con ${snapshot.draft?.name || 'tu compañero'}`;
  $('open-world').hidden = !gameConnected() || !snapshot.status?.worldUrl;
  if (!$('open-world').hidden) $('open-world').href = snapshot.status.worldUrl;
  const busy = pending.size > 0 || snapshot.status?.inFlight === true;
  $('start').disabled = busy || state === 'ready' || state === 'starting';
  $('stop').disabled = state === 'stopped' || pending.has('stop');
  $('reenter').disabled = busy;
  $('send').disabled = state !== 'ready' || busy; $('chat-input').disabled = state !== 'ready' || busy;
  $('remember').disabled = !gameConnected() || busy; $('remember-inline').disabled = !gameConnected() || busy;
  $('files-refresh').disabled = pending.has('files');
  const budget = snapshot.budget || {};
  $('confirmed').textContent = fmt(budget.totals?.confirmedTokens ?? budget.confirmedTokens);
  $('held').textContent = fmt(budget.totals?.heldTokens ?? budget.heldTokens);
  $('unresolved').textContent = fmt(budget.totals?.unresolvedTokens ?? budget.unresolvedTokens);
  const limitText = budget.limits ? `Límites: ${fmt(budget.limits.maxCalls)} llamadas · ${fmt(budget.limits.maxTokens)} tokens locales.` : '';
  $('budget-note').textContent = `${limitText}${budget.persistence?.admissionWhy ? ` ${fixedWhy(budget.persistence.admissionWhy)}` : ''}`;
  renderTranscript(snapshot.transcript || []);
  renderContinuity(snapshot.continuity || null);
  if (snapshot.files && snapshot.files !== currentFiles) renderFiles(snapshot.files);
  setPill($('connection'), 'Panel local conectado', 'ok');
}
function displayTime(value) {
  return Number.isFinite(value) ? new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : 'hora desconocida';
}
function continuityReason(value) {
  if (!value) return 'sin motivo indicado';
  return ({ delivered_exchange: 'conversación confirmada', delivered_message: 'mensaje confirmado', manual_capture: 'captura manual',
    manual_summary: 'resumen manual', context_pressure: 'presión de contexto', manual_refresh: 'refresco manual',
    process_open: 'apertura de archivos', session_start: 'inicio de sesión', loaded_from_files: 'recuperado desde archivos' })[value] || 'actividad de continuidad';
}
function renderContinuity(continuity) {
  if (!continuity) return;
  const context = continuity.context;
  $('continuity-capture').textContent = continuity.autoCapture === true ? 'Captura automática: activa' : 'Captura automática: sin confirmar';
  $('context-refresh').disabled = !created() || pending.has('contextRefresh');
  $('context-refresh-status').textContent = pending.has('contextRefresh') ? 'Releyendo los archivos…' : 'Relee los archivos y cancela la consulta anterior. Conserva la sesión, la cuota y los pendientes.';
  if (context && !context.requiredOverBudget && Number.isFinite(context.inputTokens) && Number.isFinite(context.maxContextTokens)) {
    const tokenPercent = context.maxContextTokens > 0 ? Math.min(100, context.totalReservedContextTokens / context.maxContextTokens * 100) : 0;
    $('context-value').textContent = `${fmt(context.totalReservedContextTokens)} / ${fmt(context.maxContextTokens)} unidades estimadas`;
    $('context-detail').textContent = `Última consulta: ${fmt(context.transmittedBytes)} / ${fmt(context.maxInputBytes)} bytes transmitidos · ${fmt(context.inputTokens)} de entrada + salida y margen reservados. Estimación conservadora; no es un tokenizer del modelo.`;
    const meter = $('context-meter'); meter.style.width = `${tokenPercent}%`;
    meter.parentElement.setAttribute('aria-valuemax', String(context.maxContextTokens || 0));
    meter.parentElement.setAttribute('aria-valuenow', String(context.totalReservedContextTokens || 0));
    meter.parentElement.classList.toggle('pressure', context.pressure === true);
    setPill($('context-pressure'), context.pressure === true ? 'Presión alta' : 'Dentro del límite', context.pressure === true ? 'warn' : 'ok');
  } else {
    $('context-value').textContent = context?.requiredOverBudget ? 'Contexto obligatorio demasiado grande' : 'Aún sin consulta medida';
    $('context-detail').textContent = context?.requiredOverBudget ? 'No se envió al modelo. Resumir recuerdos no reduce las reglas y los pendientes obligatorios.' : 'La próxima consulta medirá el payload completo con su reserva de salida y margen.';
    $('context-meter').style.width = '0%'; $('context-meter').parentElement.classList.remove('pressure');
    setPill($('context-pressure'), context?.requiredOverBudget ? 'Revisar archivos' : 'Sin lectura', context?.requiredOverBudget ? 'warn' : 'muted');
  }
  const capture = continuity.lastCapture;
  $('capture-detail').textContent = capture ? `${capture.ok ? 'Guardada' : 'No guardada'} · ${displayTime(capture.atMs)} · ${continuityReason(capture.reason)}${capture.entryId ? ` · ${capture.entryId}` : ''}${capture.why ? ` · ${fixedWhy(capture.why)}` : ''}` : 'Sin capturas registradas.';
  const lastRefresh = continuity.lastRefresh;
  $('refresh-detail').textContent = lastRefresh ? `${displayTime(lastRefresh.atMs)} · ${continuityReason(lastRefresh.reason)} · revisión ${fmt(lastRefresh.revision)}` : 'Sin mediciones registradas.';
  const summary = continuity.lastSummary;
  $('summary-detail').textContent = summary ? `${summary.ok ? 'Completado' : 'No completado'} · ${displayTime(summary.atMs)} · ${continuityReason(summary.reason)}${Array.isArray(summary.sourceIds) ? ` · ${summary.sourceIds.length} episodios` : ''}${summary.why ? ` · ${fixedWhy(summary.why)}` : ''}` : 'Sin resúmenes registrados.';

  const sources = Array.isArray(continuity.sources) ? continuity.sources.slice(0, 32) : [];
  const sourceIds = new Set(sources.filter(item => typeof item?.id === 'string').map(item => item.id));
  for (const selectedId of selectedEpisodeIds) if (!sourceIds.has(selectedId)) selectedEpisodeIds.delete(selectedId);
  const list = $('episode-list'); list.replaceChildren();
  if (!sources.length) list.append(textNode('p', 'Los episodios aparecerán cuando se guarde actividad.', 'empty-state'));
  const sourceRows = [];
  for (const source of sources) {
    if (!source || typeof source.id !== 'string') continue;
    const label = document.createElement('label'); label.className = 'episode-row';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedEpisodeIds.has(source.id); checkbox.setAttribute('aria-label', `Seleccionar episodio ${source.id}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selectedEpisodeIds.size >= 8) { checkbox.checked = false; announce('Puedes seleccionar hasta ocho episodios.', true); return; }
      if (checkbox.checked) selectedEpisodeIds.add(source.id); else selectedEpisodeIds.delete(source.id);
      renderContinuity(continuity);
    });
    const details = document.createElement('span');
    details.append(textNode('strong', `${displayTime(source.createdAtMs)}${source.summarized ? ' · resumido' : ''}`));
    details.append(textNode('small', typeof source.preview === 'string' ? source.preview : 'Episodio sin vista previa.'));
    label.append(checkbox, details); list.append(label); sourceRows.push(checkbox);
  }
  const status = snapshot?.status || {}, inFlight = status.inFlight === true;
  const canSummarize = gameConnected() && !inFlight && selectedEpisodeIds.size > 0
    && selectedEpisodeIds.size <= 8 && !pending.has('compact') && !snapshot?.budget?.persistence?.admissionWhy;
  for (const checkbox of sourceRows) checkbox.disabled = inFlight || pending.has('compact') || (!checkbox.checked && selectedEpisodeIds.size >= 8);
  $('episode-count').textContent = `${fmt(sources.length)} episodios · ${fmt(continuity.journal?.summaries || 0)} resúmenes · ${selectedEpisodeIds.size} de 8 seleccionados`;
  $('summarize-episodes').disabled = !canSummarize;
  $('summarize-episodes').textContent = pending.has('compact') ? 'Resumiendo…' : 'Resumir seleccionados';
  $('auto-compact').checked = continuity.autoCompact === true;
  $('auto-compact').disabled = pending.has('continuity');
  const remaining = continuity.automaticSummaryRemaining === 1 ? 1 : 0;
  $('auto-compact-budget').textContent = continuity.autoCompact === true
    ? `Activo: ${remaining} resumen automático disponible de ${fmt(continuity.automaticSummaryLimit || 1)} en esta cuota. Espera una pausa y presión del contexto; los intentos manuales también cuentan.`
    : 'El resumen automático está desactivado. Al activarlo se permite como máximo un resumen por cuota disponible; los intentos manuales también cuentan de forma conservadora. Los originales permanecen.';
}
function renderTranscript(records) {
  const root = $('transcript'); root.replaceChildren();
  const delivered = Array.isArray(records) ? records.filter(row => row?.delivered === true && ['owner', 'companion'].includes(row.sender) && typeof row.text === 'string') : [];
  if (!delivered.length) { root.append(textNode('p', 'Los mensajes aparecerán cuando el servidor los confirme.', 'empty-state')); return; }
  for (const row of delivered.slice(-100)) {
    const article = document.createElement('article'); article.className = `message ${row.sender}`;
    article.append(textNode('span', row.sender === 'owner' ? 'Tú' : 'Compañero', 'message-sender'), textNode('p', row.text, 'message-text'));
    root.append(article);
  }
  root.scrollTop = root.scrollHeight;
}
function renderFiles(files) {
  currentFiles = files; const tabs = $('file-tabs'); tabs.replaceChildren();
  const keys = Object.keys(FILE_LABELS).filter(key => files?.[key] && typeof files[key].content === 'string');
  if (!keys.length) { $('file-content').textContent = 'No hay archivos disponibles todavía.'; $('file-name').textContent = 'Aún sin archivos'; $('file-meta').textContent = ''; $('export-file').disabled = true; return; }
  if (!keys.includes(currentFile)) currentFile = keys[0];
  for (const key of keys) {
    const button = textNode('button', FILE_LABELS[key], `tab${key === currentFile ? ' active' : ''}`); button.type = 'button'; button.role = 'tab'; button.setAttribute('aria-selected', String(key === currentFile));
    button.addEventListener('click', () => { currentFile = key; renderFiles(currentFiles); }); tabs.append(button);
  }
  const file = files[currentFile]; $('file-name').textContent = file.filename || FILE_LABELS[currentFile];
  $('file-content').textContent = file.content; $('file-meta').textContent = file.sha256 ? `SHA-256 ${file.sha256}` : '';
  $('export-file').disabled = false;
}

async function refresh() {
  if (pending.has('refresh')) return;
  setPending('refresh', true);
  try {
    snapshot = await api('/api/state');
    if (!snapshot || snapshot.ok === false) throw new Error('response');
    if (!initialDraftLoaded && !created()) { fillDraft(snapshot.draft); initialDraftLoaded = true; }
    showWorkspace();
  }
  catch (error) { setPill($('connection'), 'Sin lectura', 'warn'); announce(fixedWhy(error.message), true); }
  finally { setPending('refresh', false); if (snapshot) showWorkspace(); }
}
async function mutate(name, path, body, after = true) {
  if (pending.has(name) || (name !== 'stop' && pending.size > 0)) return false;
  setPending(name, true);
  try {
    const result = await api(path, body);
    if (result?.state && typeof result.state === 'object') snapshot = { ...snapshot, ...result.state };
    else if (name === 'files' && result?.files) snapshot = { ...snapshot, files: result.files };
    if (after) await refresh(); else showWorkspace(); announce('Listo.'); return true;
  }
  catch (error) {
    if (['local_resource_outcome_unresolved', 'inference_timeout', 'chat_outcome_unresolved', 'start_cancelled'].includes(error.message)) await refresh();
    announce(fixedWhy(error.message), true); return false;
  }
  finally { setPending(name, false); showWorkspace(); }
}

async function continuityAction(name, path, body) {
  if (pending.has(name)) return false;
  if (name === 'compact') {
    const status = snapshot?.status || [];
    const sourceIds = [...selectedEpisodeIds];
    if (!gameConnected() || status.inFlight === true || sourceIds.length < 1 || sourceIds.length > 8) {
      announce('Conecta al juego, espera a que el compañero esté libre y selecciona de uno a ocho episodios.', true); return false;
    }
    body = { sourceIds };
  }
  setPending(name, true);
  try {
    const result = await api(path, body);
    if (result?.state && typeof result.state === 'object') snapshot = { ...snapshot, ...result.state };
    else if (result?.continuity) snapshot = { ...snapshot, continuity: result.continuity };
    if (name === 'compact') selectedEpisodeIds.clear();
    await refresh(); announce(name === 'contextRefresh' ? 'Contexto actualizado.' : name === 'compact' ? 'Episodios enviados a resumen; los originales se conservan.' : 'Preferencia de continuidad actualizada.');
    return true;
  } catch (error) {
    announce(fixedWhy(error.message), true);
    if (name !== 'continuity') await refresh();
    return false;
  } finally { setPending(name, false); if (snapshot) showWorkspace(); }
}

async function createCompanion(event) {
  event.preventDefault(); const invalid = validateStep(0) || validateStep(1) || validateStep(2);
  if (invalid) { announce(invalid, true); return; }
  let draft = collectDraft();
  const limits = checkedLimits($('maxCalls').value, $('maxTokens').value);
  if (!validateWizardDraft(draft, limits)) { announce('Revisa el nombre, oficio, rasgos, servidor local, modelo y límites.', true); return; }
  try { draft = templates.validateCompanionDraft(draft); }
  catch { announce('Revisa los datos del compañero.', true); return; }
  $('draft-state').textContent = 'Enviando borrador…';
  await mutate('create', '/api/create', { draft, limits });
  $('draft-state').textContent = '';
}
async function sendChat(event) {
  event.preventDefault(); const text = normalizeChatInput($('chat-input').value);
  if (!text) { announce('Escribe un mensaje de hasta 280 caracteres, sin caracteres de control.', true); return; }
  const sent = await mutate('chat', '/api/chat', { text });
  if (sent) { $('chat-input').value = ''; $('chat-count').textContent = '0 / 280'; }
}
function setupEvents() {
  $('next').addEventListener('click', () => {
    const error = validateStep(step); if (error) { announce(error, true); return; }
    announce(''); step = Math.min(3, step + 1); renderStep();
  });
  $('previous').addEventListener('click', () => { step = Math.max(0, step - 1); announce(''); renderStep(); });
  $('create-form').addEventListener('submit', createCompanion);
  $('randomize').addEventListener('click', () => {
    const current = collectDraft();
    const randomized = templates.randomizeCompanionDraft({ seed: crypto.randomUUID(), name: current.name,
      modelId: current.modelId, baseUrl: current.baseUrl, thinkingMode: current.thinkingMode });
    fillDraft(randomized); announce('Tu compañero recibió una nueva combinación de rasgos.');
  });
  $('refresh').addEventListener('click', refresh);
  $('context-refresh').addEventListener('click', () => continuityAction('contextRefresh', '/api/context/refresh', {}));
  $('summarize-episodes').addEventListener('click', () => continuityAction('compact', '/api/memory/compact', {}));
  $('auto-compact').addEventListener('change', event => continuityAction('continuity', '/api/continuity', { autoCompact: event.currentTarget.checked }));
  $('start').addEventListener('click', () => mutate('start', '/api/start', {}));
  $('stop').addEventListener('click', () => mutate('stop', '/api/stop', {}));
  $('reenter').addEventListener('click', () => mutate('reenter', '/api/reenter', {}));
  $('chat-form').addEventListener('submit', sendChat);
  $('chat-input').addEventListener('input', () => { $('chat-count').textContent = `${[...$('chat-input').value].length} / 280`; });
  $('remember').addEventListener('click', () => mutate('remember', '/api/remember', {}));
  $('remember-inline').addEventListener('click', () => mutate('remember', '/api/remember', {}));
  $('files-refresh').addEventListener('click', async () => { await mutate('files', '/api/files', {}, false); if (snapshot?.files) renderFiles(snapshot.files); });
  $('export-file').addEventListener('click', () => {
    const file = currentFiles?.[currentFile]; if (!file || typeof file.content !== 'string') return;
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' }), link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = file.filename || `${currentFile}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  });
}

export async function initialize() {
  accessKey = keyFromFragment(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const shared = await import('/companionTemplates.js'); populateTemplates(shared); fillDraft(shared.DEFAULT_COMPANION_DRAFT);
    setupEvents(); renderStep();
    if (!accessKey) { setPill($('connection'), 'Falta acceso local', 'warn'); announce('Abre el enlace local de creación que te dio el servidor.'); return; }
    $('refresh').disabled = false; await refresh();
    // Observe bounded background work without making inference calls or reconnecting the game.
    const poll = setInterval(() => {
      if (pending.size === 0 && (snapshot?.status?.inFlight || snapshot?.continuity?.summaryScheduled)) void refresh();
    }, 1500);
    window.addEventListener('pagehide', () => clearInterval(poll), { once: true });
  } catch (error) {
    setPill($('connection'), 'Panel no disponible', 'warn'); announce('No se pudo preparar el creador. Actualiza el panel local.', true);
  }
}

if (typeof document !== 'undefined') initialize();
