const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

const labelFor = (entry, lang = 'es') => {
  const label = entry.label || entry.name;
  return typeof label === 'string' ? label : label?.[lang] || label?.es || label?.en || entry.id;
};

/** Manifest-backed, on-demand catalog for models that are safe to place as decoration. */
export class EditorCatalog {
  constructor({ root, assets, onSelect = () => {}, entries = null, t = (en, es) => es } = {}) {
    if (!root || !assets) throw new TypeError('EditorCatalog requires root and assets');
    this.root = root;
    this.assets = assets;
    this.onSelect = onSelect;
    this.entries = entries;
    this.t = t;
    this.query = '';
    this.lang = 'es';
    this.busy = new Set();
    this.generation = 0;
    this.status = '';
    this.onInput = () => { this.query = this.search.value.trim().toLocaleLowerCase(); this.renderList(); };
    this.onClick = (event) => {
      const button = event.target.closest('[data-editor-asset]');
      if (!button || button.disabled) return;
      this.choose(button.dataset.editorAsset);
    };
    this.root.innerHTML = `
      <section class="gm-catalog" data-role="catalog-section">
        <header><h2 data-role="catalog-title"></h2><span class="gm-catalog-count"></span></header>
        <label class="gm-search"><span data-role="search-label"></span>
          <input type="search" autocomplete="off">
        </label>
        <div class="gm-catalog-status" aria-live="polite"></div>
        <div class="gm-catalog-list" role="listbox"></div>
      </section>`;
    this.search = this.root.querySelector('input');
    this.list = this.root.querySelector('.gm-catalog-list');
    this.count = this.root.querySelector('.gm-catalog-count');
    this.statusNode = this.root.querySelector('.gm-catalog-status');
    this.title = this.root.querySelector('[data-role="catalog-title"]');
    this.searchLabel = this.root.querySelector('[data-role="search-label"]');
    this.search.addEventListener('input', this.onInput);
    this.root.addEventListener('click', this.onClick);
    this.setLanguage(this.lang);
    this.refresh();
    this.ready = this.load();
  }

  async load() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const results = await Promise.allSettled(['catalog.json', 'thumbnails.json'].map(async (name) => {
        const response = await fetch(`assets/editor/${name}`, { cache: 'no-cache', signal: controller.signal });
        return response.ok ? response.json() : null;
      }));
      const data = results[0].status === 'fulfilled' ? results[0].value : null;
      const metadata = results[1].status === 'fulfilled' ? results[1].value : null;
      if (data?.version === 1 && Array.isArray(data.assets)) this.preparedEntries = data.assets.filter((entry) => entry && entry.kind === 'model' &&
        typeof entry.id === 'string' && typeof entry.src === 'string');
      this.metadata = metadata?.version === 1 ? metadata.assets : null;
      this.refresh();
    } catch { /* Manifest models remain browsable if the prepared catalog is unavailable. */ }
    finally { clearTimeout(timeout); }
    return this.items;
  }

  refresh(entries = this.entries) {
    this.entries = entries || this.assets.editorCatalog || null;
    const source = this.entries || [...(this.assets.man?.entries?.values?.() || [])];
    const merged = new Map(source.filter((entry) => entry && ['model', 'prop'].includes(entry.kind) &&
      typeof entry.id === 'string').map((entry) => [entry.id, entry]));
    for (const entry of this.preparedEntries || []) merged.set(entry.id, entry);
    this.items = [...merged.values()].map((entry) => {
      const metadata = this.metadata?.[entry.id] || {};
      const item = { ...entry, thumbnail: metadata.thumbnail || entry.thumbnail,
        stats: { ...metadata.stats, ...entry.stats }, label: entry.label || metadata.label };
      return { ...item, label: labelFor(item, this.lang) };
    })
      .sort((a, b) => a.label.localeCompare(b.label));
    this.renderList();
    return this.items;
  }

  filtered() {
    if (!this.query) return this.items;
    return this.items.filter((item) => `${item.label} ${item.id} ${item.notes || ''} ${item.category || ''}`
      .toLocaleLowerCase().includes(this.query));
  }

  setStatus(message, kind = '') {
    this.status = message;
    this.statusNode.textContent = message;
    this.statusNode.dataset.kind = kind;
  }

  setLanguage(lang) {
    this.lang = lang === 'en' ? 'en' : 'es';
    this.title.textContent = this.t('Library', 'Biblioteca');
    this.searchLabel.textContent = this.t('Search models', 'Buscar modelos');
    this.search.placeholder = this.t('Name or ID', 'Nombre o ID');
    this.root.querySelector('[data-role="catalog-section"]').setAttribute('aria-label', this.t('Asset library', 'Biblioteca de assets'));
    this.refresh();
  }

  renderList() {
    if (!this.list) return;
    const items = this.filtered();
    this.count.textContent = String(items.length);
    if (!items.length) {
      this.list.innerHTML = `<p class="gm-empty">${escapeHtml(this.t('No matching models', 'No hay modelos coincidentes'))}</p>`;
      return;
    }
    this.list.innerHTML = items.map((item) => {
      const thumb = item.thumbnail || item.preview || '';
      const icon = thumb
        ? `<img loading="lazy" src="${escapeHtml(thumb)}" alt="">`
        : `<span class="gm-asset-icon" aria-hidden="true">${escapeHtml((item.category || item.kind).slice(0, 1).toUpperCase())}</span>`;
      const stats = item.stats || {};
      const triangles = stats.triangles || item.tris || 0;
      const size = stats.bytes ? ' · ' + (stats.bytes < 1e6 ? Math.ceil(stats.bytes / 1000) + ' KB' : (stats.bytes / 1e6).toFixed(1) + ' MB') : '';
      const mesh = triangles ? ' · ' + Number(triangles).toLocaleString() + ' tris' : '';
      const variant = item.variant?.label || (item.kind === 'prop' ? this.t('Map prop', 'Prop del mapa') : this.t('Model', 'Modelo'));
      const candidate = item.status === 'candidate' ? ' · ' + this.t('candidate', 'candidato') : '';
      const loading = this.busy.has(item.id);
      return `<button class="gm-asset-card" type="button" role="option" data-editor-asset="${escapeHtml(item.id)}" ${loading ? 'disabled' : ''}>
        <span class="gm-asset-thumb">${icon}</span><span class="gm-asset-copy">
          <b title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</b><small>${escapeHtml(mesh.replace(/^ · /, '') + size)}</small><small title="${escapeHtml(item.id)}">${escapeHtml(variant + candidate)}</small>
        </span><span class="gm-asset-ready">${loading ? '…' : '＋'}</span>
      </button>`;
    }).join('');
  }

  async choose(id) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item || this.busy.has(id)) return;
    const generation = this.generation;
    this.busy.add(id); this.renderList();
    this.setStatus(this.t('Preparing model…', 'Preparando modelo…'));
    try {
      const state = this.assets.list?.().find((record) => record.id === id)?.state;
      if (state !== 'ok' && this.assets.ensureModel) {
        const ready = await this.assets.ensureModel(item, { base: item.base || 'assets/' });
        if (!ready) throw new Error(this.t('Model could not be loaded.', 'No se pudo cargar el modelo.'));
      }
      const object = this.assets.model(id);
      if (!object) throw new Error(this.t('Model is not ready.', 'El modelo no está listo.'));
      if (generation !== this.generation) return;
      this.setStatus(this.t('Ready to place.', 'Listo para colocar.'), 'ok');
      this.onSelect({ entry: item, object });
    } catch (error) {
      if (generation === this.generation) this.setStatus(error?.message || this.t('Model could not be loaded.', 'No se pudo cargar el modelo.'), 'error');
    } finally {
      this.busy.delete(id); this.renderList();
    }
  }

  dispose() {
    this.search?.removeEventListener('input', this.onInput);
    this.root?.removeEventListener('click', this.onClick);
    this.root?.replaceChildren();
  }
}
