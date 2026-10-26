// Client for ARTE-Y-MODELOS.html: renders the embedded index. No network, no storage.
(() => {
  const data = JSON.parse(document.getElementById('data').textContent);
  const $ = id => document.getElementById(id);
  const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const link = (href, text, cls) => { const a = el('a', cls, text ?? href); a.href = encodeURI(href); return a; };
  const image = (src, alt) => { const img = el('img'); img.src = encodeURI(src); img.alt = alt; img.loading = 'lazy'; return img; };
  const size = b => b >= 1048576 ? `${(b / 1048576).toFixed(b >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
  const option = (select, value, label) => { const o = el('option', null, label); o.value = value; select.append(o); };

  const STATES = { applied: 'Aplicado en juego', prepared: 'Archivos preparados', pending: 'Pendiente', reference: 'Referencia' };
  const AREAS = { juego: 'Juego · assets/', fuente: 'Fuentes · docs/art/', bandeja: 'Bandeja · materials/' };
  const TYPES = { modelo: 'Modelo', textura: 'Textura', imagen: 'Imagen', vfx: 'VFX', ui: 'UI', audio: 'Audio', paquete: 'Paquete', datos: 'Datos', nota: 'Nota', otro: 'Otro' };
  const KINDS = { material: 'Material', object: 'Objeto', prefab: 'Prefab', model: 'Modelo', system: 'Sistema', char: 'Personaje', tex: 'Textura' };
  const SOURCES = { catalogo: 'Catálogo de arte', objetos: 'Objeto Tripo', manifest: 'Registro del juego' };

  // Summary.
  const fresh = data.problems.filter(p => p.fresh).length;
  const stats = [
    [data.pieces.length, `piezas · ${data.pieces.filter(p => p.state === 'applied').length} aplicadas`],
    ...Object.entries(data.areas).map(([a, v]) => [v.files, `${AREAS[a] ?? a} · ${size(v.bytes)}`]),
    [data.niagara.effects, 'efectos Niagara'],
    [fresh, `problemas nuevos · ${data.problems.length - fresh} heredados`, fresh ? 'bad' : 'ok'],
  ];
  for (const [value, label, tone] of stats) {
    const box = el('div', `stat ${tone ?? ''}`);
    box.append(el('b', null, String(value)), el('span', null, label));
    $('stats').append(box);
  }
  $('generated').textContent = new Date(data.generated).toLocaleString('es');

  // Tabs, with the hash so a link can open a view directly.
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const show = name => {
    if (!tabs.some(t => t.dataset.tab === name)) name = 'piezas';
    for (const t of tabs) {
      t.setAttribute('aria-selected', String(t.dataset.tab === name));
      $(t.dataset.tab).hidden = t.dataset.tab !== name;
    }
  };
  for (const t of tabs) t.addEventListener('click', () => { history.replaceState(null, '', `#${t.dataset.tab}`); show(t.dataset.tab); });
  const openPiece = id => { $('piece-q').value = id; $('piece-group').value = ''; $('piece-state').value = ''; filterPieces(); history.replaceState(null, '', '#piezas'); show('piezas'); };

  // Pieces.
  const grid = $('piece-grid');
  const cards = [];
  const niagaraThumbs = data.files.filter(f => f[0].startsWith('assets/vfx/niagara/thumbnails/')).slice(0, 6).map(f => f[0]);
  if (data.niagara.effects) {
    const card = el('article');
    const mosaic = el('div', 'mosaic');
    for (const src of niagaraThumbs) mosaic.append(image(src, ''));
    const body = el('div', 'body');
    body.append(el('p', 'tag', 'Efectos Niagara · sistema'), el('h2', null, `${data.niagara.effects} efectos de partículas`));
    body.append(el('p', null, 'Un solo catálogo generado (src/editor/niagaraCatalog.js) con miniatura por efecto. Se gestionan como grupo, no como fichas sueltas.'));
    const chips = el('div', 'row');
    for (const [cat, n] of Object.entries(data.niagara.categories).slice(0, 14)) chips.append(el('span', 'badge', `${cat} ${n}`));
    body.append(chips, el('code', null, 'assets/vfx/niagara/'));
    card.append(mosaic, body);
    card.dataset.search = fold(`niagara vfx efectos particulas ${Object.keys(data.niagara.categories).join(' ')}`);
    card.dataset.group = 'Efectos Niagara';
    card.dataset.state = 'applied';
    grid.append(card);
    cards.push(card);
  }
  for (const p of data.pieces) {
    const card = el('article');
    const pic = el(p.preview ? 'a' : 'div', 'image');
    if (p.preview) { pic.href = encodeURI(p.preview); pic.append(image(p.preview, p.name)); } else pic.textContent = 'Sin vista previa';
    const body = el('div', 'body');
    body.append(el('p', 'tag', `${p.group} · ${KINDS[p.kind] ?? p.kind}`), el('h2', null, p.name));
    const head = el('div', 'row');
    head.append(el('span', `badge ${p.state}`, STATES[p.state] ?? p.state), el('code', null, p.id));
    body.append(head);
    if (p.nextStep) body.append(el('p', null, p.nextStep));
    if (p.notes) body.append(el('p', null, p.notes));
    if (p.source === 'objetos') {
      const actions = el('div', 'row');
      const png = link(p.preview, 'PNG para Tripo', 'button');
      png.download = `${p.id.replace(/^objeto-/, '')}-reference.png`;
      actions.append(png, link(`${p.intake}/README.md`, 'Dónde entregar', 'button secondary'));
      body.append(actions, el('code', null, `${p.intake}/${p.model}`));
      if (p.received?.length) {
        const got = el('ul');
        for (const f of p.received) { const li = el('li'); li.append(link(f, f.split('/').pop())); got.append(li); }
        body.append(el('p', null, `${p.received.length} entrega(s) recibida(s):`), got);
      }
    }
    if (p.source !== 'catalogo') body.append(el('p', 'small', SOURCES[p.source] ?? p.source));
    if (p.files.length || p.destination?.length) {
      const more = el('details');
      more.append(el('summary', null, `Archivos (${p.files.length})${p.destination?.length ? ' y destino' : ''}`));
      const list = el('ul');
      for (const f of p.files) { const li = el('li'); li.append(link(f)); list.append(li); }
      for (const d of p.destination ?? []) { const li = el('li'); li.append('Destino: ', el('code', null, d)); list.append(li); }
      more.append(list);
      body.append(more);
    }
    card.append(pic, body);
    card.dataset.search = fold(`${p.id} ${p.name} ${p.group} ${p.kind} ${p.nextStep ?? ''} ${p.files.join(' ')}`);
    card.dataset.group = p.group;
    card.dataset.state = p.state;
    grid.append(card);
    cards.push(card);
  }
  for (const g of [...new Set(cards.map(c => c.dataset.group))]) option($('piece-group'), g, g);
  for (const [k, v] of Object.entries(STATES)) option($('piece-state'), k, v);
  function filterPieces() {
    const words = fold($('piece-q').value).split(/\s+/).filter(Boolean);
    const group = $('piece-group').value, state = $('piece-state').value;
    let n = 0;
    for (const c of cards) {
      c.hidden = !(words.every(w => c.dataset.search.includes(w)) && (!group || c.dataset.group === group) && (!state || c.dataset.state === state));
      if (!c.hidden) n++;
    }
    $('piece-count').textContent = `${n} de ${cards.length} piezas`;
  }
  for (const id of ['piece-q', 'piece-group', 'piece-state']) $(id).addEventListener('input', filterPieces);

  // Files, rendered in pages so the 2.600 rows stay light.
  const PAGE = 200;
  let matches = [], shown = 0;
  for (const [k, v] of Object.entries(AREAS)) option($('file-area'), k, v);
  for (const t of Object.keys(TYPES).filter(t => data.files.some(f => f[2] === t))) option($('file-type'), t, TYPES[t]);
  function renderFiles() {
    const list = $('file-list');
    for (const [p, area, type, bytes, pieces, roles, untracked] of matches.slice(shown, shown + PAGE)) {
      const li = el('li');
      li.append(link(p));
      const meta = el('span', 'meta');
      meta.append(`${AREAS[area].split(' ·')[0]} · ${TYPES[type] ?? type} · ${size(bytes)}`);
      if (untracked) meta.append(el('span', 'badge untracked', 'sin commitear'));
      for (const id of pieces ? pieces.split(' ') : []) {
        const chip = el('button', 'chip', id);
        chip.addEventListener('click', () => openPiece(id));
        meta.append(chip);
      }
      if (!pieces && roles) meta.append(el('span', null, roles.replace(/ /g, ', ')));
      li.append(meta);
      list.append(li);
    }
    shown = Math.min(matches.length, shown + PAGE);
    $('file-more').hidden = shown >= matches.length;
    $('file-more').textContent = `Mostrar ${Math.min(PAGE, matches.length - shown)} más`;
  }
  function filterFiles() {
    const words = fold($('file-q').value).split(/\s+/).filter(Boolean);
    const area = $('file-area').value, type = $('file-type').value, claim = $('file-claim').value;
    matches = data.files.filter(f => words.every(w => fold(f[0]).includes(w)) && (!area || f[1] === area) && (!type || f[2] === type)
      && (!claim || (claim === 'none') === !f[4]));
    const bytes = matches.reduce((s, f) => s + f[3], 0);
    $('file-count').textContent = `${matches.length} de ${data.files.length} archivos · ${size(bytes)}`;
    $('file-list').replaceChildren();
    shown = 0;
    renderFiles();
  }
  for (const id of ['file-q', 'file-area', 'file-type', 'file-claim']) $(id).addEventListener('input', filterFiles);
  $('file-more').addEventListener('click', renderFiles);

  // Problems, grouped by kind with the fix next to the list.
  const box = $('problem-list');
  const banner = el('p', `banner ${fresh ? 'bad' : ''}`, fresh
    ? `${fresh} problema(s) nuevo(s): arréglalos antes de commitear (npm run assets:check).`
    : `Sin problemas nuevos. ${data.problems.length} heredados en la baseline: solo puede encoger.`);
  box.append(banner);
  for (const [kind, text] of Object.entries(data.problemText)) {
    const items = data.problems.filter(p => p.kind === kind).sort((a, b) => b.fresh - a.fresh);
    if (!items.length) continue;
    const sec = el('div', 'problem');
    sec.append(el('h2', null, `${kind} · ${items.length}`), el('p', null, text));
    const list = el('ul');
    for (const p of items) {
      const li = el('li');
      if (p.fresh) li.append(el('span', 'badge fresh', 'nuevo'), ' ');
      li.append(link(p.path.split('#')[0], p.path));
      if (p.detail) li.append(' ', el('code', null, `← ${p.detail}`));
      list.append(li);
    }
    sec.append(list);
    box.append(sec);
  }
  if (data.resolved.length) {
    const sec = el('div', 'problem');
    sec.append(el('h2', null, `Resueltos · ${data.resolved.length}`), el('p', null, 'Ya no ocurren; sácalos con node tools/asset-index/build.mjs --write-baseline.'));
    const list = el('ul');
    for (const k of data.resolved) list.append(el('li', null, k));
    sec.append(list);
    box.append(sec);
  }

  filterPieces();
  filterFiles();
  show(location.hash.slice(1));
})();
