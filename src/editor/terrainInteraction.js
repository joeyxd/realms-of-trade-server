import * as THREE from 'three';
import { brushOutline, strokeSpacing } from './terrainBrush.js';
import { joinRegions } from './terrainPreview.js';
import { editorMessage } from './messages.js';
import { LAYER } from '../render/pipeline.js';

const STROKE_LIMIT = 256;
// GM08 airbrush: a pointer held still lays one dab on the spot per tick.
const AIRBRUSH_TICK_MS = 100;
const blocked = () => editorMessage(
  'Stroke blocked: keep it on dry ground, away from protected places, or reduce its size/height. Nothing was saved.',
  'Trazo bloqueado: mantén suelo seco y distancia de zonas protegidas, o reduce tamaño/altura. No se guardó ningún cambio.');

/**
 * A gesture owns a private preview; only its final valid document reaches history. Strokes run on the editor's
 * terrain session (terrainSession.js): the preview patches and restores the grid, the commit re-encodes the touched
 * tiles, and no stroke starts while a commit is still hashing.
 */
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
    if (tool) this.editor._setStatus(tool === 'ramp'
      ? editorMessage('Ramp: click its start, then its end. Escape cancels.', 'Rampa: pulsa el inicio y luego el final. Escape cancela.')
      : editorMessage('Drag on dry ground. Release to keep the stroke; Escape cancels.', 'Arrastra sobre suelo seco. Suelta para conservar el trazo; Escape cancela.'), 'info');
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
      if ((this.stroke.parameters.tool || this.tool) === 'ramp') this.stroke.points[1] = this.point;
      else {
        // GM08: points as far apart as the stroke's dabs, so a 128 m brush covers a long drag in 256 points.
        const last = this.stroke.points.at(-1);
        if (Math.hypot(last.x - this.point.x, last.z - this.point.z) >= strokeSpacing(this.stroke.parameters.radius)) {
          if (this.stroke.points.length >= STROKE_LIMIT) { this.stroke.error = new Error('stroke_limit'); }
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
    const params = this.stroke?.parameters || this.panel.parameters();
    const outline = brushOutline({ ...params, shape: params.tool === 'ramp' ? 'circle' : params.shape }, 64);
    const points = outline.map(({ x: dx, z: dz }) => {
      const x = this.point.x + dx, z = this.point.z + dz;
      return new THREE.Vector3(x, map.heightAt(x, z) + .09, z);
    });
    this.cursor.geometry.setFromPoints(points); this.cursor.geometry.computeBoundingSphere();
    this.cursor.material.color.set(this.stroke?.error ? 0xff6854 : 0x83f2cf);
    this.cursor.visible = true; this.editor.invalidate();
  }

  down(event) {
    if (!this.tool) return false;
    event.preventDefault(); event.stopImmediatePropagation();
    // Commits are serialized: never start a stroke on a half-committed terrain.
    if (this.editor.terrainTask) return true;
    this.move(); if (!this.point || !this.cursor.visible) return true;
    if (this.tool === 'ramp' && this.stroke) {
      this.stroke.points[1] = { ...this.point }; this.finish(); return true;
    }
    // region and shown (GM08): the union of the regions this gesture rendered, and the map it showed last.
    this.stroke = { base: this.editor.history.current(), points: [{ ...this.point }],
      parameters: this.panel.parameters(), result: null, pending: true, error: null,
      region: null, shown: null, held: performance.now(), heldPoints: 1 };
    this.editor.cameraController.disable();
    this.editor.canvas.focus({ preventScroll: true });
    if (this.tool !== 'ramp') this.preview();
    return true;
  }

  _edit(stroke) { return { document: stroke.base, ...stroke.parameters, points: stroke.points }; }

  // GM08: the region a render needs: the union of the gesture's regions, from the map the gesture showed last (the
  // preview narrows it to the vertices that changed); before the first render, the stroke's own region.
  _region(stroke, region) {
    stroke.region = joinRegions(stroke.region, region);
    return stroke.shown && stroke.region ? { ...stroke.region, from: stroke.shown } : region || null;
  }

  // Show the gesture's base document again, through the gesture's region once it has rendered a preview.
  _showBase(stroke) {
    if (!stroke.shown) { this.editor._renderDocument(stroke.base); return; }
    const map = this.editor._terrainSurface(stroke.base);
    this.editor._renderDocument(stroke.base, { map, region: this._region(stroke, null) });
    stroke.shown = map;
  }

  preview() {
    const stroke = this.stroke;
    if (!stroke || (this.tool === 'ramp' && stroke.points.length < 2)) return;
    stroke.pending = false;
    try {
      if (stroke.points.length >= STROKE_LIMIT) throw new Error('stroke_limit');
      const result = this.editor.terrain.preview(this._edit(stroke));
      this.editor._renderDocument(result.document, { map: result.map, preview: true, region: this._region(stroke, result.region) });
      stroke.shown = result.map; stroke.result = result.document; stroke.error = null;
    } catch (error) {
      stroke.result = null; stroke.error = error; this.editor.lastError = error;
      this._showBase(stroke);
      this.editor._setStatus(blocked(), 'error');
    }
    this.drawCursor();
  }

  finish() {
    if (!this.stroke) return;
    const stroke = this.stroke; this.stroke = null;
    if (this.editor.active && !this.editor.walkPreview?.active) this.editor.cameraController.enable();
    if (stroke.points.length >= STROKE_LIMIT || (stroke.parameters.tool === 'ramp' && stroke.points.length < 2)) {
      this.editor.lastError = new Error('stroke_limit');
      this._showBase(stroke); this.editor._setStatus(blocked(), 'error'); this.drawCursor();
      return;
    }
    const task = this.editor._commitTerrainStroke(this._edit(stroke), stroke).then((committed) => {
      if (!this.editor.active) return committed;
      if (committed) {
        this.lastPoint = { ...stroke.points.at(-1) };
        this.editor._setStatus(editorMessage('Terrain stroke kept in the private draft. Undo reverses the whole stroke.',
          'Trazo de terreno conservado en el borrador privado. Deshacer revierte el trazo completo.'), 'ok');
      } else this.editor._setStatus(blocked(), 'error');
      this.drawCursor();
      return committed;
    });
    this.drawCursor();
    return task;
  }

  cancel() {
    const stroke = this.stroke; this.stroke = null;
    if (stroke && this.editor.active) this._showBase(stroke);
    if (this.editor.active && !this.editor.walkPreview?.active) this.editor.cameraController.enable();
    this.cursor.visible = false; this.editor.invalidate();
    return !!stroke;
  }

  update() {
    const stroke = this.stroke;
    // GM08 airbrush: a tick without a new point means the pointer is held still; it lays a dab on the spot.
    if (stroke?.parameters.flow === 'airbrush' && stroke.parameters.tool !== 'ramp' && performance.now() - stroke.held >= AIRBRUSH_TICK_MS) {
      stroke.held = performance.now();
      if (stroke.points.length === stroke.heldPoints && stroke.points.length < STROKE_LIMIT - 1) {
        stroke.points.push({ ...stroke.points.at(-1) }); stroke.pending = true;
      }
      stroke.heldPoints = stroke.points.length;
    }
    if (this.stroke?.pending && performance.now() - this.lastPreview > 120) {
      this.lastPreview = performance.now(); this.preview();
    }
  }

  dispose() {
    this.cancel(); window.removeEventListener('pointerup', this.onUp); window.removeEventListener('pointercancel', this.onCancel);
    this.editor.scene.remove(this.cursor); this.cursor.geometry.dispose(); this.cursor.material.dispose();
  }
}
