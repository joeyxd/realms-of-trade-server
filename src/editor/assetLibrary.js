const CATALOG_SCHEMA = 'marea.asset-workshop.catalog.v1';
const PREPARED_SCHEMA = 'marea.asset-prepared.v1';
const PUBLISHED_SCHEMA = 'marea.asset-published.v1';

/** Index the operator publication record by workshop id; any other schema yields an empty index. */
export function indexPublished(doc) {
  const index = new Map();
  if (!doc || doc.schema !== PUBLISHED_SCHEMA || !Array.isArray(doc.entries)) return index;
  for (const row of doc.entries) {
    if (!row || typeof row.id !== 'string' || typeof row.editorId !== 'string') continue;
    index.set(row.id, { editorId: row.editorId, sourceRevision: row.sourceRevision, publishedAt: row.publishedAt });
  }
  return index;
}

/** "published" when id and sourceRevision match, "published-other-revision" when only the id does, else null. */
export function publicationState(entry, index) {
  const row = entry && index?.get?.(entry.id);
  if (!row) return null;
  return row.sourceRevision === entry.sourceRevision ? 'published' : 'published-other-revision';
}

function validateEntry(entry) {
  return entry && typeof entry === 'object' && !Array.isArray(entry) &&
    typeof entry.id === 'string' && entry.id.length > 0 &&
    typeof entry.name === 'string' && typeof entry.originalName === 'string' &&
    typeof entry.packId === 'string' && typeof entry.packName === 'string' &&
    typeof entry.type === 'string' && Array.isArray(entry.categories) && entry.categories.every((value) => typeof value === 'string') &&
    typeof entry.sourceRevision === 'string' && entry.sourceRevision.length > 0 &&
    entry.source && typeof entry.source === 'object' && Array.isArray(entry.source.paths) &&
    entry.source.paths.every((value) => typeof value === 'string') &&
    Array.isArray(entry.limitations) && entry.limitations.every((value) => typeof value === 'string');
}

function validateCatalog(data) {
  if (!data || data.schema !== CATALOG_SCHEMA || !Array.isArray(data.entries) ||
      !data.coverage || typeof data.coverage !== 'object') {
    throw new TypeError('El catálogo AW no tiene un esquema válido.');
  }
  const ids = new Set();
  for (const entry of data.entries) {
    if (!validateEntry(entry) || ids.has(entry.id)) throw new TypeError('El catálogo AW contiene una ficha inválida o duplicada.');
    ids.add(entry.id);
  }
  return data;
}

const HEX_SHA256 = /^[a-f0-9]{64}$/i;
const PREVIEW_KINDS = new Set(['model', 'texture', 'material', 'icon']);

function validPreviewProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
      typeof profile.url !== 'string' || !profile.url.startsWith('assets/') || profile.url.includes('\\') ||
      profile.url.startsWith('/') || profile.url.includes('://') ||
      !Number.isSafeInteger(profile.bytes) || profile.bytes <= 0 ||
      (profile.sha256 != null && !HEX_SHA256.test(profile.sha256))) return false;
  const path = profile.url.split(/[?#]/, 1)[0];
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.includes('\\')) return false;
    const segments = decoded.split('/');
    return segments[0] === 'assets' && segments.length > 1 && segments.slice(1).some(Boolean) && !segments.includes('..');
  } catch { return false; }
}

function sanitizePreview(descriptor, onInvalid = () => {}) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) || !PREVIEW_KINDS.has(descriptor.kind)) return null;
  const clean = { kind: descriptor.kind };
  if (typeof descriptor.label === 'string') clean.label = descriptor.label.slice(0, 300);
  let hasProfile = false;
  for (const quality of ['desktop', 'mobile']) {
    if (descriptor[quality] == null) continue;
    if (!validPreviewProfile(descriptor[quality])) { onInvalid(quality); continue; }
    const profile = descriptor[quality];
    clean[quality] = {
      url: profile.url,
      bytes: profile.bytes,
      ...(profile.sha256 ? { sha256: profile.sha256.toLowerCase() } : {}),
      ...(typeof profile.label === 'string' ? { label: profile.label.slice(0, 300) } : {}),
    };
    hasProfile = true;
  }
  return hasProfile ? clean : null;
}

export function hasAssetPreview(entry, quality = '') {
  if (!entry || (quality && !['desktop', 'mobile'].includes(quality))) return false;
  const descriptors = [entry.preview, ...(Array.isArray(entry.variants) ? entry.variants.map((variant) => variant?.preview) : [])];
  return descriptors.some((descriptor) => descriptor && PREVIEW_KINDS.has(descriptor.kind) &&
    (quality ? validPreviewProfile(descriptor[quality]) : validPreviewProfile(descriptor.desktop) || validPreviewProfile(descriptor.mobile)));
}

function validatePrepared(data, catalogEntries) {
  if (data == null) return { entries: [], warnings: [] };
  if (!data || data.schema !== PREPARED_SCHEMA || !Array.isArray(data.entries)) {
    throw new TypeError('El índice de previews preparados AW no tiene un esquema válido.');
  }
  const catalogById = new Map(catalogEntries.map((entry) => [entry.id, entry]));
  const seen = new Set();
  const entries = [];
  const warnings = [];
  for (const prepared of data.entries) {
    if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared) || typeof prepared.id !== 'string') {
      warnings.push('Se omitió una fila preparada con formato inválido.');
      continue;
    }
    const base = catalogById.get(prepared.id);
    if (!base) { warnings.push(`Se omitió ${prepared.id}: no pertenece al catálogo actual.`); continue; }
    if (seen.has(prepared.id)) { warnings.push(`Se omitió ${prepared.id}: aparece duplicado en el índice preparado.`); continue; }
    seen.add(prepared.id);
    const pathsMatch = Array.isArray(prepared.sourcePaths) &&
      JSON.stringify(prepared.sourcePaths) === JSON.stringify(base.source?.paths || []);
    if (prepared.catalogSourceRevision !== base.sourceRevision || !pathsMatch || !HEX_SHA256.test(prepared.sourceRevision || '')) {
      warnings.push(`Se omitió ${prepared.id}: la revisión o las rutas fuente ya no coinciden con el catálogo.`);
      continue;
    }
    const clean = { id: prepared.id };
    clean.sourceRevision = prepared.sourceRevision.toLowerCase();
    clean.technicalType = typeof prepared.technicalType === 'string' && prepared.technicalType.length <= 120 ? prepared.technicalType : '';
    const warnProfile = (profile) => warnings.push(`Se omitió el perfil ${profile} de ${prepared.id}: la preview no tiene URL, bytes o hash válidos.`);
    clean.preview = sanitizePreview(prepared.preview, warnProfile);
    clean.previewRejected = prepared.preview != null && !clean.preview;
    if (Array.isArray(prepared.variants)) clean.variants = prepared.variants.slice(0, 24).map((variant) => {
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return null;
      const item = { id: typeof variant.id === 'string' ? variant.id.slice(0, 120) : '', label: typeof variant.label === 'string' ? variant.label.slice(0, 200) : '' };
      const preview = sanitizePreview(variant.preview, warnProfile);
      if (preview) item.preview = preview;
      else if (variant.preview) warnings.push(`Se conservó ${prepared.id} pendiente: una preview de variante no es válida.`);
      return item.id ? item : null;
    }).filter(Boolean);
    if (prepared.preview && !clean.preview) warnings.push(`Se conservó ${prepared.id} pendiente: la preview no tiene ningún perfil válido.`);
    if (prepared.metrics && typeof prepared.metrics === 'object' && !Array.isArray(prepared.metrics)) clean.metrics = prepared.metrics;
    if (Array.isArray(prepared.limitations)) clean.limitations = prepared.limitations.filter((item) => typeof item === 'string');
    if (Array.isArray(prepared.sources)) clean.preparedSources = prepared.sources;
    if (typeof prepared.reason === 'string') clean.preparationReason = prepared.reason;
    entries.push(clean);
  }
  return { entries, warnings };
}

/** Load catalog metadata and optional prepared derivatives without trusting prepared identities. */
export async function loadAssetLibrary({
  fetchImpl = globalThis.fetch,
  url = 'assets/workshop/catalog.json',
  preparedUrl = 'assets/workshop/prepared.json',
  thumbnailsUrl = 'assets/workshop/thumbnails.json',
  publishedUrl = 'assets/workshop/published.json',
  signal,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Se requiere una función fetch.');
  const timeoutSignal = AbortSignal.timeout(15000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const fetchJson = async (path, optional = false) => {
    try {
      const response = await fetchImpl(path, { cache: 'no-cache', signal: requestSignal });
      if (!response?.ok) {
        if (optional && (response?.status === 404 || response?.status === 410)) return null;
        throw new Error(`No se pudo leer ${path} (${response?.status ?? 'sin respuesta'}).`);
      }
      return await response.json();
    } catch (error) {
      if (optional && (error?.name === 'TypeError' || error?.code === 'ENOENT')) return null;
      throw error;
    }
  };
  const catalog = validateCatalog(await fetchJson(url));
  const preparedData = await fetchJson(preparedUrl, true);
  const prepared = validatePrepared(preparedData, catalog.entries);
  const byId = new Map(prepared.entries.map((entry) => [entry.id, entry]));
  const entries = catalog.entries.map((entry) => {
    const supplemental = byId.get(entry.id);
    if (!supplemental) return entry;
    const verifiedType = supplemental.technicalType || entry.technicalType;
    const baseLimitations = (entry.limitations || []).filter((limitation) => !(
      verifiedType && limitation.startsWith('Candidato de metadata: clase, preview y conversión no verificados;')
    ));
    if (verifiedType && !supplemental.preview) baseLimitations.push(`Clase técnica verificada como ${verifiedType}; falta una preview aceptada y verificar su conversión.`);
    return {
      ...entry,
      sourceRevision: supplemental.sourceRevision || entry.sourceRevision,
      ...(verifiedType ? { type: verifiedType, technicalType: verifiedType } : {}),
      preview: supplemental.preview || (supplemental.previewRejected ? null : entry.preview || null),
      variants: supplemental.variants || entry.variants,
      metrics: supplemental.metrics || entry.metrics,
      limitations: [...new Set([...baseLimitations, ...(supplemental.limitations || [])])],
      preparedSources: supplemental.preparedSources,
      preparationReason: supplemental.preparationReason,
    };
  });
  const warnings = [...prepared.warnings];
  if (!preparedData) warnings.push('Previews preparados no disponibles; la ficha conserva metadata y previews integrados.');
  let thumbnails = null;
  try { thumbnails = thumbnailsUrl ? await fetchJson(thumbnailsUrl, true) : null; }
  catch (error) { if (requestSignal.aborted) throw error; warnings.push('No se pudieron leer las miniaturas; el visor sigue disponible.'); }
  if (thumbnails?.schema === 'marea.asset-thumbnails.v1' && Array.isArray(thumbnails.entries)) {
    for (const entry of entries) {
      const thumbnail = thumbnails.entries.find(row => row.id === entry.id && row.sourceRevision === entry.sourceRevision && validPreviewProfile(row));
      if (thumbnail) { entry.thumbnail = thumbnail.url; entry.thumbnailLabel = thumbnail.label; }
    }
  }
  // The publication record is optional: a missing or unreadable file means no badges.
  let published = new Map();
  try { published = indexPublished(publishedUrl ? await fetchJson(publishedUrl, true) : null); }
  catch (error) { if (requestSignal.aborted) throw error; }
  return { entries, coverage: catalog.coverage, warnings, published };
}

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
const textFields = (entry, review = null) => [entry.id, entry.name, entry.originalName, entry.packName,
  entry.source?.path, entry.source?.project, entry.source?.package, entry.notes,
  ...(entry.source?.paths || []),
  ...(entry.source?.dependencies || []).flatMap((dependency) => [dependency.path, dependency.url]),
  ...(entry.preparedSources || []).flatMap((source) => [source.path, source.url, source.project, source.package]),
  ...(entry.materials || []), ...(entry.tags || []), ...(entry.aliases || []), ...(entry.categories || []),
  ...(entry.limitations || []), entry.preparationReason,
  review?.notes, review?.use, review?.collection,
  ...(entry.variants || []).flatMap((variant) => [variant.id, variant.label, variant.name])];

function reviewFor(reviews, entry) {
  if (!reviews) return null;
  if (typeof reviews.get === 'function') return reviews.get(entry);
  return Object.hasOwn(reviews, entry.id) ? reviews[entry.id] : null;
}

/** Apply AND-combined facets, including accent-insensitive search across source metadata. */
export function filterAssets(entries, {
  query = '', category = '', pack = '', status = '', newOnly = false,
  reviews = null, collection = '',
} = {}) {
  const terms = fold(query).trim().split(/\s+/).filter(Boolean);
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!entry) return false;
    if (category && !(entry.categories || []).includes(category)) return false;
    if (pack && entry.packId !== pack) return false;
    if (newOnly && !entry.isNew) return false;
    const record = reviewFor(reviews, entry);
    const collectionName = record?.collection || '';
    if (collection && collectionName !== collection) return false;
    if (status === 'pending' && record && record.decision !== 'unreviewed' && record.decision !== 'inspect') return false;
    if (status === 'reviewed' && (!record || record.decision === 'unreviewed')) return false;
    if (status === 'unreviewed' && record && record.decision !== 'unreviewed') return false;
    if (status === 'ready' && !hasAssetPreview(entry)) return false;
    if (status && !['pending', 'reviewed', 'unreviewed', 'ready'].includes(status) && record?.decision !== status) return false;
    if (terms.length) {
      const haystack = fold(textFields(entry, record).filter(Boolean).join(' '));
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}

export function paginateAssets(entries, { page = 1, pageSize = 24 } = {}) {
  const size = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || 24)));
  const pages = Math.max(1, Math.ceil(entries.length / size));
  const currentPage = Math.max(1, Math.min(pages, Math.floor(Number(page) || 1)));
  return { items: entries.slice((currentPage - 1) * size, currentPage * size), page: currentPage, pageSize: size, pages, total: entries.length };
}

export function assetFacets(entries) {
  const categories = [...new Set(entries.flatMap((entry) => entry.categories || []))].sort((a, b) => a.localeCompare(b, 'es'));
  const packs = [...new Map(entries.map((entry) => [entry.packId, { id: entry.packId, name: entry.packName }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const types = [...new Set(entries.map((entry) => entry.type))].sort((a, b) => a.localeCompare(b, 'es'));
  return { categories, packs, types };
}
