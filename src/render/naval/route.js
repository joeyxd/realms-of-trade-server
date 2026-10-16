import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { toon } from '../toon.js';
import { t } from '../../core/i18n.js';

const MAX_SHOTS = 2;
const material = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, ...opts });
function depthAware(mat) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FXU);
    shader.fragmentShader = GLSL_FX_DEPTH + shader.fragmentShader.replace(
      '#include <opaque_fragment>', 'diffuseColor.a *= fxDepthFadeBias(0.08, 0.12);\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'naval-route-depth-v1';
  return mat;
}

// Small pooled meshes keep the optional practice encounter inside the existing scene budget.
export class NavalRouteRenderer {
  constructor(scene, { mobile = false } = {}) {
    this.scene = scene; this.mobile = !!mobile; this.disposed = false;
    this.root = new THREE.Group(); this.root.visible = false; scene.add(this.root);
    this.buoyMaterial = toon({ color: 0xf1cf7c }, { occluder: true, key: 'naval-route-buoy-v1' });
    this.doneMaterial = toon({ color: 0x77d6b9 }, { occluder: true, key: 'naval-route-buoy-done-v1' });
    this.raftMaterial = toon({ color: 0x604b35 }, { occluder: true, key: 'naval-route-wood-v1' });
    this.raftEdge = toon({ color: 0xd2b879 }, { occluder: true, key: 'naval-route-edge-v1' });
    this.cannonMaterial = toon({ color: 0x272b2b }, { occluder: true, key: 'naval-route-cannon-v1' });
    this.markerMaterial = depthAware(material('#78a99a', { transparent: true, opacity: 0.36, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.diskMaterial = depthAware(material('#e6a844', { transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.ballMaterial = material('#171717');
    this.buoys = Array.from({ length: 3 }, () => {
      const group = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.016, 5, 36), this.markerMaterial); ring.rotation.x = Math.PI / 2; ring.position.y = 0.13; ring.layers.set(LAYER.FX); ring.renderOrder = 3; group.add(ring);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.7, 6), this.buoyMaterial); stem.position.y = 0.48; group.add(stem);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.38, 5), this.buoyMaterial); cap.position.y = 0.94; group.add(cap);
      ring.userData.radiusMarker = true;
      this.root.add(group); return group;
    });
    this.enemy = new THREE.Group(); this.root.add(this.enemy);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.48, 2.1), this.raftMaterial); hull.position.y = 0.25; this.enemy.add(hull);
    for (let i = -1; i <= 1; i++) { const plank = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, 2.2), this.raftEdge); plank.position.set(i * 1.15, 0.55, 0); this.enemy.add(plank); }
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.25, 8), this.cannonMaterial); mount.position.set(0, 0.75, 0); this.enemy.add(mount);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.25, 8), this.cannonMaterial); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.92, 0.7); this.enemy.add(barrel);
    this.disks = Array.from({ length: MAX_SHOTS }, () => {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 28), this.diskMaterial); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.12; mesh.visible = false; mesh.layers.set(LAYER.FX); mesh.renderOrder = 3; this.root.add(mesh); return mesh;
    });
    this.balls = Array.from({ length: MAX_SHOTS }, () => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.ballMaterial); mesh.visible = false; mesh.layers.set(LAYER.FX); mesh.renderOrder = 4; this.root.add(mesh); return mesh;
    });
  }

  update(route, tick = 0) {
    if (this.disposed) return;
    const active = !!route?.active && route.status !== 'aborted' && route.status !== 'complete';
    this.root.visible = active;
    if (!active) return;
    for (let i = 0; i < this.buoys.length; i++) {
      const buoy = route.buoys?.[i], mesh = this.buoys[i]; mesh.visible = !!buoy;
      if (!buoy) continue;
      mesh.position.set(buoy.x, 0, buoy.z);
      mesh.children[0].scale.setScalar(Math.max(0.5, Number(buoy.radius) || 2));
      mesh.children.forEach((child) => { if (!child.userData.radiusMarker) child.material = i < route.next ? this.doneMaterial : this.buoyMaterial; });
    }
    if (route.threat) { this.enemy.visible = true; this.enemy.position.set(route.threat.x, 0, route.threat.z); this.enemy.rotation.y = Number(route.threat.yaw) || 0; }
    else this.enemy.visible = false;
    const shots = (route.shots || []).slice(-MAX_SHOTS);
    for (let i = 0; i < MAX_SHOTS; i++) {
      const shot = shots[i], disk = this.disks[i], ball = this.balls[i];
      disk.visible = !!shot; ball.visible = !!shot;
      if (!shot) continue;
      const radius = Math.max(1, Number(shot.radius) || 4), elapsed = Math.max(0, tick - (Number(shot.t0) || tick));
      disk.position.set(shot.x, 0.12, shot.z); disk.scale.set(radius, radius, 1);
      const span = Math.max(1, (Number(shot.impactTick) || tick + 1) - (Number(shot.t0) || tick));
      const t = Math.max(0, Math.min(1, elapsed / span)), from = shot.from || route.threat || shot;
      ball.position.set(from.x + (shot.x - from.x) * t, 1 + Math.sin(t * Math.PI) * Math.min(5, span * 0.08), from.z + (shot.z - from.z) * t);
    }
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.scene.remove(this.root);
    this.root.traverse((object) => { if (object.geometry) object.geometry.dispose(); });
    for (const mat of [this.buoyMaterial, this.doneMaterial, this.raftMaterial, this.raftEdge, this.cannonMaterial, this.markerMaterial, this.diskMaterial, this.ballMaterial]) mat.dispose();
  }
}

export function routePresentation(route) {
  const status = route?.status || 'ready';
  const next = Math.max(0, Number(route?.next) || 0);
  const hits = Math.max(0, Number(route?.hits) || 0), dodged = Math.max(0, Number(route?.dodged) || 0);
  const stage = status === 'outbound' ? t('systems.naval.route.buoys', { next: Math.min(3, next + 1) })
    : status === 'returning' ? t('systems.naval.route.return') : status === 'complete' ? t('systems.naval.route.complete')
      : status === 'aborted' ? t('systems.naval.route.aborted') : t('nav.practice');
  const damage = Math.max(0, Number(route?.damage) || 0);
  const score = `${hits} ${t(hits === 1 ? 'systems.naval.route.hit.one' : 'systems.naval.route.hit.other')} · ${dodged} ${t(dodged === 1 ? 'systems.naval.route.dodge.one' : 'systems.naval.route.dodge.other')} · ${damage} HP`;
  return { stage, score, active: !!route?.active };
}

export function routeTarget(route, voyage) {
  if (voyage?.phase === 'shore') return voyage.recovery
    ? voyage.landing || voyage.home || voyage.target || null
    : voyage.landing || voyage.target || voyage.home || null;
  return route?.active ? route.target : voyage?.target || voyage?.landing || voyage?.home || null;
}

export function routeCommand(route, epoch) {
  if (!route?.available || !Number.isInteger(epoch)) return null;
  return { t: 'cmd', type: 'navalPilot', op: route.active ? 'routeAbort' : 'routeStart', epoch };
}
