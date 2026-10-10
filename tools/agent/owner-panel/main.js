(() => {
  'use strict';

  const FILES = ['personality', 'objectives', 'memory'];
  const FILE_LABELS = { personality: 'Personalidad', objectives: 'Objetivos', memory: 'Memoria' };
  const RUNNER_LABELS = { idle: 'En espera', connecting: 'Conectando', ready: 'En servicio', stopping: 'Deteniéndose', stopped: 'Detenido', exited: 'Finalizado', unavailable: 'No disponible' };
  const ACTIVITY_LABELS = { ready: 'Conexión lista', admitted: 'Personaje admitido', chat_state: 'Chat actualizado',
    mind_result: 'Reflexión', stop_response: 'Solicitud de detención', stopped: 'Personaje detenido', process_exit: 'Proceso finalizado',
    authority_rejected: 'Control rechazado', authority: 'Control actualizado', goals_result: 'Revisión de objetivos',
    memory_result: 'Recuerdo registrado', compaction_result: 'Resumen de memoria', conversation_result: 'Respuesta de conversación',
    inference_budget_notice: 'Límite de inferencia', action_effect: 'Efecto observado', action_result: 'Resultado de acción',
    body: 'Tarea corporal', movement: 'Movimiento', error: 'Error del controlador', rejected: 'Solicitud rechazada' };
  const $ = (id) => document.getElementById(id);
  let key = null;
  let snapshot = null;
  let currentFiles = null;
  let selectedFile = 'personality';
  let policyRevision = null;
  let policyDirty = false;
  let policyConflict = false;
  let requestInProgress = false;
  let mutationInProgress = false;

  function readKey() {
    const fragment = location.hash.slice(1);
    const match = fragment.match(/(?:^|&)key=([a-fA-F0-9]{64})(?:&|$)/);
    history.replaceState(null, '', location.pathname + location.search);
    return match ? match[1].toLowerCase() : null;
  }

  function announce(message, error = false) {
    const box = $('notice');
    box.textContent = message;
    box.classList.toggle('error', error);
    box.hidden = !message;
  }

  function fmt(value) {
    return Number.isSafeInteger(value) ? new Intl.NumberFormat('es-MX').format(value) : '—';
  }

  function date(value) {
    if (!Number.isFinite(value)) return '—';
    try { return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
    catch { return '—'; }
  }

  function setStatus(text, kind = 'muted') {
    const pill = $('connection');
    pill.textContent = text;
    pill.className = `pill ${kind}`;
  }

  function humanError(error) {
    const message = String(error?.message || 'Error desconocido.');
    const labels = {
      budget_revoked: 'Las llamadas nuevas están pausadas por el dueño.',
      budget_disabled: 'Las llamadas nuevas están pausadas por el dueño.',
      budget_expired: 'El periodo del presupuesto terminó.',
      max_calls: 'Se alcanzó el límite de llamadas.',
      max_tokens: 'No quedan tokens simulados disponibles.',
      max_cost_units: 'No quedan unidades simuladas disponibles.',
      entry_capacity: 'Se alcanzó el límite de entradas del presupuesto.',
      runner_unavailable: 'El personaje no está disponible en este momento.',
      already_running: 'El personaje ya está en marcha.',
      not_running: 'El personaje no está en marcha.',
      revision_conflict: 'La política cambió desde que se cargó.',
    };
    return labels[message] || labels[message.split(':')[0]] || message;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${key}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    let data;
    try { data = await response.json(); } catch { throw new Error(`Respuesta inválida (${response.status}).`); }
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.why || `No se pudo completar la solicitud (${response.status}).`);
      error.status = response.status;
      error.body = data;
      throw error;
    }
    return data;
  }

  function clearFiles(message = 'No se pudo leer el archivo.') {
    currentFiles = null;
    $('file-content').textContent = 'El contenido no está disponible.';
    $('file-meta').textContent = 'Sin archivo cargado';
    $('download').disabled = true;
    $('file-error').textContent = message;
    $('file-error').hidden = false;
  }

  function renderFiles(files) {
    currentFiles = files;
    $('file-error').hidden = true;
    const file = files?.[selectedFile];
    if (!file || typeof file.content !== 'string') return clearFiles('El archivo no está disponible en esta lectura.');
    $('file-content').textContent = file.content;
    $('file-meta').textContent = `${file.filename} · ${fmt(file.bytes)} bytes · SHA-256 ${String(file.sha256 || '').slice(0, 12)}…`;
    $('download').disabled = false;
  }

  function renderBudget(result) {
    const budget = result?.budget;
    if (!budget || budget.ok !== true || !budget.snapshot) {
      $('budget-state').textContent = 'No disponible';
      $('budget-state').className = 'pill warn';
      $('budget-note').textContent = budget?.why ? `Lectura no disponible: ${budget.why}` : 'No se pudo leer el presupuesto; las cifras son desconocidas.';
      for (const id of ['confirmed', 'held', 'unresolved', 'available']) $(id).textContent = 'Desconocido';
      $('period').textContent = 'Periodo desconocido';
      $('policy-revision').textContent = 'Revisión desconocida';
      policyRevision = null;
      $('enabled').disabled = true;
      $('save-policy').disabled = true;
      return;
    }
    const b = budget.snapshot;
    const t = b.totals || {};
    const p = b.persistence || {};
    const nowMs = result.capturedAtMs;
    const periodOpen = Number.isFinite(nowMs) && p.period && nowMs >= p.period.startsAtMs && nowMs < p.period.endsAtMs;
    const exhausted = t.calls >= b.limits?.maxCalls || t.availableTokens <= 0 || t.availableCostUnits <= 0 || t.entries >= b.limits?.maxEntries;
    const admitting = p.enabled === true && !p.admissionWhy && !t.overrun && periodOpen && !exhausted;
    const blockedReason = !p.enabled ? 'Llamadas pausadas' : t.overrun ? 'Exceso registrado' : !periodOpen ? 'Periodo no vigente' : exhausted ? 'Límite alcanzado' : p.admissionWhy ? humanError(new Error(p.admissionWhy)) : 'Admisión desconocida';
    $('budget-state').textContent = admitting ? 'Llamadas permitidas' : blockedReason;
    $('budget-state').className = `pill ${admitting ? 'good' : 'warn'}`;
    $('confirmed').textContent = `${fmt(t.confirmedTokens)} · ${fmt(t.confirmedCostUnits)}`;
    $('held').textContent = `${fmt(t.heldTokens)} · ${fmt(t.heldCostUnits)}`;
    $('unresolved').textContent = `${fmt(t.unresolvedTokens)} · ${fmt(t.unresolvedCostUnits)}`;
    $('available').textContent = `${fmt(t.availableTokens)} tokens · ${fmt(t.availableCostUnits)} unidades`;
    $('period').textContent = p.period ? `Vigente del ${date(p.period.startsAtMs)} al ${date(p.period.endsAtMs)}` : 'Periodo no informado';
    $('budget-note').textContent = `${fmt(t.calls)} llamadas registradas · ${fmt(t.unknownEntries)} entradas sin resolver${t.overrun ? ' · Se registró un exceso' : ''}${p.admissionWhy ? ` · ${humanError(new Error(p.admissionWhy))}` : ''}`;
    $('policy-revision').textContent = `Revisión ${fmt(p.revision)}`;
    $('enabled').disabled = mutationInProgress;
    $('save-policy').disabled = mutationInProgress || policyConflict;
    if (!policyDirty) {
      policyRevision = Number.isSafeInteger(p.revision) ? p.revision : null;
      $('enabled').checked = p.enabled === true;
      for (const name of ['maxCalls', 'maxTokens', 'maxCostUnits', 'maxEntries']) $(name).value = b.limits?.[name] ?? '';
      $('draft-state').textContent = 'La política cargada está al día.';
      policyConflict = false;
      $('draft-state').style.color = '';
    }
  }

  function renderRunner(runner) {
    if (!runner || typeof runner !== 'object') {
      $('runner-state').textContent = 'Desconocido';
      $('runner-summary').textContent = 'El servidor no informó el estado del personaje.';
      $('runner-badge').textContent = 'Estado desconocido';
      $('runner-badge').className = 'pill muted';
      for (const id of ['start', 'stop', 'think']) $(id).disabled = true;
      return;
    }
    const state = RUNNER_LABELS[runner.state] || 'Desconocido';
    const running = runner.processRunning === true;
    $('runner-state').textContent = state;
    $('runner-badge').textContent = state;
    $('runner-badge').className = `pill ${runner.state === 'ready' ? 'good' : ['unavailable', 'exited'].includes(runner.state) ? 'warn' : 'muted'}`;
    const parts = [];
    if (typeof runner.model === 'string') parts.push(`${runner.model}${runner.model === 'simulated-mind-v1' ? ' · mente simulada, unidades de laboratorio' : ''}`);
    else parts.push('Modelo no informado');
    parts.push(runner.authority === 'local_runner_only' ? 'Control local del personaje' : runner.authority === 'server_controller' ? 'Control del servidor' : 'Autoridad no informada');
    parts.push(running ? 'Proceso activo' : 'Proceso detenido');
    if (runner.termination?.reason) parts.push(`Motivo de cierre: ${runner.termination.reason}`);
    if (runner.lastError) parts.push(`Último error: ${runner.lastError}`);
    $('runner-summary').textContent = parts.join(' · ');
    $('authority').textContent = runner.authority === 'local_runner_only' ? 'Control local' : runner.authority === 'server_controller' ? 'Control del servidor' : 'Autoridad desconocida';
    $('requests').textContent = Number.isSafeInteger(runner.requests) ? fmt(runner.requests) : 'Desconocido';
    $('observation').textContent = runner.observation ? `Tick ${fmt(runner.observation.tick)}` : 'Sin dato';
    $('observation-detail').textContent = runner.observation ? `Revisión ${fmt(runner.observation.revision)} · recibida ${date(runner.observation.receivedAtMs)}` : 'No hay observación reciente.';
    $('start').disabled = mutationInProgress || (running && runner.state !== 'stopped') || !['idle', 'stopped', 'exited'].includes(runner.state);
    $('stop').disabled = mutationInProgress || !running || runner.state === 'unavailable';
    $('think').disabled = mutationInProgress || !running || runner.state !== 'ready' || runner.inFlight === true;
    const tasks = Array.isArray(runner.tasks) ? runner.tasks : [];
    $('task-count').textContent = `${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'}`;
    const list = document.createElement('ul'); list.className = 'task-list';
    for (const task of tasks.slice(-8).reverse()) {
      const item = document.createElement('li');
      const type = document.createElement('span'); type.className = 'task-type'; type.textContent = task.type || 'Tarea';
      const stateText = document.createElement('span'); stateText.className = 'task-state'; stateText.textContent = task.state || 'Estado desconocido';
      item.append(type, stateText); list.append(item);
    }
    $('tasks').replaceChildren(...(tasks.length ? [list] : [Object.assign(document.createElement('div'), { className: 'empty-state', textContent: 'Sin tareas disponibles.' })]));
    renderActivity(runner.activity);
  }

  function renderActivity(activity) {
    const host = $('activity');
    if (!Array.isArray(activity) || activity.length === 0) {
      host.className = 'empty-state'; host.textContent = 'Sin actividad disponible.'; return;
    }
    const list = document.createElement('ul'); list.className = 'activity-list';
    for (const event of activity.slice(-12).reverse()) {
      const item = document.createElement('li');
      const main = document.createElement('div');
      const kind = document.createElement('span'); kind.className = 'activity-type'; kind.textContent = ACTIVITY_LABELS[event.type] || 'Evento del personaje'; main.append(kind);
      if (event.why) { const why = document.createElement('span'); why.className = 'activity-why'; why.textContent = humanError(new Error(event.why)); main.append(why); }
      const result = document.createElement('span'); result.className = `event-result ${event.ok === true ? 'ok' : event.ok === false ? 'fail' : ''}`; result.textContent = event.ok === true ? 'Correcto' : event.ok === false ? 'Con incidencia' : 'Sin resultado';
      const when = document.createElement('time'); when.className = 'event-when'; when.textContent = date(event.atMs);
      item.append(main, result, when); list.append(item);
    }
    host.className = ''; host.replaceChildren(list);
  }

  function render(result) {
    snapshot = result;
    const scope = result.scope || {};
    $('character').textContent = scope.characterId || 'Personaje no informado';
    $('scope-detail').textContent = `Dueño ${scope.ownerId || 'desconocido'} · Mundo ${scope.worldId || 'desconocido'}`;
    $('checked-at').textContent = date(result.capturedAtMs);
    $('checked-at').dateTime = Number.isFinite(result.capturedAtMs) ? new Date(result.capturedAtMs).toISOString() : '';
    renderRunner(result.runner);
    renderBudget(result);
    if (result.files?.ok === true && result.files.files) renderFiles(result.files.files);
    else clearFiles(result.files?.why ? `Lectura fallida: ${result.files.why}` : 'No se pudieron leer los archivos.');
  }

  async function refreshView(manual = false) {
    if (!key || requestInProgress || mutationInProgress) return;
    requestInProgress = true;
    $('refresh').disabled = true;
    try {
      const result = await api('/api/view');
      render(result);
      setStatus('Conectado', 'good');
      if (manual) announce('Lectura actualizada.');
    } catch (error) {
      snapshot = null;
      setStatus('Lectura no disponible', 'warn');
      $('checked-at').textContent = 'Sin lectura nueva';
      $('character').textContent = 'Lectura no disponible';
      $('scope-detail').textContent = 'No se pudo confirmar el alcance actual.';
      $('runner-state').textContent = 'Desconocido';
      $('runner-summary').textContent = 'El servidor no respondió con un estado reciente.';
      $('runner-badge').textContent = 'Lectura no disponible';
      $('runner-badge').className = 'pill warn';
      $('authority').textContent = 'Autoridad desconocida';
      $('requests').textContent = 'Desconocido';
      $('observation').textContent = 'Sin lectura';
      $('observation-detail').textContent = 'No se pudo consultar el mundo.';
      $('tasks').textContent = 'Lectura no disponible.';
      $('activity').textContent = 'Lectura no disponible.';
      for (const id of ['start', 'stop', 'think']) $(id).disabled = true;
      renderBudget(null);
      clearFiles('Lectura fallida; el contenido anterior se borró.');
      if (manual) announce(`No se pudo actualizar: ${error.message}`, true);
    } finally {
      requestInProgress = false;
      $('refresh').disabled = false;
    }
  }

  async function mutate(path, body, label) {
    if (!key || mutationInProgress) return;
    mutationInProgress = true;
    for (const id of ['start', 'stop', 'think', 'save-policy', 'refresh', 'reload-policy', 'enabled', 'maxCalls', 'maxTokens', 'maxCostUnits', 'maxEntries']) $(id).disabled = true;
    while (requestInProgress) await new Promise((resolve) => window.setTimeout(resolve, 20));
    try {
      const result = await api(path, { method: 'POST', body: JSON.stringify(body) });
      if (path === '/api/stop') {
        const confirmation = result.confirmation;
        if (!result.confirmed || confirmation === 'unproven') announce('El cierre local no quedó plenamente confirmado. La cola del servidor solo se considera revocada si el servidor lo confirmó.', true);
        else if (confirmation === 'server_queue') announce('El servidor confirmó la revocación de la cola.');
        else if (confirmation === 'local_runner') announce('El controlador local confirmó la detención del personaje. La cola del servidor conserva su confirmación independiente.');
        else announce('Solicitud de detención completada.');
      } else if (path === '/api/think') {
        announce('Reflexión simulada solicitada. Su resultado aparecerá en la bitácora.');
      } else announce(`${label} completado.`);
      if (path === '/api/configure') {
        policyDirty = false;
        $('draft-state').textContent = 'La política cargada está al día.';
      }
    } catch (error) {
      const conflict = error.status === 409 || /revision|conflict|stale/i.test(error.message);
      if (path === '/api/configure' && conflict) {
        policyDirty = true;
        policyConflict = true;
        $('draft-state').textContent = 'Conflicto de revisión. Recarga la política explícitamente antes de guardar.';
        $('draft-state').style.color = 'var(--gold)';
        announce('La política cambió desde que se cargó. Tu borrador se conserva; usa “Recargar política” para revisar la revisión nueva antes de guardar.', true);
      } else if (path === '/api/stop' && error.status === 409) {
        announce('Detención pendiente: no hay recibo confirmado. La respuesta 409 no confirma el cierre del proceso ni la revocación de la cola del servidor.', true);
      } else announce(`${label}: ${humanError(error)}`, true);
    } finally {
      mutationInProgress = false;
      await refreshView(false);
      $('reload-policy').disabled = false;
      for (const id of ['maxCalls', 'maxTokens', 'maxCostUnits', 'maxEntries']) $(id).disabled = !snapshot?.budget?.ok;
      if (!snapshot?.budget?.ok) $('enabled').disabled = true;
      else $('enabled').disabled = false;
      $('save-policy').disabled = policyConflict || !snapshot?.budget?.ok;
    }
  }

  function policyChanged() {
    policyDirty = true;
    $('draft-state').textContent = 'Borrador sin guardar · se conserva al actualizar la vista.';
    $('draft-state').style.color = 'var(--gold)';
  }

  async function refreshPolicy() {
    if (policyDirty && !window.confirm('Descartar el borrador y cargar la política más reciente?')) return;
    policyDirty = false;
    policyConflict = false;
    $('draft-state').style.color = '';
    await refreshView(true);
  }

  async function reloadFile() { await refreshView(true); }

  async function downloadFile() {
    const fileId = selectedFile;
    if (!key || !FILES.includes(fileId)) return;
    $('download').disabled = true;
    try {
      const response = await fetch(`/api/download/${fileId}`, { headers: { Authorization: `Bearer ${key}` } });
      if (!response.ok) throw new Error(`Descarga no disponible (${response.status}).`);
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${fileId}.${fileId === 'personality' ? 'md' : fileId === 'objectives' ? 'json' : 'jsonl'}`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      announce(`${FILE_LABELS[fileId]} exportada.`);
    } catch (error) { announce(`No se pudo exportar: ${error.message}`, true); }
    finally { $('download').disabled = !currentFiles?.[fileId]; }
  }

  function selectFile(file) {
    if (!FILES.includes(file)) return;
    selectedFile = file;
    for (const tab of document.querySelectorAll('[data-file]')) {
      const active = tab.dataset.file === file;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    if (currentFiles) renderFiles(currentFiles);
    else clearFiles('Sin lectura disponible para este archivo.');
  }

  function bind() {
    $('refresh').addEventListener('click', () => refreshView(true));
    $('file-refresh').addEventListener('click', reloadFile);
    $('download').addEventListener('click', downloadFile);
    document.querySelectorAll('[data-file]').forEach((tab) => tab.addEventListener('click', () => selectFile(tab.dataset.file)));
    for (const name of ['enabled', 'maxCalls', 'maxTokens', 'maxCostUnits', 'maxEntries']) $(name).addEventListener('input', policyChanged);
    $('policy-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (policyRevision === null) return announce('No hay una revisión cargada. Recarga la política antes de guardar.', true);
      const limits = {};
      for (const name of ['maxCalls', 'maxTokens', 'maxCostUnits', 'maxEntries']) {
        const value = Number($(name).value);
        if (!Number.isSafeInteger(value) || value < 1 || (name === 'maxEntries' && value > 256)) return announce('Revisa los límites: deben ser enteros positivos y las entradas no pueden superar 256.', true);
        limits[name] = value;
      }
      mutate('/api/configure', { expectedRevision: policyRevision, enabled: $('enabled').checked, limits }, 'Guardar límites');
    });
    $('start').addEventListener('click', () => mutate('/api/start', {}, 'Inicio'));
    $('stop').addEventListener('click', () => mutate('/api/stop', {}, 'Detención'));
    $('think').addEventListener('click', () => mutate('/api/think', {}, 'Reflexión'));
    $('reload-policy').addEventListener('click', refreshPolicy);
  }

  bind();
  key = readKey();
  if (!key) {
    setStatus('Acceso inválido', 'bad');
    announce('Falta el acceso seguro en el enlace inicial. Solicita un enlace válido al administrador local.', true);
    $('runner-state').textContent = 'Sin acceso';
    $('runner-summary').textContent = 'No se consultó el servidor.';
    clearFiles('No se consultó el servidor.');
    renderBudget(null);
  } else {
    setStatus('Conectando', 'muted');
    refreshView(false);
    window.setInterval(() => { if (!requestInProgress && !mutationInProgress) refreshView(false); }, 3000);
  }
})();
