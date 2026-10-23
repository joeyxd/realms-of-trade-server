// Short cosmetic reveal of already-awarded goods; never a second collectible or inventory mutation.
import { assets } from './assets/registry.js';

export class HarvestGoods {
  constructor(scene) { this.scene = scene; this.items = []; this.receipts = new Set(); }

  award(event, node) {
    if (event?.ok !== true || event.felled !== true || event.replay || event.historical || !event.loot || !node ||
        ![node.x, node.y, node.z].every(Number.isFinite) || typeof event.opId !== 'string') return false;
    const receipt = `${node.id}:${event.rev}:${event.opId}`;
    if (this.receipts.has(receipt)) return false;
    this.receipts.add(receipt);
    if (this.receipts.size > 128) this.receipts.delete(this.receipts.values().next().value);
    let added = false;
    for (const good of ['resina', 'coco']) {
      if (event.loot[good] !== 1) continue;
      const object = assets.model(`model:item-${good}-v1`);
      if (!object) continue;
      if (this.items.length >= 8) this.scene.remove(this.items.shift().object);
      const side = good === 'coco' ? 1 : -1;
      object.position.set(node.x + side * .5, node.y + 1.5, node.z + .4);
      object.userData.harvestGood = good;
      this.scene.add(object); this.items.push({ object, x: object.position.x, y: node.y, z: object.position.z, t: 0, side });
      added = true;
    }
    return added;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]; item.t += Math.max(0, Math.min(.1, dt));
      if (item.t >= 2.4) { this.scene.remove(item.object); this.items.splice(i, 1); continue; }
      const fall = Math.min(1, item.t / .7), leave = Math.max(0, (item.t - 1.8) / .6);
      item.object.position.set(item.x + item.side * fall * .3, item.y + .1 + 1.4 * (1 - fall * fall), item.z);
      item.object.rotation.y += dt * 1.5;
      item.object.scale.setScalar(1 - leave);
    }
  }

  reset() {
    for (const item of this.items) this.scene.remove(item.object);
    this.items.length = 0; this.receipts.clear();
  }
}
