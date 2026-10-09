const $ = (id) => document.getElementById(id);
const STATES = { pending: 'Pendiente', reference: 'Referencia', prepared: 'Archivos preparados', applied: 'Aplicado en juego' };
const KINDS = { material: 'Material', object: 'Objeto', prefab: 'Conjunto', system: 'Sistema' };
const ROLES = { reference: 'Referencia', preview: 'Vista previa', albedo: 'Albedo / color', normal: 'Normal', roughness: 'Roughness', metallic: 'Metallic', ao: 'Oclusión / AO', mask: 'Máscara', opacity: 'Alfa / recorte', emissive: 'Emisión', model: 'Modelo', mobile: 'Variante móvil', source: 'Fuente editable', evidence: 'Aplicación' };
let catalog;
let category = 'all';
let selectedId;
let uploadBusy = false;
let noteDirty = false;
const drafts = new Map();
let toastTimer;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function fileURL(path) {
  return '/files/' + path.split('/').map(encodeURIComponent).join('/');
}
function isImage(file) { return /\.(png|jpe?g|webp)$/i.test(file.path); }
function imageFiles(row) {
  return [...row.references, ...row.files.filter((f) => f.role === 'preview'), ...row.files.filter(isImage), ...row.evidence.filter(isImage)].filter(isImage).filter((f, i, list) => list.findIndex((x) => x.path === f.path) === i);
}
function categoryIcon(name) {
  if (/costa|terreno/i.test(name)) return '◒';
  if (/vegeta/i.test(name)) return '✳';
  if (/material/i.test(name)) return '◈';
  if (/constru|edific/i.test(name)) return '▧';
  if (/barco|embarca/i.test(name)) return '⚑';
  if (/person/i.test(name)) return '♙';
  if (/ambiente|render/i.test(name)) return '☼';
  return '▣';
}
function toast(message, error = false) {
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 8000 : 4000);
}
async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let data;
  try { data = await response.json(); } catch { throw new Error('El catálogo no pudo leer la respuesta.'); }
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'No se pudo guardar el cambio.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function setCatalog(result) {
  const next = result.catalog || result;
  if (next.rows && Number.isInteger(next.revision)) catalog = next;
}
async function refresh() {
  setCatalog(await api('/api/catalog'));
  render();
  $('save-indicator').textContent = 'Guardado en el proyecto';
}
function renderNav() {
  const nav = $('category-nav');
  nav.replaceChildren();
  const categories = [...new Set(catalog.rows.map((r) => r.category))];
  for (const item of [{ key: 'all', label: 'Todas las piezas', count: catalog.rows.length }, ...categories.map((c) => ({ key: c, label: c, count: catalog.rows.filter((r) => r.category === c).length }))]) {
    const button = el('button', 'nav-button' + (category === item.key ? ' active' : ''));
    button.type = 'button';
    button.setAttribute('aria-pressed', String(category === item.key));
    button.append(el('span', 'nav-icon', item.key === 'all' ? '▦' : categoryIcon(item.label)), el('span', '', item.label), el('small', '', String(item.count)));
    button.addEventListener('click', () => { category = item.key; render(); });
    nav.append(button);
  }
}
function filteredRows() {
  const query = $('search').value.trim().toLocaleLowerCase('es');
  return catalog.rows.filter((row) => (category === 'all' || row.category === category)
    && ($('state-filter').value === 'all' || row.state === $('state-filter').value)
    && ($('kind-filter').value === 'all' || row.kind === $('kind-filter').value)
    && (!query || [row.id, row.name, row.category, row.description, ...row.variants, row.notes].join(' ').toLocaleLowerCase('es').includes(query)));
}
function appendVariants(parent, variants, limit = variants.length) {
  for (const variant of variants.slice(0, limit)) parent.append(el('span', 'variant', variant));
  if (variants.length > limit) parent.append(el('span', 'variant', '+' + (variants.length - limit)));
}
function preview(row) {
  const node = el('button', 'row-preview');
  node.type = 'button';
  node.setAttribute('aria-label', 'Ver imágenes de ' + row.name);
  const image = imageFiles(row)[0];
  if (image) {
    const img = el('img');
    img.src = fileURL(image.path);
    img.alt = image.label || image.name || row.name;
    img.loading = 'lazy';
    img.addEventListener('error', () => { node.replaceChildren(el('div', 'preview-placeholder', 'Imagen no disponible')); });
    node.append(img, el('span', 'preview-origin', row.references.some((f) => f.path === image.path) ? 'REFERENCIA / VISTA PREVIA' : 'ARCHIVO REAL'));
  } else {
    const placeholder = el('div', 'preview-placeholder', categoryIcon(row.category));
    placeholder.append(el('small', '', row.state === 'reference' ? 'Referencia en el chat' : 'Imagen pendiente'));
    node.append(placeholder);
  }
  node.addEventListener('click', () => openPiece(row.id));
  return node;
}
function renderRows() {
  const rows = filteredRows();
  $('library-title').firstChild.textContent = category === 'all' ? 'Todas las piezas ' : category + ' ';
  $('visible-count').textContent = rows.length;
  $('reset-filters').hidden = category === 'all' && !$('search').value && $('state-filter').value === 'all' && $('kind-filter').value === 'all';
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const node = el('article', 'asset-row');
    node.dataset.rowId = row.id;
    const identity = el('div', 'piece-identity');
    const meta = el('div', 'row-meta');
    meta.append(el('span', 'priority ' + row.priority.toLowerCase(), row.priority), el('span', '', KINDS[row.kind] + ' · ' + row.category));
    identity.append(meta, el('h3', '', row.name), el('p', '', row.description));
    const variants = el('div', 'variants');
    appendVariants(variants, row.variants, 3);
    identity.append(variants);
    const files = el('div', 'file-overview');
    files.append(el('strong', '', row.files.length ? row.files.length + (row.files.length === 1 ? ' archivo real' : ' archivos reales') : 'Archivos pendientes'));
    if (row.files.length) {
      const first = row.files[0];
      files.append(el('small', '', first.path.split('/').pop()));
      const link = el('a', '', 'Abrir archivo ↗');
      link.href = fileURL(first.path); link.target = '_blank'; link.rel = 'noopener';
      files.append(link);
    } else files.append(el('small', '', row.references.length ? 'Referencia disponible' : row.state === 'reference' ? 'Lámina recibida en el chat' : 'Añadir mapa o modelo'));
    const progress = el('div', 'row-progress');
    progress.append(el('span', 'badge ' + row.state, STATES[row.state]), el('p', '', row.nextStep));
    const button = el('button', 'row-open', 'Ficha ↗');
    button.type = 'button';
    button.setAttribute('aria-label', 'Abrir ficha de ' + row.name);
    button.addEventListener('click', () => openPiece(row.id));
    node.append(identity, preview(row), files, progress, button);
    fragment.append(node);
  }
  if (!rows.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('strong', '', 'No hay piezas con estos filtros.'), el('span', '', 'Prueba otra búsqueda o limpia los filtros.'));
    fragment.append(empty);
  }
  $('rows').replaceChildren(fragment);
}
function render() {
  renderNav(); renderRows();
  $('count-total').textContent = catalog.rows.length;
  $('count-reference').textContent = catalog.rows.filter((r) => r.state === 'reference' || imageFiles(r).length).length;
  $('count-prepared').textContent = catalog.rows.filter((r) => r.state === 'prepared' || r.state === 'applied').length;
  const applied = catalog.rows.filter((r) => r.state === 'applied').length;
  $('count-applied').textContent = applied;
  $('progress-bar').style.width = 100 * applied / Math.max(1, catalog.rows.length) + '%';
  if (!$('hero-image').src) {
    const hero = catalog.rows.flatMap((r) => r.references).find((f) => /hero\.png$/.test(f.path));
    if (hero) {
      $('hero-image').src = fileURL(hero.path);
      $('hero-image').hidden = false;
      $('hero-image').addEventListener('load', () => { document.querySelector('.hero-art-fallback').hidden = true; });
      $('hero-image').addEventListener('error', () => { $('hero-image').hidden = true; });
    }
  }
}
function fileCard(file, roleOverride) {
  const card = el('div', 'file-card');
  card.append(el('span', 'file-icon', file.path.split('.').pop().toUpperCase().slice(0, 5)));
  const content = el('div');
  const link = el('a', '', file.label || file.name || file.path.split('/').pop());
  link.href = fileURL(file.path); link.target = '_blank'; link.rel = 'noopener';
  content.append(link, el('small', '', file.path), el('div', 'file-role', ROLES[roleOverride || file.role] || 'Archivo'));
  card.append(content);
  return card;
}
function gallery(row) {
  const container = $('piece-gallery');
  container.replaceChildren();
  const images = imageFiles(row);
  if (!images.length) {
    const empty = el('div', 'gallery-empty');
    empty.append(el('strong', '', row.state === 'reference' ? 'Dirección visual recibida' : 'Aquí empieza la pieza.'), el('p', '', row.state === 'reference' ? 'La lámina está en nuestra conversación. Añade su archivo original aquí para conservarla junto a los materiales.' : 'Guarda una referencia de arte y después incorpora sus mapas o su modelo.'));
    container.append(empty);
  }
  for (const file of images) {
    const link = el('a', 'gallery-image');
    link.href = fileURL(file.path); link.target = '_blank'; link.rel = 'noopener';
    const figure = el('figure'); const img = el('img');
    img.src = fileURL(file.path); img.alt = file.label || file.name || row.name; img.loading = 'lazy';
    figure.append(img, el('figcaption', '', (ROLES[file.role] || 'Vista') + ' · ' + (file.label || file.name || file.path.split('/').pop())));
    link.append(figure); container.append(link);
  }
}
function renderPiece({ preserveEdits = false } = {}) {
  const row = catalog.rows.find((r) => r.id === selectedId);
  if (!row) return;
  $('piece-title').textContent = row.name;
  $('piece-category').textContent = row.priority + ' · ' + KINDS[row.kind] + ' · ' + row.category;
  $('piece-description').textContent = row.description;
  $('piece-variants').replaceChildren(); appendVariants($('piece-variants'), row.variants);
  gallery(row);
  $('piece-file-count').textContent = '(' + row.files.length + ')';
  $('piece-files').replaceChildren(...row.files.map((f) => fileCard(f)));
  if (!row.files.length) $('piece-files').append(el('p', 'file-empty', 'Los archivos reales de esta pieza aparecerán aquí.'));
  if (row.references.length) {
    $('piece-files').append(el('h3', '', 'Referencias guardadas'), ...row.references.map((f) => fileCard(f)));
  }
  $('piece-evidence').replaceChildren(...row.evidence.map((f) => fileCard(f, 'evidence')));
  if (!row.evidence.length) $('piece-evidence').append(el('p', 'file-empty', 'Añadiremos la captura o informe cuando esta pieza esté colocada y revisada.'));
  $('piece-destination').replaceChildren(...row.destination.map((d) => el('li', '', d)));
  $('piece-state').querySelector('option[value="applied"]').disabled = !row.evidence.length;
  $('piece-state').querySelector('option[value="prepared"]').disabled = !row.files.length;
  $('state-help').textContent = row.evidence.length ? 'Aplicación con evidencia registrada. El estado se guarda con la ficha.' : 'Para marcar «Aplicado» añade una captura o informe del resultado en el juego.';
  if (!preserveEdits) {
    const draft = drafts.get(row.id);
    $('piece-state').value = draft?.state ?? row.state;
    $('piece-notes').value = draft?.notes ?? row.notes;
    $('piece-next').value = draft?.nextStep ?? row.nextStep;
    noteDirty = !!draft;
  }
}
function openPiece(id) {
  selectedId = id;
  $('upload-status').textContent = '';
  $('piece-save-status').textContent = '';
  renderPiece();
  if (!$('piece-dialog').open) $('piece-dialog').showModal();
}
async function savePiece() {
  if (uploadBusy) return;
  $('save-piece').disabled = true;
  $('piece-save-status').classList.remove('status-error');
  try {
    const result = await api('/api/rows/' + encodeURIComponent(selectedId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: catalog.revision, state: $('piece-state').value, notes: $('piece-notes').value, nextStep: $('piece-next').value }) });
    setCatalog(result);
    // Both mutation responses and a fresh GET are supported by the small local API.
    if (!result.catalog && !result.rows) await refresh();
    noteDirty = false;
    drafts.delete(selectedId);
    render(); renderPiece();
    $('piece-save-status').textContent = 'Ficha guardada en el proyecto.';
    $('save-indicator').textContent = 'Guardado en el proyecto';
  } catch (error) {
    if (error.status === 409) { await refresh(); renderPiece({ preserveEdits: true }); }
    $('piece-save-status').classList.add('status-error');
    $('piece-save-status').textContent = error.status === 409 ? 'La ficha cambió en otra ventana. Se conservó tu texto; revisa y vuelve a guardar.' : error.message;
  } finally { $('save-piece').disabled = false; }
}
async function uploadFiles(files) {
  if (!files.length || uploadBusy) return;
  const rowId = selectedId;
  const role = $('file-role').value;
  uploadBusy = true;
  $('file-input').disabled = true;
  $('save-piece').disabled = true;
  $('upload-status').classList.remove('status-error');
  let completed = 0;
  try {
    for (const file of files) {
      if (file.size > 128 * 1024 * 1024) throw new Error(file.name + ' supera los 128 MB.');
      $('upload-status').textContent = 'Guardando ' + file.name + '…';
      const query = new URLSearchParams({ role, name: file.name, revision: String(catalog.revision) });
      const result = await api('/api/rows/' + encodeURIComponent(rowId) + '/files?' + query, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
      setCatalog(result);
      if (!result.catalog && !result.rows) await refresh();
      completed++;
    }
    render();
    if (selectedId === rowId) renderPiece({ preserveEdits: noteDirty });
    $('upload-status').textContent = completed + (completed === 1 ? ' archivo guardado.' : ' archivos guardados.');
    toast('Entrega guardada en «' + catalog.rows.find((r) => r.id === rowId).name + '».');
  } catch (error) {
    if (error.status === 409) await refresh();
    render();
    if (selectedId === rowId) renderPiece({ preserveEdits: noteDirty });
    $('upload-status').classList.add('status-error');
    $('upload-status').textContent = (completed ? completed + ' archivos guardados. ' : '') + (error.status === 409 ? 'El catálogo cambió en otra ventana. Vuelve a elegir el archivo pendiente.' : error.message);
  } finally {
    uploadBusy = false;
    $('file-input').disabled = false;
    $('save-piece').disabled = false;
    $('file-input').value = '';
  }
}
function integrationBrief() {
  const row = catalog.rows.find((r) => r.id === selectedId);
  const list = (items) => items.length ? items.map((f) => '- ' + (f.role || '') + ': ' + f.path).join('\n') : '- Pendiente';
  return ['MAREA NEGRA · FICHA DE INTEGRACIÓN', '', row.name + ' [' + row.id + ']', 'Estilo: ilustrado moderno, lectura tipo sprite, superficies pintadas y tinta con carácter.', 'Estado: ' + STATES[row.state], 'Variantes: ' + row.variants.join(', '), '', 'REFERENCIAS', list(row.references), '', 'ARCHIVOS REALES', list(row.files), '', 'DESTINO', row.destination.map((d) => '- ' + d).join('\n'), '', 'SIGUIENTE PASO', $('piece-next').value, '', 'NOTAS', $('piece-notes').value, '', 'APLICACIÓN REGISTRADA', list(row.evidence), '', 'Después de integrar: revisar en cámara de juego, variantes PC/móvil y añadir evidencia.'].join('\n');
}
function downloadText(text, filename, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const link = el('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('search').addEventListener('input', renderRows);
for (const id of ['state-filter', 'kind-filter']) $(id).addEventListener('change', renderRows);
$('reset-filters').addEventListener('click', () => { category = 'all'; $('search').value = ''; $('state-filter').value = 'all'; $('kind-filter').value = 'all'; render(); });
$('next-piece').addEventListener('click', () => {
  const next = filteredRows().find((r) => r.state !== 'applied');
  if (next) openPiece(next.id); else toast('Todas las piezas visibles están aplicadas.');
});
$('save-piece').addEventListener('click', savePiece);
for (const id of ['piece-state', 'piece-notes', 'piece-next']) $(id).addEventListener('input', () => {
  noteDirty = true;
  drafts.set(selectedId, { state: $('piece-state').value, notes: $('piece-notes').value, nextStep: $('piece-next').value });
  $('piece-save-status').textContent = 'Cambios pendientes de guardar.';
});
$('file-input').addEventListener('change', (event) => uploadFiles([...event.target.files]));
for (const eventName of ['dragenter', 'dragover']) $('drop-zone').addEventListener(eventName, (event) => { event.preventDefault(); $('drop-zone').classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) $('drop-zone').addEventListener(eventName, (event) => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); });
$('drop-zone').addEventListener('drop', (event) => uploadFiles([...event.dataTransfer.files]));
$('copy-brief').addEventListener('click', async () => { try { await navigator.clipboard.writeText(integrationBrief()); toast('Ficha de integración copiada.'); } catch { downloadText(integrationBrief(), selectedId + '-integracion.txt'); toast('Ficha de integración descargada.'); } });
$('download-brief').addEventListener('click', () => downloadText(integrationBrief(), selectedId + '-integracion.txt'));
$('piece-dialog').addEventListener('click', (event) => { if (event.target === $('piece-dialog') && !uploadBusy && !noteDirty) $('piece-dialog').close(); });
$('piece-dialog').addEventListener('cancel', (event) => { if (uploadBusy) event.preventDefault(); });
$('piece-dialog').querySelector('.dialog-close').addEventListener('submit', (event) => { if (uploadBusy) event.preventDefault(); });
window.addEventListener('beforeunload', (event) => { if (drafts.size || uploadBusy) { event.preventDefault(); event.returnValue = ''; } });
refresh().catch((error) => {
  $('save-indicator').textContent = 'Catálogo desconectado';
  const empty = el('div', 'empty-state');
  empty.append(el('strong', '', 'Abre el catálogo desde su lanzador.'), el('span', '', 'Ejecuta CATALOGO-DE-ARTE.cmd y abre http://127.0.0.1:5190. ' + error.message));
  $('rows').replaceChildren(empty);
});
