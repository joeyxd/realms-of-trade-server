import * as THREE from 'three';
import { brushOutline, strokeSpacing } from './terrainBrush.js';
import { TERRAIN_GRID_MAX_HEIGHT, TERRAIN_MIN_HEIGHT } from './terrainData.js';
import { joinRegions } from './terrainPreview.js';
import { REGION_MAX_POINTS, regionOutline } from './terrainRegion.js';
import { editorMessage } from './messages.js';
import { LAYER } from '../render/pipeline.js';

const STROKE_LIMIT = 256;
// GM08 airbrush: a pointer held still lays one dab on the spot per tick.
const AIRBRUSH_TICK_MS = 100;
// GM08b: a lasso point every metre; near REGION_MAX_POINTS every other point goes and the spacing doubles.
const LASSO_SPACING = 1;
const blocked = () => editorMessage(
  'Stroke blocked: keep it on dry ground, away from protected places, or reduce its size/height. Nothing was saved.',
  'Trazo bloqueado: mantén suelo seco y distancia de zonas protegidas, o reduce tamaño/altura. No se guardó ningún cambio.');
const isRegion = parameters => parameters.selection === 'rect' || parameters.selection === 'lasso';

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
    const selection = this.panel.parameters().selection;
    if (tool) this.editor._setStatus(tool === 'ramp'
      ? editorMessage('Ramp: click its start, then its end. Escape cancels.', 'Rampa: pulsa el inicio y luego el final. Escape cancela.')
      : selection === 'rect' ? editorMessage('Rectangle: drag from one corner to the other; releasing applies the tool to the whole area. Escape cancels.',
        'Rectángulo: arrastra de una esquina a la otra; al soltar se aplica la herramienta a toda el área. Escape cancela.')
      : selection === 'lasso' ? editorMessage('Lasso: drag around the area; releasing closes it and applies the tool. Escape cancels.',
        'Lazo: arrastra alrededor del área; al soltar se cierra y se aplica la herramienta. Escape cancela.')
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
      const { selection } = this.stroke.parameters;
      if ((this.stroke.parameters.tool || this.tool) === 'ramp' || selection === 'rect') this.stroke.points[1] = this.point;
      else if (selection === 'lasso') {
        const stroke = this.stroke, last = stroke.points.at(-1);
        if (Math.hypot(last.x - this.point.x, last.z - this.point.z) >= stroke.spacing) {
          // Thin before the 256th point: the gesture's STROKE_LIMIT (256) must never refuse a lasso.
          if (stroke.points.length >= REGION_MAX_POINTS - 1) { stroke.points = stroke.points.filter((_, n) => n % 2 === 0); stroke.spacing *= 2; }
          stroke.points.push(this.point);
        }
      } else {
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
    let points;
    if (isRegion(params) && this.stroke) {
      // GM08b: the region's outline, a vertex every 2 m or less so it lies on the ground.
      const ring = regionOutline({ shape: params.selection, points: this.stroke.points });
      points = [];
      for (let n = 0; n < ring.length; n++) {
        const a = ring[n], b = ring[(n + 1) % ring.length];
        const steps = Math.min(64, Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2)));
        for (let s = 0; s < steps; s++) {
          const x = a.x + (b.x - a.x) * s / steps, z = a.z + (b.z - a.z) * s / steps;
          points.push(new THREE.Vector3(x, map.heightAt(x, z) + .09, z));
        }
      }
    } else {
      // Before a region is drawn (or while picking a level), a small ring marks the point under the cursor.
      const marker = isRegion(params) || this.panel.picking;
      const outline = brushOutline(marker ? { radius: 2 } : { ...params, shape: params.tool === 'ramp' ? 'circle' : params.shape }, marker ? 24 : 64);
      points = outline.map(({ x: dx, z: dz }) => {
        const x = this.point.x + dx, z = this.point.z + dz;
        return new THREE.Vector3(x, map.heightAt(x, z) + .09, z);
      });
    }
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
    if (this.panel.picking) { this.pickLevel(); return true; }
    if (this.tool === 'ramp' && this.stroke) {
      this.stroke.points[1] = { ...this.point }; this.finish(); return true;
    }
    // region and shown (GM08): the union of the regions this gesture rendered, and the map it showed last.
    // A rectangle keeps its two corners in points; a lasso its outline (GM08b).
    const parameters = this.panel.parameters();
    this.stroke = { base: this.editor.history.current(),
      points: parameters.selection === 'rect' ? [{ ...this.point }, { ...this.point }] : [{ ...this.point }],
      parameters, result: null, pending: true, error: null,
      region: null, shown: null, held: performance.now(), heldPoints: 1, spacing: LASSO_SPACING };
    this.editor.cameraController.disable();
    this.editor.canvas.focus({ preventScroll: true });
    if (this.tool !== 'ramp' && !isRegion(parameters)) this.preview();
    return true;
  }

  // GM08b eyedropper: the level takes the ground height under the cursor, to the centimetre.
  pickLevel() {
    const map = this.editor.draftMap || this.editor.map, height = map.heightAt(this.point.x, this.point.z);
    const level = Math.round(Math.max(TERRAIN_MIN_HEIGHT, Math.min(TERRAIN_GRID_MAX_HEIGHT, height)) * 100) / 100;
    this.panel.picking = false; this.panel.level = level; this.panel.render();
    this.editor._setStatus(editorMessage(`Level set to ${level.toFixed(2)} m.`, `Nivel fijado en ${level.toFixed(2)} m.`), 'ok');
    this.drawCursor();
  }

  _edit(stroke) {
    const { selection, feather, ...parameters } = stroke.parameters;
    return isRegion(stroke.parameters) ? { document: stroke.base, ...parameters, region: { shape: selection, points: stroke.points, feather } }
      : { document: stroke.base, ...parameters, points: stroke.points };
  }

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
    if (!stroke || (this.tool === 'ramp' && stroke.points.length < 2) ||
        (stroke.parameters.selection === 'lasso' && stroke.points.length < 3)) return;
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
    if (stroke.parameters.selection === 'lasso' && stroke.points.length < 3) {
      this._showBase(stroke);
      this.editor._setStatus(editorMessage('Lasso too small: drag around a larger area. Nothing was saved.',
        'Lazo demasiado pequeño: arrastra alrededor de un área mayor. No se guardó ningún cambio.'), 'error');
      this.drawCursor();
      return;
    }
    if (stroke.points.length >= STROKE_LIMIT || (stroke.parameters.tool === 'ramp' && stroke.points.length < 2)) {
      this.editor.lastError = new Error('stroke_limit');
      this._showBase(stroke); this.editor._setStatus(blocked(), 'error'); this.drawCursor();
      return;
    }
    const region = isRegion(stroke.parameters);
    const task = this.editor._commitTerrainStroke(this._edit(stroke), stroke).then((committed) => {
      if (!this.editor.active) return committed;
      if (committed) {
        this.lastPoint = { ...stroke.points.at(-1) };
        this.editor._setStatus(region
          ? editorMessage('Region kept in the private draft. Undo reverses it whole.', 'Región conservada en el borrador privado. Deshacer la revierte entera.')
          : editorMessage('Terrain stroke kept in the private draft. Undo reverses the whole stroke.',
            'Trazo de terreno conservado en el borrador privado. Deshacer revierte el trazo completo.'), 'ok');
      } else this.editor._setStatus(blocked(), 'error');
      this.drawCursor();
      return committed;
    });
    this.drawCursor();
    return task;
  }

  cancel() {
    const stroke = this.stroke, picking = this.panel.picking; this.stroke = null;
    if (picking) { this.panel.picking = false; this.panel.render(); }
    if (stroke && this.editor.active) this._showBase(stroke);
    if (this.editor.active && !this.editor.walkPreview?.active) this.editor.cameraController.enable();
    this.cursor.visible = false; this.editor.invalidate();
    return !!stroke || picking;
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
