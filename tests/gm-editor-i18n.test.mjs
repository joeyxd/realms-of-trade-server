import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorStatus, editorErrorMessage } from '../src/editor/messages.js';

test('known draft and document errors become natural bilingual messages', () => {
  const conflict = Object.assign(new Error('GM draft store: revision_conflict'), { name: 'DraftConflictError', code: 'revision_conflict' });
  assert.equal(editorErrorMessage(conflict, 'es', 'save').es, 'Este borrador cambió en otra pestaña. Exporta tus cambios antes de volver a guardar.');
  assert.equal(editorErrorMessage(conflict, 'en', 'save').en, 'This draft changed in another tab. Export your changes before trying to save again.');

  const invalid = Object.assign(new Error('Invalid GM map document: object_id'), { name: 'DocumentValidationError', code: 'object_id' });
  assert.equal(editorErrorMessage(invalid, 'es', 'transform').es, 'El borrador contiene datos no válidos y no se pudo usar.');
  const parseError = new SyntaxError('Expected property name with private parser bytes');
  assert.match(editorErrorMessage(parseError, 'es', 'import').es, /JSON/);
  assert.match(editorErrorMessage(parseError, 'en', 'import').en, /JSON/);
  assert.doesNotMatch(editorErrorMessage(parseError, 'en', 'import').en, /private parser/);
});

test('unknown external error bytes never reach the visible status', () => {
  const secret = 'provider raw response: api_key=not-for-ui';
  const error = new Error(secret);
  const node = { textContent: '', dataset: {} };
  const status = new EditorStatus(node, 'es');
  status.set(editorErrorMessage(error, 'es', 'asset'), 'error');
  assert.equal(node.textContent, 'No se pudo cargar el modelo. Vuelve a intentar o elige otro modelo.');
  assert.equal(node.textContent.includes(secret), false);
  assert.equal(node.dataset.kind, 'error');
});

test('visible operation status retains its semantic source and severity across locale changes', () => {
  const node = { textContent: '', dataset: {} };
  const status = new EditorStatus(node, 'es');
  status.set(editorErrorMessage(Object.assign(new Error('revision_conflict'), { code: 'revision_conflict', name: 'DraftConflictError' }), 'es', 'save'), 'error');
  assert.match(node.textContent, /otra pestaña/);
  status.setLocale('en');
  assert.equal(node.textContent, 'This draft changed in another tab. Export your changes before trying to save again.');
  status.setLocale('es');
  assert.match(node.textContent, /otra pestaña/);
  assert.equal(node.dataset.kind, 'error');
});
