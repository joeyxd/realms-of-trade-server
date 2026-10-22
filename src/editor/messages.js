const pairs = {
  draft: { en: 'Could not open the local draft.', es: 'No se pudo abrir el borrador local.' },
  save: { en: 'Could not save the local draft. Export it to keep your work, then retry.', es: 'No se pudo guardar el borrador local. Expórtalo para conservar tu trabajo y vuelve a intentar.' },
  import: { en: 'Could not import the draft. Check the file and try again.', es: 'No se pudo importar el borrador. Revisa el archivo y vuelve a intentar.' },
  transform: { en: 'The selected object has an invalid transform.', es: 'El objeto seleccionado tiene una transformación no válida.' },
  asset: { en: 'The model could not be loaded. Try again or choose another model.', es: 'No se pudo cargar el modelo. Vuelve a intentar o elige otro modelo.' },
  assetPreparing: { en: 'Preparing model…', es: 'Preparando modelo…' },
  assetReady: { en: 'Ready to place.', es: 'Listo para colocar.' },
  resource: { en: 'This resource needs clear, dry ground, space from other resources and protected places, and its allowed scale and rotation.',
    es: 'El recurso necesita suelo seco y despejado, separación de otros recursos y zonas protegidas, y su escala y giro permitidos.' },
  walk: { en: 'The walk test stopped unexpectedly. Return to the editor and try again.', es: 'La prueba de recorrido se detuvo. Vuelve al editor e inténtalo de nuevo.' },
  unknown: { en: 'Something went wrong. Please try again.', es: 'Se produjo un error. Vuelve a intentar.' },
};

const draftCodes = {
  indexeddb_unavailable: 'storageUnavailable', indexeddb_open: 'storageUnavailable', indexeddb_blocked: 'storageBlocked',
  indexeddb_read: 'storageUnavailable', indexeddb_write: 'storageUnavailable',
  stored_record: 'draftCorrupt', stored_document: 'draftCorrupt', world_id: 'draftInvalid', source: 'draftInvalid',
  expected_revision: 'draftInvalid', revision_conflict: 'draftConflict', revision_exhausted: 'draftLimit',
  document: 'draftInvalid', empty: 'draftEmpty', import_size: 'importSize', import_json: 'importJson', import_format: 'importFormat',
  base_mismatch: 'baseMismatch', unsupported_export: 'importFormat',
  // GM07 terrain tiles: a draft whose tiles are missing or damaged is refused, never opened as base terrain.
  stored_tile_missing: 'tileMissing', stored_tile_invalid: 'tileInvalid', tile_missing: 'tileMissing',
  tile_length: 'tileInvalid', tile_hash: 'tileInvalid', tile_blobs: 'tileInvalid', tile_key_mismatch: 'tileInvalid',
  unknown_material: 'tileInvalid', import_tile_missing: 'importTileMissing', import_tile_extra: 'importTileExtra',
  import_tile_invalid: 'importTileInvalid', document_tile_missing: 'draftInvalid', document_tile_invalid: 'draftInvalid',
  terrain_tiles_not_ready: 'tilesNotReady',
};

const documentCodes = {
  format: 'draftInvalid', base: 'draftInvalid', objects: 'draftInvalid', object: 'draftInvalid', object_id: 'draftInvalid',
  asset_id: 'draftInvalid', transform: 'transform', position: 'transform', rotation: 'transform', scale: 'transform',
  collider: 'draftInvalid', duplicate_id: 'draftInvalid', object_limit: 'objectLimit', missing_object: 'draftInvalid',
  object_patch: 'draftInvalid', history_limit: 'draftInvalid', tile_missing: 'tileMissing',
  selection: 'draftInvalid', selection_hidden: 'draftInvalid', selection_transform: 'transform', selection_limit: 'selectionLimit',
};

const known = {
  selectionLimit: { en: 'Select at most 120 decorations.', es: 'Selecciona como máximo 120 decoraciones.' },
  storageUnavailable: { en: 'Local draft storage is unavailable in this browser.', es: 'El almacenamiento local de borradores no está disponible en este navegador.' },
  storageBlocked: { en: 'Another tab with an older version of the game keeps the local drafts open. Reload or close it, then try again.',
    es: 'Otra pestaña con una versión anterior del juego mantiene abiertos los borradores locales. Recárgala o ciérrala y vuelve a intentar.' },
  draftCorrupt: { en: 'The saved draft is damaged and could not be opened.', es: 'El borrador guardado está dañado y no se pudo abrir.' },
  draftInvalid: { en: 'The draft contains invalid data and could not be used.', es: 'El borrador contiene datos no válidos y no se pudo usar.' },
  draftConflict: { en: 'This draft changed in another tab. Export your changes before trying to save again.', es: 'Este borrador cambió en otra pestaña. Exporta tus cambios antes de volver a guardar.' },
  draftLimit: { en: 'The draft reached its revision limit. Export it to keep a copy.', es: 'El borrador alcanzó su límite de revisiones. Expórtalo para conservar una copia.' },
  draftEmpty: { en: 'There is no saved draft to export.', es: 'No hay ningún borrador guardado para exportar.' },
  importSize: { en: 'The draft file exceeds the 5 MB limit.', es: 'El archivo del borrador supera el límite de 5 MB.' },
  importJson: { en: 'The selected file is not valid JSON.', es: 'El archivo seleccionado no contiene JSON válido.' },
  importFormat: { en: 'The selected file is not a supported draft export.', es: 'El archivo seleccionado no es una exportación de borrador compatible.' },
  baseMismatch: { en: 'This draft belongs to a different base map. Export it before starting another draft.', es: 'Este borrador pertenece a otra base del mapa. Expórtalo antes de iniciar otro.' },
  objectLimit: { en: 'The draft has reached its object limit.', es: 'El borrador alcanzó el límite de objetos.' },
  transform: { en: 'The selected object has an invalid transform.', es: 'El objeto seleccionado tiene una transformación no válida.' },
  tileMissing: { en: 'A terrain tile of this draft is missing, so it was not opened. Your current draft is unchanged.',
    es: 'Falta un bloque de terreno de este borrador, así que no se abrió. Tu borrador actual no cambió.' },
  tileInvalid: { en: 'A terrain tile of this draft is damaged, so it was not opened. Your current draft is unchanged.',
    es: 'Un bloque de terreno de este borrador está dañado, así que no se abrió. Tu borrador actual no cambió.' },
  importTileMissing: { en: 'The file lacks a terrain tile its draft needs. Nothing was imported.',
    es: 'Al archivo le falta un bloque de terreno que su borrador necesita. No se importó nada.' },
  importTileExtra: { en: 'The file holds a terrain tile its draft does not use. Nothing was imported.',
    es: 'El archivo contiene un bloque de terreno que su borrador no usa. No se importó nada.' },
  importTileInvalid: { en: 'A terrain tile in the file is damaged. Nothing was imported.',
    es: 'Un bloque de terreno del archivo está dañado. No se importó nada.' },
  tilesNotReady: { en: 'This terrain is saved locally. Online save and publication of terrain arrive with the next update; export a copy to keep it.',
    es: 'Este terreno está guardado localmente. El guardado online y la publicación de terreno llegan con la próxima actualización; exporta una copia para conservarlo.' },
};

export function editorMessage(en, es) { return { en, es }; }

export function renderEditorMessage(message, locale = 'es') {
  if (typeof message === 'string') return message;
  return message?.[locale === 'en' ? 'en' : 'es'] || pairs.unknown[locale === 'en' ? 'en' : 'es'];
}

export function editorErrorMessage(error, locale = 'es', context = 'unknown') {
  if (error?.name === 'GmResourceValidationError') return error.code === 'limit'
    ? editorMessage('This revision already has 128 added resources.', 'Esta revisión ya tiene 128 recursos añadidos.') : pairs.resource;
  const code = typeof error?.code === 'string' ? error.code : '';
  const key = error?.name === 'SyntaxError' && context === 'import' ? 'importJson'
    : error?.name === 'DraftConflictError' ? 'draftConflict'
    : error?.name === 'DocumentValidationError' ? documentCodes[code]
      : draftCodes[code];
  return (key && known[key]) || pairs[context] || pairs.unknown;
}

export class EditorStatus {
  constructor(node, locale = 'es') { this.node = node; this.locale = locale; this.message = null; this.kind = ''; }
  setLocale(locale) { this.locale = locale === 'en' ? 'en' : 'es'; this.render(); }
  set(message, kind = '') { this.message = message; this.kind = kind; this.render(); }
  render() {
    if (!this.node || !this.message) return;
    this.node.textContent = renderEditorMessage(this.message, this.locale);
    this.node.dataset.kind = this.kind;
  }
}

export const editorMessages = pairs;
