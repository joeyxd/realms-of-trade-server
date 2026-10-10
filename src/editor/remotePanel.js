const text = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A deliberate review step between the local workspace and the account's remote draft. */
export class RemoteDraftPanel {
  constructor(editor, client) {
    this.editor = editor; this.client = client; this.head = null; this.state = 'idle'; this.review = null; this.generation = 0;
    this.button = editor.ui.querySelector('[data-action="remote"]');
    this.dialog = document.createElement('dialog'); this.dialog.className = 'gm-remote-dialog';
    this.dialog.setAttribute('aria-label', 'Borrador online / Online draft');
    editor.ui.appendChild(this.dialog);
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.hide(); });
    this.dialog.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = event.target.closest('[data-remote]')?.dataset.remote;
      if (action === 'close') this.hide();
      if (action === 'language') { editor.lang = editor.lang === 'es' ? 'en' : 'es'; editor._setLanguage(); }
      if (action === 'refresh') void this.refresh();
      if (action === 'export') editor._exportCurrent();
      if (action === 'export-remote') editor._exportDocument(this.head?.document, { name: `${editor.worldId}-online-r${this.head.revision}`, status: this.t('Server copy exported.', 'Se exportó la copia online.') });
      if (action === 'save' || action === 'load') { this.review = action; this.reviewDocument = editor.history.current(); this.render(); }
      if (action === 'cancel-review') { this.review = null; this.render(); }
      if (action === 'confirm') { if (this.review === 'save') void this.save(); else if (this.review === 'load') void this.load(); }
      if (action === 'retry') void this.save(true);
    });
    this.render();
  }

  t(en, es) { return this.editor._t(en, es); }
  get busy() { return ['loading', 'saving', 'applying'].includes(this.state); }
  get open() { return this.dialog.open; }
  async start() {
    this.generation++; this.head = null; this.state = 'idle'; this.review = null; this.error = '';
    this.client?.resume(); this.render();
    if (this.client) await this.refresh();
  }
  stop() { this.generation++; this.client?.cancel(); this.hide(); }
  show() {
    if (this.editor.walkPreview?.active) return;
    this.editor._cancelTransform(); this.editor.cameraController.disable(); this.editor.transform.enabled = false;
    if (!this.open) this.dialog.showModal();
    this.render();
  }
  hide() {
    if (this.open) this.dialog.close();
    this.review = null;
    if (this.editor.active && !this.editor.walkPreview?.active) { this.editor.cameraController.enable(); this.editor.transform.enabled = true; }
  }
  errorText(code) {
    const messages = {
      gm_draft_conflict: ['Another browser saved first. Refresh and review both designs before replacing the server draft.', 'Otro navegador guardó primero. Actualiza y revisa ambos diseños antes de sustituir el borrador online.'],
      gm_drafts_unavailable: ['Online drafts are unavailable on this server. Keep working locally and export a copy.', 'Los borradores online no están disponibles en este servidor. Puedes seguir localmente y exportar una copia.'],
      pending: ['A previous save has no confirmed response. Resolve it before sending another design.', 'Hay un guardado anterior sin respuesta confirmada. Resuélvelo antes de enviar otro diseño.'],
      local_recovery_unavailable: ['The local recovery store is unavailable. Export your design; online save requires recovery for safe retries.', 'La recuperación local no está disponible. Exporta el diseño; el guardado online necesita recuperación para reintentar con seguridad.'],
      auth: ['Sign in again with the same GM account to continue.', 'Inicia sesión de nuevo con la misma cuenta GM para continuar.'],
      base: ['This draft belongs to another base map. Export it for recovery.', 'Este borrador pertenece a otra base del mapa. Expórtalo para recuperarlo.'],
      document: ['The server rejected the document or its model references. Export it for review.', 'El servidor rechazó el documento o sus modelos. Expórtalo para revisarlo.'],
      gm_draft_rate: ['Too many requests. Wait a moment and try again.', 'Demasiadas solicitudes. Espera un momento y vuelve a intentar.'],
    };
    const message = messages[code];
    return message ? this.t(...message) : this.t('The server could not confirm this request. Your local design is preserved.', 'El servidor no pudo confirmar la solicitud. Tu diseño local se conserva.');
  }
  async refresh() {
    if (!this.client || this.busy) return;
    const generation = this.generation; this.state = 'loading'; this.review = null; this.error = ''; this.render();
    try {
      const result = await this.client.inspect();
      if (generation !== this.generation || !this.editor.active) return;
      this.head = result.head; this.durable = result.durable; this.remoteScope = result.scope;
      if (!this.compatible) this.error = 'base';
      this.state = this.client.pending ? 'pending' : !this.runtimeMatches ? 'incompatible' : 'ready';
    } catch (error) {
      if (generation !== this.generation || !this.editor.active) return;
      this.error = error.code; this.state = this.client.pending ? 'pending' : 'unavailable';
    } finally { if (generation === this.generation) this.render(); }
  }

  async save(retry = false) {
    if (this.busy || !this.client || (!retry && (!this.head || this.state === 'conflict'))) return;
    const generation = this.generation, snapshot = retry ? null : this.reviewDocument;
    if (!retry && (!snapshot || !same(snapshot, this.editor.history.current()))) { this.review = null; this.render(); return; }
    this.review = null; this.state = 'saving'; this.error = ''; this.render();
    try {
      const result = retry ? await this.client.retry() : await this.client.save(snapshot, this.head.revision);
      if (generation !== this.generation || !this.editor.active) return;
      this.head = result.head; this.durable = result.durable; this.state = 'ready';
      // A replay receipt can precede a newer save. Observe the actual head before offering replacement.
      if (result.replay) await this.refresh();
    } catch (error) {
      if (generation !== this.generation || !this.editor.active) return;
      this.error = error.code; this.state = this.client.pending ? 'pending' : error.code === 'gm_draft_conflict' ? 'conflict' : 'unavailable';
    } finally { if (generation === this.generation) this.render(); }
  }

  async load() {
    if (this.busy || !this.head?.document || this.client?.pending || !this.compatible) return;
    const generation = this.generation, snapshot = this.head.document;
    if (!same(this.reviewDocument, this.editor.history.current())) { this.review = null; this.render(); return; }
    this.review = null; this.state = 'applying'; this.error = ''; this.render();
    try {
      this.editor._validateBaseReferences(snapshot);
      // Finish model loading before changing history; failure leaves the current scene intact.
      await this.editor._hydrate(snapshot);
      if (generation !== this.generation || !this.editor.active) return;
      if (snapshot.objects.some((item) => !item.assetId.startsWith('base:') && !this.editor.assets.data(item.assetId))) throw Object.assign(new Error(), { code: 'document' });
      this.editor._clearGhost(); this.editor.transform.detach(); this.editor.selectedId = null;
      this.editor._commit(snapshot); this.state = 'ready';
      await this.editor.saveNow();
    } catch (error) {
      if (generation !== this.generation || !this.editor.active) return;
      this.error = error.code || 'base'; this.state = 'unavailable';
    } finally { if (generation === this.generation) this.render(); }
  }

  render() {
    const current = this.editor.history?.current();
    const matches = !!this.head?.document && same(current, this.head.document);
    const labels = {
      idle: this.t('Local workspace', 'Espacio local'), loading: this.t('Checking server…', 'Consultando servidor…'),
      saving: this.t('Waiting for confirmation…', 'Esperando confirmación…'), applying: this.t('Loading design…', 'Cargando diseño…'),
      ready: matches ? this.durable ? this.t('Saved on server', 'Guardado en servidor') : this.t('Saved in server memory (temporary)', 'Guardado en memoria del servidor (temporal)')
        : this.t('Local changes · server differs', 'Cambios locales · servidor distinto'),
      pending: this.t('Save response pending', 'Respuesta de guardado pendiente'), conflict: this.t('Version conflict', 'Conflicto de versión'),
      unavailable: this.t('Online unavailable · local preserved', 'Online no disponible · local conservado'),
      incompatible: this.t('Different base map · export available', 'Base del mapa distinta · puedes exportar'),
    };
    if (!this.client) labels.idle = this.t('Local editor · no online connection', 'Editor local · sin conexión online');
    this.button.textContent = this.t('Online', 'Online') + (this.head ? ` · r${this.head.revision}` : '');
    this.button.title = labels[this.state] || labels.idle;
    this.button.dataset.state = this.state;
    const count = (doc) => doc ? `${doc.objects.length} ${this.t('models', 'modelos')} · ${doc.baseOverrides.length} ${this.t('base changes', 'cambios de base')}` : this.t('No design yet', 'Todavía sin diseño');
    const button = (action, label, disabled = false) => `<button type="button" data-remote="${action}" ${disabled ? 'disabled' : ''}>${text(label)}</button>`;
    this.dialog.innerHTML = `<header><h2>${text(this.t('Private online draft', 'Borrador online privado'))}</h2>${button('language', this.t('Español', 'English'))}${button('close', this.t('Close', 'Cerrar'))}</header>
      <p class="gm-remote-state" role="status" data-state="${this.state}">${text(labels[this.state] || labels.idle)}</p>
      <div class="gm-remote-comparison"><section><b>${text(this.t('This browser', 'Este navegador'))}</b><p>${text(count(current))}</p></section>
      <section><b>${text(this.t('Server', 'Servidor'))}${this.head ? ` · r${this.head.revision}` : ''}</b><p>${text(count(this.head?.document))}</p></section></div>
      <p>${text(this.t('One draft per GM account and world. Online saves are explicit. This does not publish the map.', 'Un borrador por cuenta GM y mundo. El guardado online es explícito. Esto no publica el mapa.'))}</p>
      ${this.error ? `<p class="gm-remote-error" role="alert">${text(this.errorText(this.error))}</p>` : ''}
      ${this.client?.pending ? `<p>${text(this.t('Retry sends the original saved attempt, even if you have edited since. It never replaces the current local design.', 'Reintentar envía el intento original, aunque hayas editado después. Nunca sustituye tu diseño local actual.'))}</p>${button('retry', this.t('Resolve pending save', 'Resolver guardado pendiente'), this.busy)}` : ''}
      ${this.review ? `<section class="gm-remote-review"><strong>${text(this.review === 'save' ? this.t('Replace the server draft with this local design?', '¿Sustituir el borrador online con este diseño local?') : this.t('Load the server design into this browser?', '¿Cargar el diseño online en este navegador?'))}</strong>
        <p>${text(this.review === 'save' ? !this.compatible ? this.t('The server copy uses an older base. Export that copy before replacing it if you need to keep it.', 'La copia online usa otra base. Expórtala antes de sustituirla si quieres conservarla.') : this.t('The displayed server revision must still match. Other browsers will need to refresh.', 'La revisión mostrada debe seguir vigente. Los otros navegadores tendrán que actualizar.') : this.t('Your current design stays in Undo until you close the editor. Export it first if you want a separate backup.', 'Tu diseño actual queda en Deshacer hasta cerrar el editor. Expórtalo antes si quieres una copia separada.'))}</p>
        ${button('confirm', this.review === 'save' ? this.t('Save this design online', 'Guardar este diseño online') : this.t('Load and keep Undo', 'Cargar y conservar Deshacer'), this.busy)} ${button('cancel-review', this.t('Cancel', 'Cancelar'))}</section>` : `<footer>
        ${button('refresh', this.t('Refresh server', 'Actualizar servidor'), !this.client || this.busy)}
        ${button('save', this.t('Save online…', 'Guardar online…'), !this.head || this.busy || !!this.client?.pending || this.state !== 'ready')}
        ${button('load', this.t('Load online…', 'Cargar online…'), !this.head?.document || this.busy || !!this.client?.pending || this.state !== 'ready' || !this.compatible)}
        ${button('export', this.t('Export local copy', 'Exportar copia local'))}
        ${this.head?.document ? button('export-remote', this.t('Export server copy', 'Exportar copia online')) : ''}</footer>`}`;
  }
  get runtimeMatches() { return !!this.remoteScope && this.remoteScope.seed === this.editor.map.seed && this.remoteScope.baseRevision === this.editor.baseRevision; }
  get compatible() { return this.runtimeMatches && (!this.head?.document || (this.head.document.base.seed === this.editor.map.seed && this.head.document.base.revision === this.editor.baseRevision)); }
  dispose() { this.stop(); this.dialog.remove(); }
}
