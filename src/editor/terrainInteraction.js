import * as THREE from 'three';
import { sculptTerrainDocument } from './terrainSculpt.js';
import { editorMessage } from './messages.js';
import { LAYER } from '../render/pipeline.js';

/** A gesture owns a private preview; only its final valid document reaches history. */
export class TerrainInteraction {
  constructor(editor, panel) {
    this.editor = editor; this.panel = panel; this.tool = null; this.stroke = null;
    this.point = null; this.lastPoint = null; this.lastPreview = 0;
    this.cursor = new THREE.LineLoop(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x83f2cf, depthTest: false, transparent: true, opacity: .95 }));
    this.cursor.name = 'gm-terrain-brush'; this.cursor.layers.set(LAYER.NO_OUTLINE);
    this.cursor.renderOrder = 30; this.cursor.visible = false; editor.scene.add(this.cursor);
    this.onUp = event => { if (event.button === 0 && this.stroke && this.tool !== 'ramp') this.finish(); };
    this.onCancel = () => this.cancel();
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
  }

  select(tool) {
    this.cancel(); this.editor._clearGhost(); this.editor._cancelTransform();
    this.editor.select(null); this.tool = tool;
    this.editor.transform.enabled = !tool;
    this.panel.tool = tool; this.panel.render();
    this.cursor.visible = false;
    if (tool) this.editor._setStatus(editorMessage(
      tool === 'ramp' ? 'Ramp: click its start, then its end. Escape cancels.' : 'Drag on dry ground. Release to keep the stroke; Escape cancels.',
      tool === 'ramp' ? 'Rampa: pulsa el inicio y luego el final. Escape cancela.' : 'Arrastra sobre suelo seco. Suelta para conservar el trazo; Escape cancela.'), 'info');
  }

  move() {
    const e = this.editor;
    if (!this.tool || !e.active || e.walkPreview?.active || e.remotePanel?.open || !e.pointerInside) {
      this.cursor.visible = false; return;
    }
    const hit = e._terrainHits()[0];
    if (!hit) { this.cursor.visible = false; return; }
    this.point = { x: hit.point.x, z: hit.point.z };
    if (this.stroke) {
      if (this.tool === 'ramp') this.stroke.points[1] = this.point;
      else {
        const last = this.stroke.points.at(-1);
        if (Math.hypot(last.x - this.point.x, last.z - this.point.z) >= .5) {
          if (this.stroke.points.length >= 256) { this.stroke.error = new Error('stroke_limit'); }
          else this.stroke.points.push(this.point);
        }
      }
      this.stroke.pending = true;
    }
    this.drawCursor();
  }

  drawCursor() {
    if (!this.point || !this.tool) return;
    const map = this.editor.draftMap || this.editor.map;
    const radius = this.panel.parameters().radius;
    const points = Array.from({ length: 64 }, (_, i) => {
      const a = i * Math.PI / 32, x = this.point.x + Math.cos(a) * radius, z = this.point.z + Math.sin(a) * radius;
      return new THREE.Vector3(x, map.heightAt(x, z) + .09, z);
    });
    this.cursor.geometry.setFromPoints(points); this.cursor.geometry.computeBoundingSphere();
    this.cursor.material.color.set(this.stroke?.error ? 0xff6854 : 0x83f2cf);
    this.cursor.visible = true; this.editor.invalidate();
  }

  down(event) {
    if (!this.tool) return false;
    event.preventDefault(); event.stopImmediatePropagation();
    this.move(); if (!this.point || !this.cursor.visible) return true;
    if (this.tool === 'ramp' && this.stroke) {
      this.stroke.points[1] = { ...this.point }; this.finish(); return true;
    }
    this.stroke = { base: this.editor.history.current(), points: [{ ...this.point }],
      parameters: this.panel.parameters(), result: null, pending: true, error: null };
    this.editor.cameraController.disable();
    this.editor.canvas.focus({ preventScroll: true });
    if (this.tool !== 'ramp') this.preview();
    return true;
  }

  preview() {
    const stroke = this.stroke;
    if (!stroke || (this.tool === 'ramp' && stroke.points.length < 2)) return;
    stroke.pending = false;
    try {
      if (stroke.points.length >= 256) throw new Error('stroke_limit');
      const result = sculptTerrainDocument({ map: this.editor.map, document: stroke.base,
        baseRevision: this.editor.baseRevision, ...stroke.parameters, points: stroke.points });
      this.editor._renderDocument(result);
      stroke.result = result; stroke.error = null;
    } catch (error) {
      stroke.result = null; stroke.error = error; this.editor.lastError = error;
      this.editor._renderDocument(stroke.base);
      this.editor._setStatus(editorMessage(
        'Stroke blocked: keep it on dry ground, away from protected places, or reduce its size/height. Nothing was saved.',
        'Trazo bloqueado: mantén suelo seco y distancia de zonas protegidas, o reduce tamaño/altura. No se guardó ningún cambio.'), 'error');
    }
    this.drawCursor();
  }

  finish() {
    if (!this.stroke) return;
    this.preview(); const stroke = this.stroke; this.stroke = null;
    if (stroke.result && !stroke.error) {
      this.lastPoint = { ...stroke.points.at(-1) };
      this.editor._commit(stroke.result);
      this.editor._setStatus(editorMessage('Terrain stroke kept in the private draft. Undo reverses the whole stroke.',
        'Trazo de terreno conservado en el borrador privado. Deshacer revierte el trazo completo.'), 'ok');
    } else this.editor._renderDocument(stroke.base);
    if (this.editor.active && !this.editor.walkPreview?.active) this.editor.cameraController.enable();
    this.drawCursor();
  }

  cancel() {
    const stroke = this.stroke; this.stroke = null;
    if (stroke && this.editor.active) this.editor._renderDocument(stroke.base);
    if (this.editor.active && !this.editor.walkPreview?.active) this.editor.cameraController.enable();
    this.cursor.visible = false; this.editor.invalidate();
    return !!stroke;
  }

  update() {
    if (this.stroke?.pending && performance.now() - this.lastPreview > 120) {
      this.lastPreview = performance.now(); this.preview();
    }
  }

  dispose() {
    this.cancel(); window.removeEventListener('pointerup', this.onUp); window.removeEventListener('pointercancel', this.onCancel);
    this.editor.scene.remove(this.cursor); this.cursor.geometry.dispose(); this.cursor.material.dispose();
  }
}
