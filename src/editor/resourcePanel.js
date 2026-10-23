import { resourceDescriptor, sourceAssetId } from './resourceAdapters.js';

const RESOURCE_ASSETS = ['prop:gm-resource-palm-v1', 'prop:gm-resource-stone-v1'];

/** Dedicated palette for the two authored resources; arbitrary decoration stays decorative. */
export class ResourcePanel {
  constructor({ editor, root } = {}) {
    if (!editor || !root) throw new TypeError('ResourcePanel requires editor and root');
    this.editor = editor;
    this.root = root;
    this.busy = new Set();
    this.onClick = (event) => {
      const button = event.target.closest('[data-resource-asset]');
      if (!button || button.disabled) return;
      this.choose(button.dataset.resourceAsset);
    };
    this.root.addEventListener('click', this.onClick);
    this.render();
  }

  async choose(assetId) {
    const descriptor = resourceDescriptor(assetId);
    if (!descriptor || this.busy.has(assetId)) return false;
    this.busy.add(assetId); this.render();
    try {
      const entry = { ...descriptor, id: assetId, kind: 'prop',
        label: descriptor.label || descriptor.name || assetId };
      const physicalId = sourceAssetId(assetId);
      const state = this.editor.assets.list?.().find((record) => record.id === physicalId)?.state;
      if (state !== 'ok') {
        const physical = this.editor.assets.entry?.(physicalId);
        if (!physical || !await this.editor.assets.ensureModel(physical, { base: physical.base || 'assets/' })) {
          this.editor._setError?.(new Error(this.editor._t('Resource model could not be loaded.', 'No se pudo cargar el modelo del recurso.')), 'asset');
          return false;
        }
      }
      const model = this.editor.assets.model(assetId);
      if (!model) return false;
      this.editor._selectAsset(entry, model);
      return true;
    } finally { this.busy.delete(assetId); this.render(); }
  }

  render() {
    const lang = this.editor.lang === 'en' ? 'en' : 'es';
    const tr = (en, es) => lang === 'en' ? en : es;
    const objects = this.editor.document?.objects || [];
    const count = (id) => objects.filter((item) => item.assetId === id).length;
    const cards = RESOURCE_ASSETS.map((id) => {
      const descriptor = resourceDescriptor(id);
      const label = descriptor?.label?.[lang] || descriptor?.label?.es || descriptor?.name?.[lang]
        || descriptor?.name?.es || (id.endsWith('palm-v1') ? tr('Cuttable palm', 'Palmera talable') : tr('Pickable stone', 'Piedra recogible'));
      const help = id.endsWith('palm-v1')
        ? tr('Use the normal axe and cooperative three-hit logging cycle.', 'Usa el hacha y el ciclo normal de tala cooperativa de tres golpes.')
        : tr('Gather it with the normal resource command.', 'Se recoge con el comando normal de recursos.');
      return `<article class="gm-resource-card" data-resource="${id}">
        <div><b>${label}</b><small>${help}</small></div>
        <button type="button" data-resource-asset="${id}" ${this.busy.has(id) ? 'disabled' : ''}>${this.busy.has(id) ? tr('Loading…', 'Cargando…') : tr('Place', 'Colocar')}</button>
        <small>${count(id)} ${tr('in draft', 'en el borrador')}</small>
      </article>`;
    }).join('');
    this.root.innerHTML = `<section class="gm-resource-panel" aria-label="${tr('Functional resources', 'Recursos funcionales')}">
      <h3>${tr('Resources', 'Recursos')}</h3>
      <p>${tr('Place palms and stones that players can gather after you publish in Online. Test the layout privately in your draft.',
        'Coloca palmeras y piedras que los jugadores podrán recoger cuando publiques en Online. Prueba la distribución en tu borrador privado.')}</p>
      <p>${tr('Limit: 128 authored resources per revision. Palms use the existing axe; stones use normal gathering.',
        'Límite: 128 recursos añadidos por revisión. Las palmeras usan el hacha existente; las piedras usan la recogida normal.')}</p>
      ${cards}<p>${tr('Place on dry, gently sloping ground, at least 5 m from other resources. Palms can rotate and scale from 0.75 to 1.25; stones keep their size.',
        'Coloca en suelo seco de pendiente suave, a 5 m de otros recursos. Las palmeras permiten giro y escala de 0,75 a 1,25; las piedras conservan su tamaño.')}</p></section>`;
  }

  dispose() {
    this.root?.removeEventListener('click', this.onClick);
    this.root?.replaceChildren();
  }
}
