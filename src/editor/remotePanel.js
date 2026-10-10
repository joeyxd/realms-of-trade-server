import { GmContentClient } from './contentClient.js';
import { editorMessage } from './messages.js';
import { onLocaleChange, setLocale } from '../core/locale.js';

const text = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A deliberate review step between the local workspace and the account's remote draft. */
export class RemoteDraftPanel {
  constructor(editor, client) {
    this.editor = editor; this.client = client; this.head = null; this.state = 'idle'; this.review = null; this.generation = 0;
    this.contentClient = client ? new GmContentClient({ auth: client.auth, accountId: client.accountId,
      httpBase: new URL('../../', client.url), localScope: client.key, source: client.source, fetchImpl: client.fetchImpl }) : null;
    this.content = null; this.contentReview = null; this.contentError = ''; this.contentBusy = false;
    this.button = editor.ui.querySelector('[data-action="remote"]');
    this.dialog = document.createElement('dialog'); this.dialog.className = 'gm-remote-dialog';
    this.unsubscribeLocale = onLocaleChange(() => this.render());
    this.dialog.setAttribute('aria-label', 'Borrador online / Online draft');
    editor.ui.appendChild(this.dialog);
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.hide(); });
    this.dialog.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = event.target.closest('[data-remote]')?.dataset.remote;
      if (action === 'close') this.hide();
      if (action === 'language') setLocale(editor.lang === 'es' ? 'en' : 'es');
      if (action === 'refresh') void this.refresh();
      if (action === 'export') editor._exportCurrent();
      if (action === 'export-remote') editor._exportDocument(this.head?.document, { name: `${editor.worldId}-online-r${this.head.revision}`, status: editorMessage('Server copy exported.', 'Se exportó la copia online.') });
      if (action === 'save' || action === 'load') { this.review = action; this.reviewDocument = editor.history.current(); this.render(); }
      if (action === 'cancel-review') { this.review = null; this.render(); }
      if (action === 'confirm') { if (this.review === 'save') void this.save(); else if (this.review === 'load') void this.load(); }
      if (action === 'retry') void this.save(true);
      if (action === 'prepare') void this.prepare();
      if (action === 'download-revision') this.downloadRevision();
      if (action === 'content-refresh') void this.refreshContent();
      if (action === 'content-register') void this.registerContent();
      if (action === 'content-activate') {
        const value = this.dialog.querySelector('[data-content-revision]')?.value;
        this.contentReview = { revisionId: value || null, expectedGeneration: this.content.active.generation }; this.render();
      }
      if (action === 'content-cancel') { this.contentReview = null; this.render(); }
      if (action === 'content-confirm') void this.activateContent();
      if (action === 'content-retry') void this.activateContent(true);
      if (action === 'content-reload') void editor.saveNow().then((saved) => { if (saved) location.reload(); });
      if (action === 'focus-issue') { this.hide(); editor.select(event.target.closest('[data-object-id]').dataset.objectId); editor._focusSelection(); }
    });
    this.render();
  }

  t(en, es) { return this.editor._t(en, es); }
  get busy() { return this.contentBusy || ['loading', 'saving', 'applying', 'preparing'].includes(this.state); }
  get open() { return this.dialog.open; }
  async start() {
    this.generation++; this.head = null; this.state = 'idle'; this.review = null; this.error = ''; this.prepared = null;
    this.client?.resume(); this.contentClient?.resume(); this.content = null; this.contentReview = null; this.contentApplied = null; this.contentError = ''; this.render();
    if (this.client) { await this.refresh(); await this.refreshContent(); }
  }
  stop() { this.generation++; this.client?.cancel(); this.contentClient?.cancel(); this.contentBusy = false; this.hide(); }
  show() {
    if (this.editor.walkPreview?.active) return;
    this.editor._cancelTransform(); this.editor.cameraController.disable(); this.editor.transform.enabled = false;
    if (!this.open) this.dialog.showModal();
    this.render();
  }
  hide() {
    if (this.open) this.dialog.close();
    this.review = null; this.contentReview = null;
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
      gm_preparation_unavailable: ['Preparation is unavailable or a model could not be verified. Your drafts are preserved.', 'La preparación no está disponible o no se pudo verificar un modelo. Tus borradores se conservan.'],
      gm_preparation_busy: ['The server is preparing another revision. Try again shortly.', 'El servidor está preparando otra revisión. Vuelve a intentar en un momento.'],
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
      this.editor.lastError = error;
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
      this.editor.lastError = error;
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
      this.editor.lastError = error;
      this.error = error.code || 'base'; this.state = 'unavailable';
    } finally { if (generation === this.generation) this.render(); }
  }

  async prepare() {
    if (this.busy || !this.canPrepare) return;
    const generation = this.generation, snapshot = this.head.document, revision = this.head.revision;
    this.prepared = null; this.review = null; this.state = 'preparing'; this.error = ''; this.render();
    try {
      const result = await this.client.prepareRevision(revision, snapshot);
      if (generation !== this.generation || !this.editor.active) return;
      this.prepared = { ...result.preparation, headRevision: revision, document: snapshot };
      this.state = 'ready';
    } catch (error) {
      if (generation !== this.generation || !this.editor.active) return;
      this.editor.lastError = error;
      this.error = error.code;
      this.state = this.client.pending ? 'pending' : error.code === 'gm_draft_conflict' ? 'conflict' : 'ready';
    } finally { if (generation === this.generation) this.render(); }
  }

  get canPrepare() {
    return !!this.client && !!this.head?.document && this.head.revision > 0 && this.compatible &&
      this.state === 'ready' && !this.client.pending && same(this.head.document, this.editor.history.current());
  }

  downloadRevision() {
    if (!this.prepared?.revision || !this.canPrepare) return;
    const revision = this.prepared.revision;
    const blob = new Blob([JSON.stringify(revision, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `gm-prepared-${revision.revisionId.slice(0, 12)}.json`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async contentAction(action) {
    if (this.busy || !this.contentClient) return;
    const generation = this.generation;
    this.contentBusy = true; this.contentError = ''; this.render();
    try {
      await action();
    } catch (error) {
      if (generation === this.generation && this.editor.active) this.contentError = error.code || 'gm_content_unavailable';
    } finally {
      if (generation === this.generation) { this.contentBusy = false; this.render(); }
    }
  }
  refreshContent() {
    const generation = this.generation;
    return this.contentAction(async () => {
      const result = await this.contentClient.inspect();
      if (generation === this.generation && this.editor.active) this.content = result;
    });
  }
  registerContent() {
    if (!this.canPrepare || !this.prepared?.revision) return;
    const generation = this.generation, id = this.prepared.revision.revisionId, revision = this.head.revision;
    return this.contentAction(async () => {
      const result = await this.contentClient.register(revision, id);
      if (generation === this.generation && this.editor.active) this.content = result;
    });
  }
  activateContent(retry = false) {
    if (!retry && !this.contentReview) return;
    const generation = this.generation, input = this.contentReview;
    this.contentReview = null;
    return this.contentAction(async () => {
      if (!await this.editor.saveNow()) throw Object.assign(new Error(), { code: 'local_recovery_unavailable' });
      const result = retry ? await this.contentClient.retry() : await this.contentClient.activate(input.revisionId, input.expectedGeneration);
      if (generation !== this.generation || !this.editor.active) return;
      this.content = await this.contentClient.inspect(); this.contentApplied = result;
    });
  }
  contentHtml(button) {
    if (!this.contentClient) return '';
    const data = this.content;
    const messages = {
      gm_content_busy: ['Players, a save, or an update are active. Try again when the world is empty.', 'Hay jugadores, un guardado o una actualización en curso. Reintenta cuando el mundo esté vacío.'],
      gm_content_conflict: ['The active revision changed. Refresh before choosing again.', 'Cambió la revisión activa. Actualiza antes de elegir otra vez.'],
      gm_content_changed: ['The preparation changed. Validate the saved design again.', 'La preparación cambió. Vuelve a validar el diseño guardado.'],
      gm_content_incompatible: ['This revision belongs to another code version. Activate the base before updating code.', 'Esta revisión pertenece a otra versión de código. Activa la base antes de actualizar el código.'],
      gm_content_candidate: ['This revision includes art candidates. Use integrated models for activation.', 'Esta revisión incluye candidatos de arte. Usa modelos integrados para activar.'],
      gm_content_routes: ['The revision blocks a protected route.', 'La revisión bloquea una ruta protegida.'],
      gm_content_occupied: ['The revision overlaps a saved boat or an item on the ground.', 'La revisión invade un barco guardado o un objeto en el suelo.'],
      gm_content_limit: ['Revision storage is full. Contact the server operator.', 'El archivo de revisiones está lleno. Contacta al operador del servidor.'],
    };
    const message = messages[this.contentError] || ['Revision storage is unavailable. Your draft is preserved.', 'El archivo de revisiones no está disponible. Tu borrador se conserva.'];
    const selected = this.contentSelection ?? data?.active.revisionId ?? '';
    return `<section class="gm-publication gm-content"><h3>${text(this.t('Published world', 'Mundo publicado'))}</h3>
      <p>${text(this.t('Activate only when no one is playing. Characters, goods and progress are preserved. Open tabs must reload.', 'Activa cuando nadie esté jugando. Se conservan personajes, bienes y progreso. Las pestañas abiertas deben recargar.'))}</p>
      ${this.contentError ? `<p class="gm-remote-error" role="alert">${text(this.t(...message))}</p>` : ''}
      ${data ? `<p data-content-active>${text(this.t('Active', 'Activa'))}: ${text(data.active.revisionId?.slice(0, 12) || this.t('Base map', 'Mapa base'))} · g${data.active.generation}</p>` : ''}
      ${button('content-refresh', this.t('Refresh revisions', 'Actualizar revisiones'), this.busy)}
      ${button('content-register', this.t('Save prepared revision', 'Guardar revisión preparada'), this.busy || !this.canPrepare || !this.prepared?.revision || !!this.contentClient.pending)}
      ${data ? `<label>${text(this.t('Saved revision', 'Revisión guardada'))}<select data-content-revision ${this.busy ? 'disabled' : ''}>
        <option value="">${text(this.t('Base map', 'Mapa base'))}</option>
        ${data.revisions.map((row) => `<option value="${row.revisionId}" ${selected === row.revisionId ? 'selected' : ''}>${row.revisionId.slice(0, 12)} · ${row.objects} ${text(this.t('models', 'modelos'))} · ${row.baseChanges} ${text(this.t('base changes', 'cambios'))}</option>`).join('')}</select></label>
        ${button('content-activate', this.t('Activate / roll back…', 'Activar / volver atrás…'), this.busy || !!this.contentClient.pending)}
        <p>${text(this.t('Saved revisions keep their files. Code updates require returning to the base if the runtime changes.', 'Las revisiones guardadas conservan sus archivos. Si cambia el runtime, hay que volver a la base para actualizar el código.'))}</p>` : ''}
      ${this.contentReview ? `<div class="gm-remote-review"><b>${text(this.t('Activate this revision for everyone?', '¿Activar esta revisión para todos?'))}</b>
        <p>${text(this.contentReview.revisionId?.slice(0, 12) || this.t('Base map', 'Mapa base'))} · g${this.contentReview.expectedGeneration}</p>
        ${button('content-confirm', this.t('Activate now', 'Activar ahora'), this.busy)} ${button('content-cancel', this.t('Cancel', 'Cancelar'), this.busy)}</div>` : ''}
      ${this.contentClient.pending ? `<p>${text(this.t('An activation response is pending. Retry the exact attempt before choosing another revision.', 'Hay una respuesta de activación pendiente. Reintenta el intento exacto antes de elegir otra revisión.'))}</p>${button('content-retry', this.t('Resolve pending activation', 'Resolver activación pendiente'), this.busy)}` : ''}
      ${this.contentApplied ? `<p role="status">${text(this.t('Activation confirmed. Reload to see the shared world.', 'Activación confirmada. Recarga para ver el mundo compartido.'))}</p>${button('content-reload', this.t('Save local draft and reload', 'Guardar borrador local y recargar'), this.busy)}` : ''}</section>`;
  }

  issueText(code) {
    const labels = {
      edit_limit: ['More than 1,000 edits', 'Más de 1.000 ediciones'], scale_limit: ['Scale exceeds 20', 'La escala supera 20'],
      radius_limit: ['Collision radius exceeds 20', 'El radio de colisión supera 20'], map_bounds: ['Outside the playable bounds', 'Fuera de los límites jugables'],
      unsupported_height: ['Too far above or below ground', 'Demasiado lejos del suelo'],
      protected_anchor_collision: ['Blocks a protected access', 'Bloquea un acceso protegido'],
      resource_collision: ['Blocks a resource or workbench', 'Bloquea un recurso o banco de trabajo'],
      path_collision: ['Blocks the main path', 'Bloquea el camino principal'],
      visual_only_objects: ['Some models have no collision', 'Hay modelos sin colisión'],
      circle_rotation_ignored: ['Circle collisions ignore tilt', 'Las colisiones circulares ignoran la inclinación'],
      candidate_assets: ['Includes art candidates awaiting review', 'Incluye candidatos de arte pendientes de revisión'],
    };
    return labels[code] ? this.t(...labels[code]) : this.t('Review this placement', 'Revisa esta colocación');
  }

  preparationHtml(button) {
    const result = this.prepared;
    const report = result?.report;
    return `<section class="gm-publication"><h3>${text(this.t('Prepare for publication', 'Preparar para publicar'))}</h3>
      <p>${text(this.t('Validate the saved design and download a revision with its exact models. Review the report before preparing a copy. The active world stays unchanged.', 'Valida el diseño guardado y descarga una revisión con sus modelos exactos. Revisa el informe antes de preparar una copia. El mundo activo se conserva.'))}</p>
      ${!this.canPrepare && this.state !== 'preparing' ? `<p>${text(this.t('Save your current design online before preparing it.', 'Guarda tu diseño actual online antes de prepararlo.'))}</p>` : ''}
      ${button('prepare', this.state === 'preparing' ? this.t('Validating…', 'Validando…') : this.t('Validate for publication', 'Validar para publicar'), this.busy || !this.canPrepare)}
      ${report ? `<div class="gm-publication-report" data-valid="${report.valid}" role="status"><b>${text(report.valid ? this.t('Revision prepared · not activated', 'Revisión preparada · sin activar') : this.t('Fix these problems before preparing', 'Corrige estos problemas antes de preparar'))}</b>
        <p>${report.summary.errors} ${text(report.summary.errors === 1 ? this.t('error', 'error') : this.t('errors', 'errores'))} · ${report.summary.warnings} ${text(report.summary.warnings === 1 ? this.t('warning', 'advertencia') : this.t('warnings', 'advertencias'))}</p>
        <ul>${report.issues.map((issue) => `<li data-severity="${issue.severity}">${text(this.issueText(issue.code))}${issue.anchorId ? ` · ${text(issue.anchorId)}` : ''}
          ${issue.objectId ? `<button type="button" data-remote="focus-issue" data-object-id="${text(issue.objectId)}" title="${text(this.t('Focus object', 'Enfocar objeto'))}">${text(issue.objectId)}</button>` : ''}</li>`).join('')}</ul>
        ${report.summary.omittedIssues ? `<p>${text(this.t('Additional findings:', 'Problemas adicionales:'))} ${report.summary.omittedIssues}</p>` : ''}
        ${result.revision ? `<code class="gm-revision-id">${text(result.revision.revisionId)}</code><p>${text(this.t('Metadata and hashes only. Models remain in the release assets. This package does not change the active world.', 'Solo metadatos y hashes. Los modelos permanecen en los assets de la release. Este paquete no cambia el mundo activo.'))}</p>${button('download-revision', this.t('Download prepared revision', 'Descargar revisión preparada'), !this.canPrepare)}` : ''}</div>` : ''}</section>`;
  }

  render() {
    const current = this.editor.history?.current();
    const matches = !!this.head?.document && same(current, this.head.document);
    if (this.prepared && (!matches || this.prepared.headRevision !== this.head?.revision)) this.prepared = null;
    const labels = {
      idle: this.t('Local workspace', 'Espacio local'), loading: this.t('Checking server…', 'Consultando servidor…'),
      saving: this.t('Waiting for confirmation…', 'Esperando confirmación…'), applying: this.t('Loading design…', 'Cargando diseño…'),
      preparing: this.t('Validating saved revision…', 'Validando revisión guardada…'),
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
        ${this.head?.document ? button('export-remote', this.t('Export server copy', 'Exportar copia online')) : ''}</footer>`}
      ${!this.review ? this.preparationHtml(button) + this.contentHtml(button) : ''}`;
    this.dialog.querySelector('[data-content-revision]')?.addEventListener('change', (event) => { this.contentSelection = event.target.value; this.contentReview = null; });
  }
  get runtimeMatches() { return !!this.remoteScope && this.remoteScope.seed === this.editor.map.seed && this.remoteScope.baseRevision === this.editor.baseRevision; }
  get compatible() { return this.runtimeMatches && (!this.head?.document || (this.head.document.base.seed === this.editor.map.seed && this.head.document.base.revision === this.editor.baseRevision)); }
  dispose() { this.unsubscribeLocale?.(); this.stop(); this.dialog.remove(); }
}
