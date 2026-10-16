// Debug lines (F4 → "Mostrar hitboxes"): hurtboxes, parry and swing sectors, projectile radii.
// One LineSegments with a fixed vertex budget, refilled each frame; drawn on top of everything.
import * as THREE from 'three';
import { LAYER } from './pipeline.js';

export class DebugDraw {
  constructor(scene, cap = 12000) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
    this.lines.frustumCulled = false;
    this.lines.layers.set(LAYER.FX);
    this.lines.renderOrder = 99;
    this.lines.visible = false;
    scene.add(this.lines);
    this.n = 0;
    this.c = new THREE.Color();
  }
  begin() { this.n = 0; }
  seg(x0, y0, z0, x1, y1, z1) {
    if (this.n + 2 > this.cap) return;
    const p = this.pos, c = this.col, i = this.n * 3;
    p[i] = x0; p[i + 1] = y0; p[i + 2] = z0; p[i + 3] = x1; p[i + 4] = y1; p[i + 5] = z1;
    c[i] = c[i + 3] = this.c.r; c[i + 1] = c[i + 4] = this.c.g; c[i + 2] = c[i + 5] = this.c.b;
    this.n += 2;
  }
  // Arc around (x, z) at height y; facing in the game convention (0 = +z), arc in degrees (360 = circle).
  sector(x, y, z, r, facing, arc, color, segs = 28) {
    this.c.set(color);
    const a0 = facing - (arc * Math.PI) / 360, span = (arc * Math.PI) / 180;
    let px = x + Math.sin(a0) * r, pz = z + Math.cos(a0) * r;
    if (arc < 360) this.seg(x, y, z, px, y, pz);
    for (let i = 1; i <= segs; i++) {
      const a = a0 + (span * i) / segs, nx = x + Math.sin(a) * r, nz = z + Math.cos(a) * r;
      this.seg(px, y, pz, nx, y, nz);
      px = nx; pz = nz;
    }
    if (arc < 360) this.seg(px, y, pz, x, y, z);
  }
  circle(x, y, z, r, color, segs = 20) { this.sector(x, y, z, r, 0, 360, color, segs); }
  end(visible) {
    const g = this.lines.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    this.lines.visible = visible && this.n > 0;
  }
}
