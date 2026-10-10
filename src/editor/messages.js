const pairs = {
  draft: { en: 'Could not open the local draft.', es: 'No se pudo abrir el borrador local.' },
  save: { en: 'Could not save the local draft. Export it to keep your work, then retry.', es: 'No se pudo guardar el borrador local. Expórtalo para conservar tu trabajo y vuelve a intentar.' },
  import: { en: 'Could not import the draft. Check the file and try again.', es: 'No se pudo importar el borrador. Revisa el archivo y vuelve a intentar.' },
  transform: { en: 'The selected object has an invalid transform.', es: 'El objeto seleccionado tiene una transformación no válida.' },
  asset: { en: 'The model could not be loaded. Try again or choose another model.', es: 'No se pudo cargar el modelo. Vuelve a intentar o elige otro modelo.' },
  assetPreparing: { en: 'Preparing model…', es: 'Preparando modelo…' },
  assetReady: { en: 'Ready to place.', es: 'Listo para colocar.' },
  walk: { en: 'The walk test stopped unexpectedly. Return to the editor and try again.', es: 'La prueba de recorrido se detuvo. Vuelve al editor e inténtalo de nuevo.' },
  unknown: { en: 'Something went wrong. Please try again.', es: 'Se produjo un error. Vuelve a intentar.' },
};

const draftCodes = {
  indexeddb_unavailable: 'storageUnavailable', indexeddb_open: 'storageUnavailable', indexeddb_blocked: 'storageUnavailable',
  indexeddb_read: 'storageUnavailable', indexeddb_write: 'storageUnavailable',
  stored_record: 'draftCorrupt', stored_document: 'draftCorrupt', world_id: 'draftInvalid', source: 'draftInvalid',
  expected_revision: 'draftInvalid', revision_conflict: 'draftConflict', revision_exhausted: 'draftLimit',
  document: 'draftInvalid', empty: 'draftEmpty', import_size: 'importSize', import_json: 'importJson', import_format: 'importFormat',
  base_mismatch: 'baseMismatch', unsupported_export: 'importFormat',
};

const documentCodes = {
  format: 'draftInvalid', base: 'draftInvalid', objects: 'draftInvalid', object: 'draftInvalid', object_id: 'draftInvalid',
  asset_id: 'draftInvalid', transform: 'transform', position: 'transform', rotation: 'transform', scale: 'transform',
  collider: 'draftInvalid', duplicate_id: 'draftInvalid', object_limit: 'objectLimit', missing_object: 'draftInvalid',
  object_patch: 'draftInvalid', history_limit: 'draftInvalid',
};

const known = {
  storageUnavailable: { en: 'Local draft storage is unavailable in this browser.', es: 'El almacenamiento local de borradores no está disponible en este navegador.' },
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
};

export function editorMessage(en, es) { return { en, es }; }

export function renderEditorMessage(message, locale = 'es') {
  if (typeof message === 'string') return message;
  return message?.[locale === 'en' ? 'en' : 'es'] || pairs.unknown[locale === 'en' ? 'en' : 'es'];
}

export function editorErrorMessage(error, locale = 'es', context = 'unknown') {
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
