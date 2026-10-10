import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { addDecoration, createDecoration, createDocument, createDocumentHistory, removeDecoration, updateDecoration, validateDocument } from './document.js';
import { DraftStore, DRAFT_EXPORT_FORMAT, DRAFT_EXPORT_VERSION, MAX_DRAFT_EXPORT_BYTES } from './draftStore.js';
import { EditorCatalog } from './catalog.js';
import { EditorFreeCamera } from './freeCamera.js';
import { createEditorModels } from './modelFactory.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const number = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const clone = (v) => structuredClone(v);
const uid = () => 'gm-' + (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
const typing = (target) => !!target?.closest?.('input,textarea,select,[contenteditable="true"]');
const html = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

/** Local draft editor for new decorative objects. It never changes the base map or gameplay state. */
export class WorldEditor {
  constructor({ scene, camera, canvas, map, assets, parent, onClose = () => {}, draftWorldId = null,
    baseRevision = 'terrain-s21-v1', invalidate = () => {}, onChanged = () => {} } = {}) {
    if (!scene || !camera || !canvas || !map || !assets || !parent) {
      throw new TypeError('WorldEditor requires scene, camera, canvas, map, assets, and parent');
    }
    this.scene = scene; this.camera = camera; this.canvas = canvas; this.map = map;
    this.editorModels = createEditorModels(assets);
    this.assets = {
      man: assets.man,
      data: assets.data.bind(assets), entry: assets.entry.bind(assets), list: assets.list.bind(assets),
      ensureModel: assets.ensureModel.bind(assets), model: this.editorModels.model,
    };
    this.parent = parent; this.onClose = onClose;
    this.invalidate = invalidate; this.onChanged = onChanged;
    this.worldId = draftWorldId || ('gm-' + (map.seed >>> 0).toString(16));
    this.baseRevision = baseRevision; this.lang = 'es'; this.active = false; this.session = 0;
    this.document = null; this.history = null; this.revision = 0; this.dirty = false;
    this.saveTimer = 0; this.saveTask = null; this.saveAgain = false; this.resumeDocument = null;
    this.recoveryRevision = null;
    this.lastSavedJson = ''; this.records = new Map(); this.selectedId = null;
    this.pendingEntry = null; this.ghost = null; this.dragging = false; this.dragStart = null;
    this.pointerNdc = new THREE.Vector2(); this.pointerInside = false; this.error = null;
    this.snapEnabled = true; this.snapStep = 0.5;

    this._installStyles(); this._buildUI();
    this.cameraController = new EditorFreeCamera(camera, canvas, { ownsTarget: (target) => this.ui.contains(target) });
    this.transform = new TransformControls(camera, canvas); this.transform.setSize(0.85);
    this._configureSnap();
    this.transform.addEventListener('dragging-changed', (e) => { this.dragging = e.value; });
    this.transform.addEventListener('mouseDown', () => { this.dragStart = this._selectedTransform(); });
    this.transform.addEventListener('objectChange', () => this._onObjectChange());
    this.transform.addEventListener('mouseUp', () => this._finishTransform());
    this.transformHelper = this.transform; this.transformHelper.name = 'gm-transform-controls';
    this.controlsAdded = false;

    this.onPointerMove = (e) => this._pointerMove(e);
    this.onPointerDown = (e) => this._pointerDown(e);
    this.onKeyDown = (e) => this._keyDown(e);
    this.onLang = () => { this.lang = this.lang === 'es' ? 'en' : 'es'; this._setLanguage(); };
    this.onClick = (e) => this._toolbarAction(e);
    this.onChange = (e) => this._inspectorChange(e);
    this.onBlur = () => { this.cameraController.onBlur(); if (this.active) this._cancelTransform(); };
    this.onPointerLeave = () => { this.pointerInside = false; if (this.ghost) this.ghost.visible = false; this.invalidate(); };
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.ui.addEventListener('click', this.onClick);
    this.ui.addEventListener('change', this.onChange);
    this.langButton.addEventListener('click', this.onLang);
    this.onImport = () => this._importFile(this.importInput.files?.[0]);
    this.importInput.addEventListener('change', this.onImport);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('blur', this.onBlur);
    this.catalog = new EditorCatalog({
      root: this.catalogRoot, assets: this.assets, onSelect: ({ entry, object }) => this._selectAsset(entry, object),
      t: (en, es) => this._t(en, es),
    });
    this._setLanguage();
  }

  _installStyles() {
    if (document.getElementById('gm-editor-style')) return;
    const link = document.createElement('link');
    link.id = 'gm-editor-style'; link.rel = 'stylesheet'; link.href = new URL('./editor.css', import.meta.url).href;
    document.head.appendChild(link);
  }

  _buildUI() {
    this.ui = document.createElement('section'); this.ui.className = 'gm-editor'; this.ui.hidden = true;
    this.ui.setAttribute('aria-label', 'World editor');
    this.ui.innerHTML = [
      '<header class="gm-topbar"><div class="gm-brand"><b data-i18n="brand"></b><small data-i18n="draftLocal"></small></div>',
      '<div class="gm-actions">',
      '<button type="button" data-action="place" data-i18n="place"></button>',
      '<button type="button" data-action="undo" data-i18n="undo"></button><button type="button" data-action="redo" data-i18n="redo"></button>',
      '<button type="button" data-action="duplicate" data-i18n="duplicate"></button><button type="button" data-action="delete" data-i18n="delete"></button>',
      '<button type="button" data-action="save" data-i18n="save"></button><button type="button" data-action="export" data-i18n="export"></button>',
      '<label class="gm-import-button"><span data-i18n="import"></span><input type="file" accept="application/json,.json" data-role="import"></label>',
      '<button type="button" data-role="language" aria-label="Language"></button><button type="button" data-action="close" class="gm-close" data-i18n="close"></button>',
      '</div></header><div class="gm-workspace"><aside class="gm-sidebar" data-role="catalog"></aside>',
      '<div class="gm-canvas-note" data-i18n="controls"></div><aside class="gm-inspector"><h2 data-i18n="inspector"></h2>',
      '<div class="gm-selection-name" data-role="selection-name"></div><div class="gm-transform-tools">',
      '<button type="button" data-action="mode-translate" data-i18n="move"></button><button type="button" data-action="mode-rotate" data-i18n="rotate"></button>',
      '<button type="button" data-action="mode-scale" data-i18n="scale"></button></div>',
      '<div class="gm-snap"><label><input type="checkbox" data-setting="snap" checked> <span data-i18n="snap"></span></label>',
      '<input type="number" data-setting="snapStep" value="0.5" min="0.05" max="10" step="0.25" aria-label="Grid step / Paso de rejilla">',
      '<select data-setting="space"><option value="world" data-i18n="world"></option><option value="local" data-i18n="local"></option></select></div>',
      '<div class="gm-fields">',
      '<label><span>X</span><input data-field="x" type="number" step="0.25"></label><label><span>Y</span><input data-field="y" type="number" step="0.25"></label>',
      '<label><span>Z</span><input data-field="z" type="number" step="0.25"></label><label><span>Rot X°</span><input data-field="rx" type="number" step="5"></label>',
      '<label><span>Rot Y°</span><input data-field="ry" type="number" step="5"></label><label><span>Rot Z°</span><input data-field="rz" type="number" step="5"></label>',
      '<label><span data-i18n="uniformScale"></span><input data-field="scale" type="number" min="0.001" max="1000" step="0.1"></label></div>',
      '<button type="button" data-action="ground" data-i18n="ground"></button>',
      '<p class="gm-collider-note" data-i18n="colliderNote"></p><div class="gm-status" data-role="status" aria-live="polite"></div></aside></div>',
    ].join('');
    this.parent.appendChild(this.ui);
    this.catalogRoot = this.ui.querySelector('[data-role="catalog"]');
    this.langButton = this.ui.querySelector('[data-role="language"]');
    this.selectionName = this.ui.querySelector('[data-role="selection-name"]');
    this.statusNode = this.ui.querySelector('[data-role="status"]');
    this.fields = Object.fromEntries([...this.ui.querySelectorAll('[data-field]')].map((el) => [el.dataset.field, el]));
    this.importInput = this.ui.querySelector('[data-role="import"]');
  }

  _t(en, es) { return this.lang === 'en' ? en : es; }

  _setLanguage() {
    const words = {
      brand: ['World editor', 'Editor del mundo'], draftLocal: ['LOCAL DRAFT · NO PUBLISH', 'BORRADOR LOCAL · SIN PUBLICAR'],
      place: ['Place', 'Colocar'], undo: ['Undo', 'Deshacer'], redo: ['Redo', 'Rehacer'], duplicate: ['Duplicate', 'Duplicar'],
      delete: ['Delete', 'Eliminar'], save: ['Save draft', 'Guardar borrador'], export: ['Export', 'Exportar'],
      import: ['Import', 'Importar'], close: ['Close', 'Cerrar'],
      controls: ['RMB + mouse: look · WASD: fly · Q/E: height · Shift: fast · wheel: speed · F: focus',
        'Botón derecho + ratón: mirar · WASD: volar · Q/E: altura · Shift: rápido · rueda: velocidad · F: enfocar'],
      inspector: ['Inspector', 'Inspector'], move: ['Move', 'Mover'], rotate: ['Rotate', 'Girar'], scale: ['Scale', 'Escala'],
      uniformScale: ['Uniform scale', 'Escala uniforme'],
      snap: ['Snap', 'Rejilla'], world: ['World axes', 'Ejes del mundo'], local: ['Local axes', 'Ejes locales'],
      ground: ['Place on terrain', 'Apoyar en terreno'],
      colliderNote: ['Draft decoration only. Proxy metadata has no gameplay collision.', 'Solo decoración de borrador. El proxy no tiene colisión de gameplay.'],
    };
    for (const el of this.ui.querySelectorAll('[data-i18n]')) {
      const value = words[el.dataset.i18n]; if (value) el.textContent = value[this.lang === 'en' ? 0 : 1];
    }
    this.langButton.textContent = this.lang === 'es' ? 'EN' : 'ES';
    this.catalog?.setLanguage(this.lang); this._renderInspector();
  }

  async open() {
    if (this.active) return true;
    this.error = null; this.rejectedDocument = null;
    const session = ++this.session;
    this.active = true; this.ui.hidden = false; this.catalog.generation = session;
    try {
      this.store ||= new DraftStore({ worldId: this.worldId });
      let recovery = this.resumeDocument;
      const normal = await this.store.load();
      if (!recovery) {
        const storedRecovery = await this.store.loadRecovery();
        if (storedRecovery) {
          this.recoveryRevision = storedRecovery.revision;
          if (JSON.stringify(storedRecovery.document) === JSON.stringify(normal.document)) await this._clearRecovery();
          else { recovery = storedRecovery.document; this.revision = storedRecovery.expectedRevision; }
        }
      }
      const loaded = recovery ? { revision: this.revision, document: recovery } : normal;
      if (session !== this.session) return false;
      if (loaded.document && (loaded.document.base.seed !== (this.map.seed >>> 0) || loaded.document.base.revision !== this.baseRevision)) {
        this.rejectedDocument = loaded.document;
        throw new Error(this._t('Saved draft is for a different base map. Export it before starting another draft.',
          'El borrador pertenece a otra base. Expórtalo antes de iniciar otro.'));
      }
      this.revision = loaded.revision;
      const draft = loaded.document || createDocument({ seed: this.map.seed >>> 0, baseRevision: this.baseRevision });
      this.history = createDocumentHistory(draft); this.document = clone(draft);
      this.lastSavedJson = JSON.stringify(normal.document || createDocument({ seed: this.map.seed >>> 0, baseRevision: this.baseRevision }));
      this.dirty = !!recovery && JSON.stringify(recovery) !== this.lastSavedJson;
      this._addControls(); this.cameraController.enable();
      this._setStatus(this._t('Local draft. Nothing is published or written to gameplay.',
        'Borrador local. Nada se publica ni se escribe en gameplay.'), 'info');
      if (recovery) this._setStatus(this._t('Recovered unsaved draft. Save or export it; conflicting revisions stay protected.',
        'Borrador sin guardar recuperado. Guarda o exporta; las revisiones en conflicto siguen protegidas.'), 'error');
      this.catalog.refresh();
      await this.catalog.ready;
      if (!this.active || session !== this.session) return false;
      await this._hydrate(draft);
      if (!this.active || session !== this.session) return false;
      this._renderDocument(this.history.current()); this._updateButtons();
      this.onChanged({ document: clone(this.document), dirty: this.dirty });
      this.invalidate(); return true;
    } catch (error) {
      if (session !== this.session) return false;
      this.active = false; this.ui.hidden = true; this.error = error;
      this.cameraController.disable(); this._clearGhost(); this.transform.detach();
      if (this.controlsAdded) { this.scene.remove(this.transformHelper); this.controlsAdded = false; }
      for (const record of this.records.values()) this.scene.remove(record.root);
      this._setStatus(error?.message || this._t('Could not open draft.', 'No se pudo abrir el borrador.'), 'error');
      return false;
    }
  }

  _addControls() {
    if (!this.controlsAdded) { this.scene.add(this.transformHelper); this.controlsAdded = true; }
  }

  async close({ force = false } = {}) {
    if (!this.active) return true;
    if (this.importTask) await this.importTask;
    if (!this.active) return true;
    if (this.dirty) {
      const saved = await this.saveNow();
      if (!saved && !force) {
        this._setStatus(this._t('Draft remains open because local save failed. Export it or retry.',
          'El borrador sigue abierto porque falló el guardado. Expórtalo o vuelve a intentar.'), 'error');
        return false;
      }
      if (!saved) {
        this.resumeDocument = this.history.current();
        try {
          const record = await this.store.saveRecovery(this.resumeDocument, { expectedRevision: this.revision });
          this.recoveryRevision = record.revision;
        } catch { /* Keep the in-memory copy if local storage is unavailable. */ }
      }
      else this.resumeDocument = null;
    }
    this.active = false; this.session++; this.catalog.generation = this.session;
    clearTimeout(this.saveTimer); this.saveTimer = 0;
    this.cameraController.disable(); this._clearGhost(); this.transform.detach();
    for (const record of this.records.values()) this.scene.remove(record.root);
    if (this.controlsAdded) { this.scene.remove(this.transformHelper); this.controlsAdded = false; }
    this.ui.hidden = true; this.invalidate();
    this.onClose({ saved: !this.dirty, recoveryDocument: this.resumeDocument || (this.dirty ? this.history?.current() : null) });
    return true;
  }

  async _hydrate(document) {
    for (const item of document.objects) {
      const entry = this.catalog.items.find((candidate) => candidate.id === item.assetId) || this.assets.entry?.(item.assetId);
      if (!entry) continue;
      try {
        const state = this.assets.list?.().find((record) => record.id === item.assetId)?.state;
        if (state !== 'ok' && this.assets.ensureModel) await this.assets.ensureModel(entry, { base: entry.base || 'assets/' });
        // _renderDocument creates scene instances once, after model loading completes.
      } catch { /* The document stays intact if an asset is temporarily unavailable. */ }
    }
  }

  _renderDocument(document) {
    this.transform.detach();
    for (const record of this.records.values()) this.scene.remove(record.root);
    this.records.clear(); this.document = clone(document);
    for (const item of document.objects) {
      const entry = this.catalog.items.find((candidate) => candidate.id === item.assetId) || this.assets.entry?.(item.assetId);
      const model = this.assets.model(item.assetId);
      if (entry && model) this._addRecord(item, model);
    }
    this.selectedId = this.records.has(this.selectedId) ? this.selectedId : null;
    if (this.selectedId) this.transform.attach(this.records.get(this.selectedId).root);
    this._renderInspector(); this._updateButtons(); this.invalidate();
  }

  _addRecord(item, model) {
    const root = new THREE.Group(); root.name = item.id; root.userData.gmDecorationId = item.id;
    root.add(model); this._applyTransform(root, item.transform); this.scene.add(root);
    this.records.set(item.id, { id: item.id, assetId: item.assetId,
      entry: this.catalog.items.find((candidate) => candidate.id === item.assetId), root });
  }

  _applyTransform(root, t) {
    root.position.set(t.position.x, t.position.y, t.position.z);
    root.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z, 'YXZ');
    root.scale.setScalar(t.scale); root.updateMatrixWorld(true);
  }

  _selectAsset(entry, preparedModel) {
    if (!this.active) return;
    this._clearGhost(); this.pendingEntry = entry; this.ghost = preparedModel; this.ghost.name = 'gm-placement-ghost';
    this.ghost.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const copies = materials.map((material) => {
        const copy = material.clone(); copy.transparent = true; copy.opacity = 0.48; copy.depthWrite = false;
        copy.userData.gmGhostOwned = true; return copy;
      });
      object.material = Array.isArray(object.material) ? copies : copies[0];
    });
    this.ghost.visible = false; this.scene.add(this.ghost);
    this._setStatus(this._t('Click the terrain to add this model to the local draft.', 'Pulsa el terreno para añadir el modelo al borrador local.'), 'info');
    if (this.pointerInside) this._updateGhost();
    this._updateButtons(); this.invalidate();
  }

  _clearGhost() {
    if (!this.ghost) return;
    this.scene.remove(this.ghost);
    this.ghost.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material?.userData?.gmGhostOwned) material.dispose();
    });
    this.ghost = null; this.pendingEntry = null; this._updateButtons();
  }

  _pointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    this.pointerNdc.set(x * 2 - 1, -(y * 2 - 1)); this.pointerInside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    if (this.ghost) this._updateGhost();
  }

  _terrainHits() {
    const terrain = this.scene.getObjectByName('terrain'); if (!terrain) return [];
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.pointerNdc, this.camera);
    return ray.intersectObject(terrain, false);
  }

  _updateGhost() {
    if (!this.ghost || !this.pointerInside) return;
    const hits = this._terrainHits();
    if (!hits.length) { this.ghost.visible = false; return; }
    const point = this._placementPoint(hits[0].point); this.ghost.position.copy(point);
    this.ghost.visible = true; this.invalidate();
  }

  _pointerDown(event) {
    if (!this.active || this.importTask || event.button !== 0 || event.target !== this.canvas || this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    if (this.ghost && this.pendingEntry) {
      const hits = this._terrainHits(); if (hits.length) this._placeAt(hits[0].point); return;
    }
    const hit = this._pickPlaced();
    this.select(hit ? hit.object.userData.gmDecorationId : null);
  }

  _pickPlaced() {
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.pointerNdc, this.camera);
    const roots = [...this.records.values()].map((record) => record.root);
    const hit = ray.intersectObjects(roots, true)[0]; if (!hit) return null;
    let object = hit.object;
    while (object && !object.userData.gmDecorationId) object = object.parent;
    return object ? { object } : null;
  }

  _placeAt(point) {
    const entry = this.pendingEntry; if (!entry || !this.ghost?.visible) return;
    point = this._placementPoint(point);
    const decoration = createDecoration({ id: uid(), assetId: entry.id, position: {
      x: clamp(point.x, -280, 280), y: clamp(this.map.groundAt(point.x, point.z), -64, 100), z: clamp(point.z, -280, 280),
    }, collider: 'none' });
    this._commit(addDecoration(this.history.current(), decoration)); this.select(decoration.id);
    this._setStatus(this._t('Added to draft only. No gameplay collision.', 'Añadido solo al borrador. Sin colisión de gameplay.'), 'ok');
  }

  select(id) {
    this.selectedId = id && this.records.has(id) ? id : null;
    if (this.selectedId) this.transform.attach(this.records.get(this.selectedId).root); else this.transform.detach();
    this._renderInspector(); this._updateButtons();
  }

  _selectedTransform() {
    const root = this.selectedId && this.records.get(this.selectedId)?.root;
    return root ? this._transformFromRoot(root) : null;
  }

  _transformFromRoot(root) {
    return { position: { x: root.position.x, y: root.position.y, z: root.position.z },
      rotation: { x: root.rotation.x, y: root.rotation.y, z: root.rotation.z }, scale: root.scale.x };
  }

  _onObjectChange() {
    if (!this.selectedId) return;
    const root = this.records.get(this.selectedId)?.root; if (!root) return;
    root.position.x = clamp(root.position.x, -280, 280); root.position.y = clamp(root.position.y, -64, 100); root.position.z = clamp(root.position.z, -280, 280);
    const limit = Math.PI * 200;
    root.rotation.x = clamp(root.rotation.x, -limit, limit); root.rotation.y = clamp(root.rotation.y, -limit, limit); root.rotation.z = clamp(root.rotation.z, -limit, limit);
    root.scale.setScalar(clamp((root.scale.x + root.scale.y + root.scale.z) / 3, 0.001, 1000));
    root.updateMatrixWorld(true); this.invalidate(); this._renderInspector();
  }

  _finishTransform() {
    if (!this.dragStart || !this.selectedId) { this.dragStart = null; return; }
    const before = JSON.stringify(this.dragStart), next = this._selectedTransform(); this.dragStart = null;
    if (before !== JSON.stringify(next)) this._setSelectedTransform(next);
  }

  _cancelTransform() {
    if (this.dragStart && this.selectedId) {
      const root = this.records.get(this.selectedId)?.root;
      if (root) this._applyTransform(root, this.dragStart);
    }
    this.dragStart = null; this.dragging = false; this.transform.dragging = false;
    this.transform.detach();
    if (this.selectedId && this.records.has(this.selectedId)) this.transform.attach(this.records.get(this.selectedId).root);
    this._renderInspector(); this.invalidate();
  }

  _setSelectedTransform(transform) {
    if (!this.selectedId) return;
    try { this._commit(updateDecoration(this.history.current(), this.selectedId, { transform })); }
    catch (error) {
      this._setStatus(this._t('Invalid transform: ' + (error.code || error.message), 'Transformación inválida: ' + (error.code || error.message)), 'error');
      this._renderDocument(this.history.current());
    }
  }

  _renderInspector() {
    if (!this.selectionName || !this.fields) return;
    const item = this.selectedId ? this.history?.current().objects.find((obj) => obj.id === this.selectedId) : null;
    const record = item && this.records.get(item.id);
    const label = this.catalog.items.find((entry) => entry.id === item?.assetId)?.label || record?.entry?.label;
    const localized = typeof label === 'string' ? label : label?.[this.lang] || label?.es || label?.en || item?.assetId;
    this.selectionName.textContent = item ? (localized + ' · ' + item.id) : this._t('Nothing selected', 'Nada seleccionado');
    const t = item?.transform;
    const values = t ? { x: t.position.x, y: t.position.y, z: t.position.z,
      rx: t.rotation.x * 180 / Math.PI, ry: t.rotation.y * 180 / Math.PI, rz: t.rotation.z * 180 / Math.PI, scale: t.scale } : {};
    for (const [key, input] of Object.entries(this.fields)) {
      input.disabled = !item; input.value = Number.isFinite(values[key]) ? Number(values[key]).toFixed(key[0] === 'r' ? 1 : 2) : '';
    }
  }

  _inspectorChange(event) {
    if (this.importTask) return;
    const setting = event.target?.dataset?.setting;
    if (setting) {
      if (setting === 'snap') this.snapEnabled = event.target.checked;
      if (setting === 'snapStep') this.snapStep = clamp(number(event.target.value) || .5, .05, 10);
      if (setting === 'space') this.transform.setSpace(event.target.value === 'local' ? 'local' : 'world');
      this._configureSnap(); return;
    }
    const field = event.target?.dataset?.field; if (!field || !this.selectedId) return;
    const t = this._selectedTransform(), value = number(event.target.value);
    if (['x', 'y', 'z'].includes(field)) t.position[field] = value;
    else if (field[0] === 'r') t.rotation[field[1].toLowerCase()] = value * Math.PI / 180;
    else if (field === 'scale') t.scale = value;
    const root = this.records.get(this.selectedId)?.root; if (root) this._applyTransform(root, t);
    this._setSelectedTransform(t); this._renderInspector();
  }

  _commit(document) {
    this.history.commit(document); this.document = this.history.current();
    this.dirty = JSON.stringify(this.document) !== this.lastSavedJson;
    this._renderDocument(this.document); this.onChanged({ document: clone(this.document), dirty: this.dirty });
    this._updateButtons(); this._scheduleSave();
  }

  _scheduleSave() {
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveNow(), 900);
    this._setStatus(this._t('Draft changed · autosaving locally…', 'Borrador modificado · guardando localmente…'), 'saving');
  }

  async saveNow() {
    if (!this.history || !this.dirty) return true;
    clearTimeout(this.saveTimer); this.saveTimer = 0;
    if (this.saveTask) { this.saveAgain = true; await this.saveTask; return !this.dirty; }
    this.saveTask = (async () => {
      do {
        this.saveAgain = false; const snapshot = this.history.current();
        try {
          const saved = await this.store.save(snapshot, { expectedRevision: this.revision });
          this.revision = saved.revision; this.lastSavedJson = JSON.stringify(saved.document);
          this.dirty = JSON.stringify(this.history.current()) !== this.lastSavedJson;
          if (!this.dirty) { this.resumeDocument = null; await this._clearRecovery(); }
          this._setStatus(this._t('Draft saved locally. Not published.', 'Borrador guardado localmente. Sin publicar.'), 'ok');
        } catch (error) {
          this.dirty = true; this.saveAgain = false;
          this._setStatus(this._t('Local save failed: ' + (error.code || error.message) + '. Export to keep this draft.',
            'Falló el guardado local: ' + (error.code || error.message) + '. Expórtalo para conservarlo.'), 'error');
        }
      } while (this.saveAgain && this.dirty);
      this._updateButtons();
    })();
    await this.saveTask; this.saveTask = null; return !this.dirty;
  }

  _setStatus(message, kind = '') { this.statusNode.textContent = message; this.statusNode.dataset.kind = kind; }

  async _clearRecovery() {
    if (this.recoveryRevision === null) return;
    try {
      await this.store.clearRecovery({ expectedRevision: this.recoveryRevision });
      this.recoveryRevision = null;
    } catch { /* Never clear a newer recovery from another tab. */ }
  }

  _updateButtons() {
    if (!this.ui) return;
    this.ui.querySelector('[data-action="undo"]').disabled = !this.history?.canUndo();
    this.ui.querySelector('[data-action="redo"]').disabled = !this.history?.canRedo();
    this.ui.querySelector('[data-action="duplicate"]').disabled = !this.selectedId;
    this.ui.querySelector('[data-action="delete"]').disabled = !this.selectedId;
    this.ui.querySelector('[data-action="place"]').classList.toggle('is-active', !!this.pendingEntry);
  }

  _toolbarAction(event) {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (this.importTask && !['close', 'export'].includes(action)) return;
    switch (action) {
      case 'place': if (this.pendingEntry) this._clearGhost(); else this._setStatus(this._t('Choose a model from the library.', 'Elige un modelo de la biblioteca.'), 'info'); break;
      case 'undo': this._restoreHistory('undo'); break;
      case 'redo': this._restoreHistory('redo'); break;
      case 'duplicate': this._duplicate(); break;
      case 'delete': this._deleteSelected(); break;
      case 'save': this.saveNow(); break;
      case 'export': this._exportCurrent(); break;
      case 'close': this.close(); break;
      case 'mode-translate': this.transform.setMode('translate'); break;
      case 'mode-rotate': this.transform.setMode('rotate'); break;
      case 'mode-scale': this.transform.setMode('scale'); break;
      case 'ground': {
        const transform = this._selectedTransform();
        if (transform) { transform.position.y = this.map.groundAt(transform.position.x, transform.position.z); this._setSelectedTransform(transform); }
        break;
      }
      default: return;
    }
    this._updateButtons();
  }

  _restoreHistory(kind) {
    if (!this.history) return;
    const doc = this.history[kind](); this.document = doc; this.dirty = JSON.stringify(doc) !== this.lastSavedJson;
    this._renderDocument(doc); this._scheduleSave();
  }

  _duplicate() {
    const item = this.history?.current().objects.find((obj) => obj.id === this.selectedId); if (!item) return;
    const copy = clone(item); copy.id = uid();
    copy.transform.position.x = clamp(copy.transform.position.x + 2, -280, 280);
    copy.transform.position.z = clamp(copy.transform.position.z + 2, -280, 280);
    this._commit(addDecoration(this.history.current(), copy)); this.select(copy.id);
  }

  _deleteSelected() {
    if (!this.selectedId) return;
    const id = this.selectedId; this._commit(removeDecoration(this.history.current(), id)); this.select(null);
  }

  _keyDown(event) {
    if (!this.active || event.repeat || typing(event.target)) return;
    if (this.importTask && event.code !== 'Escape') return;
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.dragging && this.dragStart && this.selectedId) {
        this._cancelTransform();
      } else if (this.ghost) this._clearGhost(); else this.close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
      event.preventDefault(); event.stopImmediatePropagation(); this._restoreHistory(event.shiftKey ? 'redo' : 'undo'); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
      event.preventDefault(); event.stopImmediatePropagation(); this._restoreHistory('redo'); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD') {
      event.preventDefault(); event.stopImmediatePropagation(); this._duplicate(); return;
    }
    if (event.code === 'Delete' || event.code === 'Backspace') {
      event.preventDefault(); event.stopImmediatePropagation(); this._deleteSelected(); return;
    }
    if (event.code === 'Digit1') this.transform.setMode('translate');
    else if (event.code === 'Digit2') this.transform.setMode('rotate');
    else if (event.code === 'Digit3') this.transform.setMode('scale');
    else if (event.code === 'KeyF') this._focusSelection();
    else return;
    event.preventDefault(); event.stopImmediatePropagation();
  }

  _focusSelection() {
    const root = this.selectedId && this.records.get(this.selectedId)?.root;
    const point = root?.position || this.map.landmarks?.village; if (point) this.cameraController.focus(point);
  }

  _configureSnap() {
    this.transform.setTranslationSnap(this.snapEnabled ? this.snapStep : null);
    this.transform.setRotationSnap(this.snapEnabled ? Math.PI / 12 : null);
    this.transform.setScaleSnap(this.snapEnabled ? .1 : null);
  }

  _placementPoint(point) {
    const snap = (value) => clamp(this.snapEnabled ? Math.round(value / this.snapStep) * this.snapStep : value, -280, 280);
    const x = snap(point.x), z = snap(point.z);
    return new THREE.Vector3(x, clamp(this.map.groundAt(x, z), -64, 100), z);
  }

  exportRecovery() { this._exportDocument(this.rejectedDocument); }

  _exportCurrent() { this._exportDocument(this.history?.current()); }

  _exportDocument(doc) {
    if (!doc) return;
    const text = JSON.stringify({ format: DRAFT_EXPORT_FORMAT, version: DRAFT_EXPORT_VERSION, document: doc }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = this.worldId + '-draft.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    this._setStatus(this._t('Current in-memory draft exported.', 'Se exportó el borrador actual.'), 'ok');
  }

  async _importFile(file) {
    if (!file || !this.store || !this.active || this.importTask) return;
    const session = this.session;
    this.importTask = this._importFileForSession(file, session);
    try { await this.importTask; }
    finally { this.importTask = null; }
  }

  async _importFileForSession(file, session) {
    try {
      if (file.size > MAX_DRAFT_EXPORT_BYTES) throw new Error(this._t('Import file exceeds the 5 MB limit.', 'El archivo supera el límite de 5 MB.'));
      const serialized = await file.text();
      if (!this.active || session !== this.session) return;
      if (new TextEncoder().encode(serialized).byteLength > MAX_DRAFT_EXPORT_BYTES) throw new Error(this._t('Import file exceeds the 5 MB limit.', 'El archivo supera el límite de 5 MB.'));
      const envelope = JSON.parse(serialized);
      if (!envelope || envelope.format !== DRAFT_EXPORT_FORMAT || envelope.version !== DRAFT_EXPORT_VERSION) {
        throw new Error(this._t('Unsupported draft export format.', 'Formato de exportación no compatible.'));
      }
      const checked = validateDocument(envelope.document);
      if (checked.base.seed !== (this.map.seed >>> 0) || checked.base.revision !== this.baseRevision) {
        throw new Error(this._t('Import belongs to a different base map.', 'La importación pertenece a otra base del mapa.'));
      }
      if (!this.active || session !== this.session) return;
      const saved = await this.store.import(serialized, { expectedRevision: this.revision });
      if (!this.active || session !== this.session) return;
      this.revision = saved.revision; this.lastSavedJson = JSON.stringify(saved.document); this.resumeDocument = null;
      await this._clearRecovery();
      this.history = createDocumentHistory(saved.document); this.document = saved.document; this.dirty = false;
      await this._hydrate(saved.document); this._renderDocument(saved.document);
      this.onChanged({ document: clone(saved.document), dirty: false });
      this._setStatus(this._t('Draft imported and saved locally.', 'Borrador importado y guardado localmente.'), 'ok');
    } catch (error) {
      this._setStatus(this._t('Import failed: ' + (error.code || error.message), 'Falló la importación: ' + (error.code || error.message)), 'error');
    } finally { this.importInput.value = ''; }
  }

  update(dt) {
    if (!this.active) return;
    this.cameraController.update(dt);
    if (this.ghost) this._updateGhost();
    this.transform.camera = this.camera; this.transformHelper.updateMatrixWorld(true);
  }

  async dispose() {
    if (this.active) await this.close({ force: true });
    clearTimeout(this.saveTimer); this.cameraController.dispose();
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.ui.removeEventListener('click', this.onClick); this.ui.removeEventListener('change', this.onChange);
    this.langButton.removeEventListener('click', this.onLang); window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('blur', this.onBlur); this.catalog.dispose(); this.transform.detach(); this.transform.dispose();
    this.editorModels.dispose();
    this.importInput.removeEventListener('change', this.onImport);
    this._clearGhost();
    for (const record of this.records.values()) this.scene.remove(record.root);
    this.records.clear(); this.ui.remove();
  }
}

export const createWorldEditor = (options) => new WorldEditor(options);
