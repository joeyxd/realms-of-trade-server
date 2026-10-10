import { validateDocument } from '../src/editor/document.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';

const COAST_ROCK_ID = 'model:coast-rock-v1';

export class GmDraftValidationError extends TypeError {
  constructor(code) {
    super(`Invalid GM draft: ${code}`);
    this.name = 'GmDraftValidationError';
    this.code = code;
  }
}

function entriesOf(source) {
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.assets)) return source.assets;
  if (source?.entries instanceof Map) return [...source.entries.values()];
  if (source?.entries && typeof source.entries === 'object') return Object.values(source.entries);
  return [];
}

function approvedAssetIds(manifest, editorCatalog) {
  const ids = new Set();
  for (const entry of [...entriesOf(manifest), ...entriesOf(editorCatalog)]) {
    if (!entry || typeof entry.id !== 'string' || !/^(?:model|prop):[A-Za-z0-9][A-Za-z0-9._:-]{0,156}$/.test(entry.id)) continue;
    const prefix = entry.id.slice(0, entry.id.indexOf(':'));
    if (entry.kind === undefined || entry.kind === 'model' || entry.kind === 'prop' || prefix === 'prop') ids.add(entry.id);
  }
  return ids;
}

/** Build a synchronous validator bound to the server-generated map and shipped asset indexes. */
export function createGmDraftValidator({ map, baseRevision, manifest, editorCatalog }) {
  if (!map || !Number.isSafeInteger(map.seed) || typeof baseRevision !== 'string' || !baseRevision ||
      !Array.isArray(map.props) || !Array.isArray(map.colliders)) {
    throw new TypeError('Invalid GM draft validation context');
  }
  const assets = approvedAssetIds(manifest, editorCatalog);
  const coastAvailable = entriesOf(manifest).some((entry) => entry?.id === COAST_ROCK_ID);
  const baseIds = new Set(gmEditableBaseProps(map, baseRevision)
    .filter((entry) => !entry.coastal || coastAvailable)
    .map((entry) => entry.id));

  return function validate(doc) {
    let checked;
    try { checked = validateDocument(doc); }
    catch (error) { throw new GmDraftValidationError(error?.code || 'document'); }
    if (checked.base.seed !== (map.seed >>> 0) || checked.base.revision !== baseRevision) {
      throw new GmDraftValidationError('base_mismatch');
    }
    for (const item of checked.objects) {
      if (item.assetId.startsWith('base:')) {
        if (!baseIds.has(item.assetId)) throw new GmDraftValidationError('base_reference');
      } else if (!assets.has(item.assetId)) {
        throw new GmDraftValidationError('asset_reference');
      }
    }
    for (const override of checked.baseOverrides) {
      if (!baseIds.has(override.id)) throw new GmDraftValidationError('base_reference');
    }
    return checked;
  };
}
