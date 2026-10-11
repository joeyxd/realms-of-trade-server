import * as THREE from 'three';
import { applyScatter, MAX_SCATTER_POINTS, planScatter, scatterParameters } from './scatterBrush.js';
import { canScatterAt } from './terrainData.js';
import { brushOutline } from './terrainBrush.js';
import { LAYER } from '../render/pipeline.js';

const id = (() => {
  let serial = 0;
  return () => `gm-scatter-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${(++serial).toString(36)}`}`;
})();

/** Private, atomic drag interaction for decorative scatter. */
export class ScatterInteraction {
  constructor(editor, panel) {
    this.editor = editor; this.panel = panel; this.tool = null; this.stroke = null;
    this.point = null; this.lastPoint = null; this.lastPreview = 0;
    this.cursor = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color: 0x83f2cf, depthTest: false, transparent: true, opacity: .95,
    }));
    this.cursor.name = 'gm-scatter-brush'; this.cursor.layers.set(LAYER.NO_OUTLINE); this.cursor.renderOrder = 31;
    this.cursor.visible = false; editor.scene.add(this.cursor);
    this.onUp = (event) => {
      const stroke = this.stroke;
      if (!stroke || event.button !== 0 || event.pointerId !== stroke.pointerId) return;
      if (this._isUiTarget(event.target)) { this.cancel(); return; }
      if (!this.move(event) || !this.point) { this.cancel(); return; }
      this._preview(); this._finish();
    };
    this.onCancel = (event) => {
      if (this.stroke && (event.pointerId === undefined || event.pointerId === this.stroke.pointerId)) this.cancel();
    };
    this.onBlur = () => this.cancel();
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('blur', this.onBlur);
  }

  _isUiTarget(target) { return !!this.editor.ui?.contains?.(target); }

  select(enabled) {
    this.cancel();
    const active = !!enabled;
    this.editor._clearGhost(); this.editor._cancelTransform(); this.editor.select(null);
    this.tool = active ? 'scatter' : null; this.editor.transform.enabled = !active;
    this.panel.enabled = active; this.panel._syncControls?.();
    this.cursor.visible = false;
    if (active) this.editor._setStatus({
      en: 'Drag over dry ground to preview decorative copies. Release to keep the whole stroke; Escape cancels.',
      es: 'Arrastra sobre suelo seco para previsualizar copias decorativas. Suelta para conservar el trazo completo; Escape cancela.',
    }, 'info');
  }

  _eventPoint(event) {
    const e = this.editor, rect = e.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) { e.pointerInside = false; return false; }
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    e.pointerNdc.set(x * 2 - 1, -(y * 2 - 1));
    e.pointerInside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    return e.pointerInside;
  }

  move(event = null) {
    const e = this.editor;
    if (this.stroke && event && event.pointerId !== this.stroke.pointerId) return false;
    if (event && !this._eventPoint(event)) { this.point = null; this.cursor.visible = false; return false; }
    if (!this.tool || !e.active || e.walkPreview?.active || e.remotePanel?.open || !e.pointerInside) {
      this.point = null; this.cursor.visible = false; return false;
    }
    const hit = e._terrainHits()[0];
    if (!hit) { this.point = null; this.cursor.visible = false; return false; }
    this.point = { x: hit.point.x, z: hit.point.z };
    if (this.stroke) {
      const last = this.stroke.points.at(-1);
      if (Math.hypot(last.x - this.point.x, last.z - this.point.z) >= .5) {
        if (this.stroke.points.length >= MAX_SCATTER_POINTS) this.stroke.error = Object.assign(new Error('scatter_points'), { code: 'scatter_points' });
        else this.stroke.points.push({ ...this.point });
      }
      this.stroke.pending = true;
    }
    this.drawCursor(); return true;
  }

  drawCursor() {
    if (!this.point || !this.tool) { this.cursor.visible = false; return; }
    const map = this.editor.draftMap || this.editor.map;
    const params = this.stroke?.parameters || this.panel.parameters();
    const outline = brushOutline(params, 64);
    const points = outline.map(({ x, z }) => {
      const worldX = this.point.x + x, worldZ = this.point.z + z;
      return new THREE.Vector3(worldX, map.heightAt(worldX, worldZ) + .09, worldZ);
    });
    this.cursor.geometry.setFromPoints(points); this.cursor.geometry.computeBoundingSphere();
    this.cursor.material.color.set(this.stroke?.error ? 0xff6854 : 0x83f2cf);
    this.cursor.visible = true; this.editor.invalidate();
  }

  down(event) {
    if (!this.tool) return false;
    if (this.stroke) return true;
    if (event.button !== 0 || this._isUiTarget(event.target)) return true;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!this.move(event) || !this.point) return true;
    const metrics = this.panel.metrics, entry = this.panel.entry;
    if (!metrics || !entry?.id) {
      this.panel.setResult(null, Object.assign(new Error('scatter_asset'), { code: 'scatter_asset' }));
      return true;
    }
    try {
      const parameters = scatterParameters(this.panel.parameters());
      const base = this.editor.history.current();
      const existingCost = Object.freeze({ ...(this.editor._scatterExistingCost?.(base) || { triangles: 0, primitives: 0 }) });
      this.stroke = { base, points: [{ ...this.point }], parameters, existingCost,
        metrics, assetId: entry.id, ids: Array.from({ length: 120 }, id), result: null, plan: null,
        pending: true, error: null, pointerId: event.pointerId };
      this.editor.cameraController.disable(); this.editor.canvas.focus({ preventScroll: true });
      this._preview();
    } catch (error) {
      this.panel.setResult(null, error);
    }
    return true;
  }

  _preview() {
    const stroke = this.stroke;
    if (!stroke) return;
    stroke.pending = false;
    try {
      if (stroke.error) throw stroke.error;
      const map = this.editor.draftMap || this.editor.map;
      const plan = planScatter({ map, document: stroke.base, assetId: stroke.assetId, points: stroke.points,
        parameters: stroke.parameters, metrics: stroke.metrics, existingCost: stroke.existingCost,
        isAllowed: (x, z, radius) => canScatterAt(map, x, z, radius) });
      const result = applyScatter(stroke.base, plan, index => stroke.ids[index]);
      stroke.plan = plan; stroke.result = result.document; stroke.error = null;
      this.editor._renderDocument(result.document);
      this.panel.setResult({ plan, ids: result.ids });
    } catch (error) {
      stroke.error = error; stroke.result = null; stroke.plan = null;
      this.editor._renderDocument(stroke.base); this.panel.setResult(null, error);
      this.editor._setStatus({
        en: 'Scatter blocked: move away from protected ground or reduce density, size, or model scale. Nothing was saved.',
        es: 'Dispersión bloqueada: aléjate de zonas protegidas o reduce densidad, tamaño o escala del modelo. No se guardó nada.',
      }, 'error');
    }
    this.drawCursor();
  }

  _finish() {
    const stroke = this.stroke; if (!stroke) return;
    this.stroke = null;
    if (stroke.result && !stroke.error && stroke.plan?.placements?.length) {
      this.lastPoint = { ...stroke.points.at(-1) };
      this.editor._commit(stroke.result);
      this.editor._setStatus({
        en: 'Decorative scatter kept in the private draft. Undo reverses the whole stroke.',
        es: 'Dispersión decorativa conservada en el borrador privado. Deshacer revierte todo el trazo.',
      }, 'ok');
    } else {
      this.editor._renderDocument(stroke.base);
      if (!stroke.error) this.editor._setStatus({
        en: 'No valid placements fit here. Nothing was added.', es: 'Aquí no caben copias válidas. No se añadió nada.',
      }, 'info');
    }
    if (this.editor.active && !this.editor.walkPreview?.active) this.editor.cameraController.enable();
    this.drawCursor();
  }

  cancel() {
    const stroke = this.stroke; this.stroke = null;
    if (stroke && this.editor.active) this.editor._renderDocument(stroke.base);
    if (this.editor.active && !this.editor.walkPreview?.active) this.editor.cameraController.enable();
    this.panel.setResult(null);
    this.cursor.visible = false; this.editor.invalidate();
    return !!stroke;
  }

  update() {
    if (this.stroke?.pending && performance.now() - this.lastPreview > 120) {
      this.lastPreview = performance.now(); this._preview();
    }
  }

  dispose() {
    this.cancel(); window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel); window.removeEventListener('blur', this.onBlur);
    this.editor.scene.remove(this.cursor); this.cursor.geometry.dispose(); this.cursor.material.dispose();
  }
}
