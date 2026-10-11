import { onLocaleChange } from '../core/locale.js';
import { createTemplate, createTemplateLibrary, MAX_TEMPLATES, parseTemplateLibrary, validateTemplate } from './templates.js';
import { TemplateStore } from './templateStore.js';

const labels = {
  title: ['Private templates', 'Plantillas privadas'], search: ['Search templates', 'Buscar plantillas'], name: ['Template name', 'Nombre de plantilla'],
  save: ['Save selection', 'Guardar selección'],
  import: ['Import library', 'Importar biblioteca'], export: ['Export library', 'Exportar biblioteca'],
  retrySave: ['Retry save', 'Reintentar guardado'],
  retry: ['Retry load', 'Reintentar carga'], reload: ['Discard pending changes and reload', 'Descartar cambios pendientes y recargar'],
  confirmReload: ['Confirm discard and reload', 'Confirmar descarte y recargar'], cancel: ['Cancel', 'Cancelar'],
  rename: ['Rename selected', 'Renombrar seleccionada'], delete: ['Delete selected', 'Eliminar seleccionada'],
  confirmDelete: ['Confirm delete', 'Confirmar eliminación'], place: ['Place selected', 'Colocar seleccionada'],
  empty: ['No templates yet.', 'Aún no hay plantillas.'],
  loading: ['Loading private templates…', 'Cargando plantillas privadas…'],
  localOnly: ['Saved locally in this browser for this world.', 'Guardado localmente en este navegador para este mundo.'],
  sameBase: ['Templates are limited to this base map.', 'Las plantillas solo sirven en esta base del mapa.'],
  unavailable: ['Library unavailable. Editing can continue; retry the load.', 'Biblioteca no disponible. Puedes seguir editando; reintenta la carga.'],
  corrupt: ['The library is damaged. It was left untouched; retry after resolving storage.', 'La biblioteca está dañada. Se conservó intacta; reintenta al resolver el almacenamiento.'],
  conflict: ['Another tab changed this library. Your pending copy is preserved; export or retry, or explicitly reload.', 'Otra pestaña cambió esta biblioteca. Se conservó tu copia pendiente; exporta o reintenta, o recarga explícitamente.'],
  pending: ['Unsaved library changes are preserved in this editor. Retry or export them.', 'Los cambios pendientes se conservan en este editor. Reintenta o expórtalos.'],
  saved: ['Library saved locally.', 'Biblioteca guardada localmente.'],
  select: ['Select 1–120 visible decorations to save.', 'Selecciona de 1 a 120 decoraciones visibles para guardar.'],
  max: ['The library already has 32 templates.', 'La biblioteca ya tiene 32 plantillas.'],
  base: ['This file belongs to a different base map.', 'Este archivo pertenece a otra base del mapa.'],
  imported: ['Templates were added to the library.', 'Se añadieron plantillas a la biblioteca.'],
  deleted: ['Template deleted.', 'Plantilla eliminada.'],
  renamed: ['Template renamed.', 'Plantilla renombrada.'],
  invalid: ['The operation failed. Your pending copy is preserved; export it or retry.', 'La operación falló. Se conserva la copia pendiente; expórtala o reintenta.'],
  confirmDeleteText: ['Delete this template from the private library?', '¿Eliminar esta plantilla de la biblioteca privada?'],
};
// The panel instance belongs to the editor and remains mounted across close/reopen.
labels.deletePrompt = ['Delete "{name}" from this private library?', '¿Eliminar «{name}» de esta biblioteca privada?'];
labels.localScope = ['Private to this browser account and world.', 'Privada para esta cuenta de navegador y este mundo.'];
labels.incompatible = ['This library belongs to another base map. Export is available; it was not saved here.', 'Esta biblioteca pertenece a otra base. Puedes exportarla; no se guardó aquí.'];

labels.invalid = ['The operation failed. Check the file or selection and try again.', 'La operaci\u00f3n fall\u00f3. Revisa el archivo o la selecci\u00f3n e int\u00e9ntalo de nuevo.'];
labels.nameRequired = ['Enter a template name first.', 'Escribe primero el nombre de la plantilla.'];
labels.invalidData = ['The template data is invalid. Check the selection or file and try again.', 'Los datos de la plantilla no son v\u00e1lidos. Revisa la selecci\u00f3n o el archivo e int\u00e9ntalo de nuevo.'];

const uuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) return [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, '0')).join('');
  throw Object.assign(new Error('Template IDs need secure randomness.'), { code: 'template_id_factory' });
};

/** Private, local template library UI. The editor owns placement and ghost rendering. */
export class TemplatePanel {
  constructor(editor, root) {
    this.editor = editor; this.root = root; this.library = createTemplateLibrary(); this.revision = 0;
    this.selectedTemplate = null; this.pendingLibrary = null; this.pendingRevision = null;
    this.loadError = null; this.state = 'loading'; this.busy = false; this.filter = '';
    this.deleteConfirmation = false; this.reloadConfirmation = false; this.renderedList = '';
    this.store = null; this.generation = 0; this.started = false;
    this.element = document.createElement('section'); this.element.className = 'gm-template-panel'; this.element.dataset.templatePanel = '';
    this._build(); root.appendChild(this.element);
    this.unsubscribeLocale = onLocaleChange(() => this.update());
  }

  t(key) { const pair = labels[key] || labels.invalid; return this.editor._t(pair[0], pair[1]); }
  _node(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) {
      if (name === 'className') node.className = value;
      else if (name === 'dataset') Object.assign(node.dataset, value);
      else if (name === 'type' || name === 'placeholder' || name === 'aria-label' || name === 'accept') node.setAttribute(name, value);
    }
    return node;
  }
  _button(action, label) { return this._node('button', label, { type: 'button', dataset: { templateAction: action } }); }
  _build() {
    this.title = this._node('h3', this.t('title'));
    this.search = this._node('input', null, { type: 'search', placeholder: this.t('search'), 'aria-label': this.t('search') });
    this.search.dataset.templateSearch = '';
    this.name = this._node('input', null, { type: 'text', placeholder: this.t('name'), 'aria-label': this.t('name') });
    this.name.dataset.templateName = ''; this.name.maxLength = 64;
    this.status = this._node('p', this.t('loading'), { className: 'gm-template-status' });
    this.status.dataset.templateStatus = ''; this.status.setAttribute('role', 'status');
    this.hint = this._node('p', this.t('localScope') + ' ' + this.t('sameBase'), { className: 'gm-template-hint' }); this.hint.dataset.templateHint = '';
    this.count = this._node('p', '0'); this.count.dataset.templateCount = '';
    this.list = this._node('div', null, { className: 'gm-template-list' }); this.list.dataset.templateList = '';
    this.file = this._node('input', null, { type: 'file', accept: 'application/json,.json', 'aria-label': this.t('import') }); this.file.dataset.templateFile = '';
    this.actions = this._node('div', null, { className: 'gm-template-actions' });
    for (const [action, key] of [['save', 'save'], ['rename', 'rename'], ['delete', 'delete'], ['place', 'place'], ['export', 'export'], ['import', 'import'], ['retry-save', 'retrySave'], ['retry-load', 'retry']]) this.actions.append(this._button(action, this.t(key)));
    this.confirmations = this._node('div', null, { className: 'gm-template-confirmations' });
    this.element.append(this.title, this.search, this.name, this.status, this.hint, this.count, this.list, this.file, this.actions, this.confirmations);
    this.element.addEventListener('click', (event) => { event.stopPropagation(); void this._click(event); });
    this.element.addEventListener('input', (event) => { event.stopPropagation(); if (event.target === this.search) { this.filter = this.search.value; this._renderList(); } });
    this.element.addEventListener('change', (event) => { event.stopPropagation(); if (event.target === this.file) void this._importFile(); });
    this.element.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target === this.name) { event.stopPropagation(); void (this.selectedTemplate ? this.rename() : this.saveSelection()); } });
  }

  async start() {
    if (this.pendingLibrary) { this.started = true; this.state = this.state === 'conflict' ? 'conflict' : 'ready'; this.update(); return false; }
    this.started = true; const generation = ++this.generation; this.state = 'loading'; this.update();
    try {
      this.store ||= new TemplateStore({ worldId: this.editor.worldId });
      const result = await this.store.load();
      if (!this.started || generation !== this.generation) return false;
      this.revision = result.revision; this.library = result.library; this.pendingLibrary = null; this.pendingRevision = null;
      this.selectedTemplate = this.selectedTemplate && result.library.templates.find((item) => item.id === this.selectedTemplate.id) || null;
      this.deleteConfirmation = false;
      this.loadError = null;
      this.state = result.library.templates.some((item) => item.base.seed !== (this.editor.map.seed >>> 0) || item.base.revision !== this.editor.baseRevision) ? 'incompatible' : 'ready';
      this.update(); return this.state === 'ready';
    } catch (error) {
      if (!this.started || generation !== this.generation) return false;
      this.loadError = error; this.state = error?.code === 'template_stored_record' || error?.code === 'template_stored_library' ? 'corrupt' : 'unavailable';
      this.update(); return false;
    }
  }

  _currentLibrary() { return this.pendingLibrary || this.library; }
  _errorStatus(error) {
    if (error?.code === 'template_revision_conflict') return 'conflict';
    if (error?.code === 'template_indexeddb_unavailable' || error?.code === 'template_source' || error?.code === 'template_indexeddb_open') return 'unavailable';
    if (error?.code === 'template_base') return 'base';
    if (error?.code === 'template_library_limit') return 'max';
    if (['template_selection', 'template_document', 'template_transform', 'template_format', 'template_member', 'template_json', 'template_size', 'template_library_format', 'template_duplicate_template'].includes(error?.code)) return 'invalidData';
    return 'invalid';
  }
  _editorCanMutate() { return !!this.editor.active && !this.editor.walkPreview?.active && !this.editor.dragging && !this.editor.importTask; }
  _editorCanSelectTemplate() { return !!this.editor.active && !this.editor.walkPreview?.active && !this.editor.dragging && !this.editor.importTask; }
  _setStatus(key) {
    const detail = ['unavailable', 'corrupt', 'conflict', 'loading'].includes(key) ? '' : ` ${this.t('sameBase')}`;
    this.status.textContent = this.t(key) + detail; this.status.dataset.state = key;
  }
  update() {
    if (!this.element) return;
    this.title.textContent = this.t('title'); this.search.placeholder = this.t('search'); this.search.setAttribute('aria-label', this.t('search'));
    this.name.placeholder = this.t('name'); this.name.setAttribute('aria-label', this.t('name'));
    this.file.setAttribute('aria-label', this.t('import')); this.hint.textContent = this.t('localScope') + ' ' + this.t('sameBase');
    const keys = ['save', 'rename', 'delete', 'place', 'export', 'import', 'retrySave', 'retry'];
    const actions = [...this.actions.children]; keys.forEach((key, index) => { actions[index].textContent = this.t(key); });
    let key = this.status.dataset.state || (this.state === 'loading' ? 'loading' : 'localOnly');
    if (this.state === 'corrupt') key = 'corrupt'; else if (this.state === 'unavailable') key = 'unavailable';
    else if (this.state === 'conflict') key = 'conflict'; else if (this.state === 'incompatible') key = 'incompatible'; else if (this.pendingLibrary) key = 'pending';
    else if (this.state === 'ready' && key === 'loading') key = 'localOnly';
    this._setStatus(key);
    const lib = this._currentLibrary(); this.count.textContent = `${lib.templates.length} / ${MAX_TEMPLATES}`;
    const canMutate = !this.busy && !this.pendingLibrary && this.state === 'ready' && this.started && this._editorCanMutate();
    const canPlace = !!this.selectedTemplate && !this.busy && !this.pendingLibrary && this.state === 'ready' && this.started && this._editorCanSelectTemplate() && !this.editor.templateLoading && !this.editor.pendingTemplate;
    const selection = this.editor._selectedItems?.() || [];
    this.actions.querySelector('[data-template-action="save"]').disabled = !canMutate || !selection.length || selection.length > 120 || selection.some((item) => item.hidden);
    this.actions.querySelector('[data-template-action="rename"]').disabled = !canMutate || !this.selectedTemplate;
    this.actions.querySelector('[data-template-action="delete"]').disabled = !canMutate || !this.selectedTemplate;
    this.actions.querySelector('[data-template-action="place"]').disabled = !canPlace;
    this.actions.querySelector('[data-template-action="import"]').disabled = !canMutate;
    this.actions.querySelector('[data-template-action="retry-load"]').hidden = !['unavailable', 'corrupt', 'incompatible'].includes(this.state);
    this.actions.querySelector('[data-template-action="retry-load"]').disabled = this.busy || !this.started || !this._editorCanMutate();
    this.actions.querySelector('[data-template-action="retry-save"]').hidden = !this.pendingLibrary;
    this.actions.querySelector('[data-template-action="retry-save"]').disabled = this.busy || !this.started || !this._editorCanMutate();
    this.actions.querySelector('[data-template-action="export"]').disabled = !lib.templates.length && !this.pendingLibrary;
    this.search.disabled = this.state === 'loading'; this.name.disabled = !canMutate; this.file.disabled = !canMutate;
    this._renderList(); this._renderConfirmations();
  }

  _renderList() {
    const lib = this._currentLibrary(), filter = this.filter.trim().toLocaleLowerCase();
    const visible = lib.templates.filter((template) => template.name.toLocaleLowerCase().includes(filter));
    const signature = JSON.stringify([visible.map((template) => [template.id, template.name, template.objects.length]), this.selectedTemplate?.id, this.t('empty')]);
    const canSelect = this.started && this.state === 'ready' && !this.busy && !this.pendingLibrary && this._editorCanSelectTemplate();
    if (signature === this.renderedList) {
      for (const button of this.list.children) if (button.dataset?.templateId) button.disabled = !canSelect;
      return;
    }
    this.renderedList = signature; this.list.replaceChildren();
    for (const template of visible) {
      const button = this._button('select', `${template.name} · ${template.objects.length}`);
      button.dataset.templateId = template.id; button.setAttribute('aria-pressed', String(this.selectedTemplate?.id === template.id)); button.disabled = !canSelect;
      this.list.append(button);
    }
    if (!visible.length) this.list.append(this._node('p', this.t('empty')));
  }
  _renderConfirmations() {
    this.confirmations.replaceChildren();
    if (this.deleteConfirmation) {
      this.confirmations.append(this._node('p', this.t('deletePrompt').replace('{name}', this.selectedTemplate?.name || '')),
        this._button('confirm-delete', this.t('confirmDelete')), this._button('cancel-delete', this.t('cancel')));
    }
    if (this.reloadConfirmation) this.confirmations.append(
      this._node('p', this.t('pending')),
      this._button('discard-reload', this.t('confirmReload')), this._button('cancel-reload', this.t('cancel')));
    if (this.pendingLibrary) this.confirmations.append(this._button('reload-confirm', this.t('reload')));
  }

  async _click(event) {
    const target = event.target.closest?.('[data-template-action], [data-template-id]'); if (!target) return;
    if (target.dataset.templateId) {
      if (this.state !== 'ready' || this.busy || this.pendingLibrary || !this._editorCanSelectTemplate()) return;
      const template = this._currentLibrary().templates.find((item) => item.id === target.dataset.templateId);
      if (!template) return;
      this.selectedTemplate = template; this.name.value = template.name; this.deleteConfirmation = false; this.update();
      await this.editor._selectTemplate?.(template); return;
    }
    const action = target.dataset.templateAction;
    if (target.disabled) return;
    if (['save', 'rename', 'delete', 'confirm-delete', 'import', 'retry-save', 'retry-load', 'reload-confirm', 'discard-reload'].includes(action) && !this._editorCanMutate()) return;
    if (action === 'save') await this.saveSelection();
    else if (action === 'rename') await this.rename();
    else if (action === 'delete') { this.deleteConfirmation = true; this.update(); }
    else if (action === 'confirm-delete') await this.deleteSelected();
    else if (action === 'cancel-delete') { this.deleteConfirmation = false; this.update(); }
    else if (action === 'place' && this.selectedTemplate) await this.editor._selectTemplate?.(this.selectedTemplate);
    else if (action === 'export') this.downloadExport();
    else if (action === 'import') this.file.click();
    else if (action === 'retry-save') await this.retrySave();
    else if (action === 'retry-load') await this.retryLoad();
    else if (action === 'reload-confirm') { this.reloadConfirmation = true; this.update(); }
    else if (action === 'discard-reload') { this.reloadConfirmation = false; await this.reloadDiscardingPending(); }
    else if (action === 'cancel-reload') { this.reloadConfirmation = false; this.update(); }
  }

  async _persist(candidate, successKey) {
    if (this.busy || this.pendingLibrary || !['ready', 'conflict'].includes(this.state) || !this.started || !this._editorCanMutate()) return false;
    // A library edit supersedes its placement preview, including any model load still in flight.
    if (this.editor.pendingTemplate || this.editor.templateLoading) this.editor._clearGhost?.();
    this.pendingLibrary = candidate; this.pendingRevision ??= this.revision; this.busy = true; this.update();
    const generation = this.generation;
    try {
      const saved = await this.store.save(candidate, { expectedRevision: this.pendingRevision });
      if (!this.started || generation !== this.generation) return false;
      this.library = saved.library; this.revision = saved.revision; this.pendingLibrary = null; this.pendingRevision = null;
      this.state = 'ready'; this.selectedTemplate = this.selectedTemplate && saved.library.templates.find((item) => item.id === this.selectedTemplate.id) || null;
      this.status.dataset.state = successKey; this.update(); return true;
    } catch (error) {
      if (!this.started || generation !== this.generation) return false;
      this.state = error?.code === 'template_revision_conflict' ? 'conflict' : 'ready';
      this.status.dataset.state = this._errorStatus(error); this.update(); return false;
    } finally { this.busy = false; if (this.started) this.update(); }
  }
  render() { this.update(); }

  async saveSelection() {
    if (!this.started || this.busy || this.pendingLibrary || this.state !== 'ready' || !this._editorCanMutate()) return false;
    const items = this.editor._selectedItems?.() || [];
    if (!items.length || items.length > 120 || items.some((item) => item.hidden)) { this.status.dataset.state = 'select'; this.update(); return false; }
    if (!this.name.value.trim()) { this.status.dataset.state = 'nameRequired'; this.update(); return false; }
    const lib = this._currentLibrary(); if (lib.templates.length >= MAX_TEMPLATES) { this.status.dataset.state = 'max'; this.update(); return false; }
    try {
      const template = createTemplate({ id: uuid(), name: this.name.value || this.t('name'), document: this.editor.history.current(), items });
      const result = await this._persist(createTemplateLibrary([...lib.templates, template]), 'saved');
      if (result) { this.selectedTemplate = template; this.name.value = template.name; this.update(); }
      return result;
    } catch (error) { this.status.dataset.state = this._errorStatus(error); this.update(); return false; }
  }
  async rename() {
    if (!this.started || this.busy || this.pendingLibrary || this.state !== 'ready' || !this._editorCanMutate() || !this.selectedTemplate) return false;
    if (!this.name.value.trim()) { this.status.dataset.state = 'nameRequired'; this.update(); return false; }
    try {
      const lib = this._currentLibrary(); const renamed = validateTemplate({ ...this.selectedTemplate, name: this.name.value });
      const next = lib.templates.map((item) => item.id === renamed.id ? renamed : item);
      const ok = await this._persist(createTemplateLibrary(next), 'renamed'); if (ok) this.selectedTemplate = renamed; return ok;
    } catch (error) { this.status.dataset.state = this._errorStatus(error); this.update(); return false; }
  }
  async deleteSelected() {
    if (!this.started || this.busy || this.pendingLibrary || this.state !== 'ready' || !this._editorCanMutate() || !this.selectedTemplate) return false;
    const id = this.selectedTemplate.id, lib = this._currentLibrary();
    const ok = await this._persist(createTemplateLibrary(lib.templates.filter((item) => item.id !== id)), 'deleted');
    if (ok) {
      if (this.editor.pendingTemplate?.template?.id === id) this.editor._clearGhost?.();
      this.selectedTemplate = null; this.deleteConfirmation = false; this.name.value = ''; this.update();
    }
    return ok;
  }

  async _importFile() {
    if (!this.started || this.busy || this.pendingLibrary || this.state !== 'ready' || !this._editorCanMutate()) return;
    const file = this.file.files?.[0]; if (!file) return;
    const generation = this.generation;
    try {
      if (file.size > 2 * 1024 * 1024) throw Object.assign(new Error('size'), { code: 'template_size' });
      const incoming = parseTemplateLibrary(await file.text());
      if (!this.started || generation !== this.generation || !this._editorCanMutate()) return;
      if (incoming.templates.some((item) => item.base.seed !== (this.editor.map.seed >>> 0) || item.base.revision !== this.editor.baseRevision)) throw Object.assign(new Error('base'), { code: 'template_base' });
      const current = this._currentLibrary();
      if (current.templates.length + incoming.templates.length > MAX_TEMPLATES) throw Object.assign(new Error('library_limit'), { code: 'template_library_limit' });
      const additions = incoming.templates.map((item) => validateTemplate({ ...item, id: uuid() }));
      const ok = await this._persist(createTemplateLibrary([...current.templates, ...additions]), 'imported');
      if (ok) this.file.value = '';
    } catch (error) {
      if (!this.started || generation !== this.generation || !this._editorCanMutate()) return;
      this.status.dataset.state = error?.code === 'template_base' ? 'base' : this._errorStatus(error); this.update();
    }
  }

  export() { return JSON.stringify(this._currentLibrary()); }
  downloadExport() {
    try {
      const serialized = this.export();
      if (new TextEncoder().encode(serialized).byteLength > 2 * 1024 * 1024) throw Object.assign(new Error('size'), { code: 'template_size' });
      const blob = new Blob([serialized], { type: 'application/json' }), url = URL.createObjectURL(blob), anchor = this._node('a');
      anchor.href = url; anchor.download = `${this.editor.worldId}-templates.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0); return serialized;
    } catch (error) { this.status.dataset.state = this._errorStatus(error); this.update(); return null; }
  }
  async retrySave() {
    if (!this.pendingLibrary || !this.store || !this.started || this.busy || !this._editorCanMutate()) return false;
    const candidate = this.pendingLibrary; this.pendingLibrary = null;
    return this._persist(candidate, 'saved');
  }
  async retryLoad() { if (this.pendingLibrary || !this._editorCanMutate()) return false; return this.start(); }
  async reloadDiscardingPending() {
    if (!this.started || !this._editorCanMutate()) return false;
    if (!this.pendingLibrary) return this.retryLoad();
    this.pendingLibrary = null; this.pendingRevision = null; this.deleteConfirmation = false; this.reloadConfirmation = false;
    this.state = 'loading'; this.status.dataset.state = 'loading'; return this.start();
  }
  dispose() {
    this.stop(); this.unsubscribeLocale?.(); this.element.remove();
  }
  stop() { this.started = false; this.generation++; }
}
