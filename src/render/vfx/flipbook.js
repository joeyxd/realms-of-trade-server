import * as THREE from 'three';

// A baked Niagara view is a billboard animation, not a Niagara simulation.
// Only the compiled effect registry supplies resource URLs and atlas geometry.
export async function loadFlipbookTexture(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Effect atlas unavailable');
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  if (signal.aborted) { bitmap.close(); throw new Error('Effect load cancelled'); }
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function releaseTexture(texture) {
  texture?.dispose();
  texture?.image?.close?.();
}

export class FlipbookEffect {
  constructor(parent, { loadTexture = loadFlipbookTexture } = {}) {
    this.loadTexture = loadTexture;
    this.material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.visible = false;
    parent.add(this.sprite);
    this.state = 'idle'; this.epoch = 0; this.frame = -1;
  }

  async setEffect(effect, quality = 'desktop') {
    this.cancelLoad();
    const epoch = this.epoch;
    this.effect = effect;
    this.quality = quality;
    this.state = 'loading'; this.sprite.visible = false; this.frame = -1;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      const texture = await this.loadTexture(effect.atlas[quality], signal);
      if (this.disposed || epoch !== this.epoch) { releaseTexture(texture); return; }
      if (!texture.image?.width || texture.image.width % effect.columns ||
          !texture.image.height || texture.image.height % effect.rows) {
        releaseTexture(texture); throw new Error('Invalid effect atlas dimensions');
      }
      this.texture = texture;
      texture.repeat.set(1 / effect.columns, 1 / effect.rows);
      this.material.map = texture;
      this.material.blending = effect.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
      this.material.needsUpdate = true;
      this.state = 'ready';
    } catch {
      if (!this.disposed && epoch === this.epoch) this.state = 'error';
    }
  }

  cancelLoad() {
    this.epoch++;
    this.controller?.abort(); this.controller = null;
    this.material.map = null;
    releaseTexture(this.texture); this.texture = null;
    this.sprite.visible = false;
    this.effect = null; this.state = 'idle'; this.frame = -1;
  }

  duration(parameters) { return this.effect.duration * parameters.duration / parameters.speed; }

  update(age, parameters) {
    const e = this.effect;
    if (!e || this.state !== 'ready') { this.sprite.visible = false; return; }
    const life = this.duration(parameters);
    const frame = Math.min(e.frames - 1, Math.floor(age / life * e.frames));
    this.sprite.visible = age >= 0 && age < life && parameters.opacity > 0;
    if (frame !== this.frame && frame >= 0) {
      this.frame = frame;
      this.texture.offset.set((frame % e.columns) / e.columns, (e.rows - 1 - Math.floor(frame / e.columns)) / e.rows);
    }
    this.sprite.scale.set(e.width * parameters.scale, e.height * parameters.scale * parameters.height, 1);
    this.sprite.position.set(0, e.height * parameters.scale * parameters.height / 2, 0);
    this.material.color.set(parameters.tint).multiplyScalar(parameters.brightness);
    this.material.opacity = parameters.opacity;
  }

  reset() { this.frame = -1; this.sprite.visible = false; }
  get metrics() {
    return { textureState: this.state, atlasPixels: this.texture ? this.texture.image.width * this.texture.image.height : 0, frame: this.frame };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.cancelLoad(); this.material.dispose(); this.sprite.removeFromParent();
  }
}
