import { emptyPresentationBindings, validatePresentationBindings } from '../data/presentationBindings.js';

export const PRESENTATION_PREVIEW_KEY = 'mn.presentation.preview.v1';
const checked = raw => validatePresentationBindings(raw);
const clone = value => JSON.parse(JSON.stringify(value));
export function createPresentationClient({ httpBase = '', online = true, fetchImpl = globalThis.fetch,
  storage = null, timeoutMs = 3000 } = {}) {
  let revision = 0, published = emptyPresentationBindings(), preview = emptyPresentationBindings(), flight, publicationEpoch = 0;
  const listeners = new Set(), stateListeners = new Set(); let timer, target, last, lastState;
  try { const value = checked(JSON.parse(storage?.getItem(PRESENTATION_PREVIEW_KEY) ?? 'null')); if (value.ok) preview = value.value; } catch { /* Storage is optional. */ }
  const effective = () => checked({ ...emptyPresentationBindings(), bindings: { ...published.bindings, ...preview.bindings } }).value;
  last = JSON.stringify(effective());
  const stateKey = () => JSON.stringify([revision, published, preview]);
  lastState = stateKey();
  const notify = () => {
    const next = JSON.stringify(effective());
    if (next !== last) { last = next; for (const callback of listeners) callback(effective()); }
    const state = stateKey();
    if (state !== lastState) { lastState = state; for (const callback of stateListeners) callback(); }
  };
  const url = route => new URL(route, httpBase || 'http://localhost').href;
  async function request(route, options = {}) {
    const controller = new AbortController(); let timeout;
    try {
      return await Promise.race([Promise.resolve().then(() => fetchImpl(url(route), { ...options, cache: 'no-store', signal: controller.signal }))
        .then(async response => ({ status: response.status, body: response.status === 304 ? null : await response.json() })),
      new Promise((_resolve, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })]);
    } finally { clearTimeout(timeout); }
  }
  function load() {
    if (!online) return Promise.resolve({ revision, document: clone(published) });
    if (flight) return flight;
    const epoch = publicationEpoch;
    flight = (async () => {
      try {
        const response = await request('/api/world/presentation', { headers: { 'if-none-match': `"p${revision}"` } });
        if (epoch !== publicationEpoch) return; // A pending poll cannot undo a publication that just succeeded.
        if (response.status === 304) return;
        const value = checked(response.body?.document);
        if (response.status !== 200 || !Number.isSafeInteger(response.body?.revision) || response.body.revision < 0 || !value.ok) throw new Error('invalid');
        revision = response.body.revision; published = value.value;
      } catch { /* A failed or invalid read keeps the last good publication (empty until one loads). */ }
      finally { notify(); }
    })().then(() => ({ revision, document: clone(published) })).finally(() => { flight = null; });
    return flight;
  }
  function setPreview(document) {
    const value = checked(document); if (!value.ok) return false;
    preview = value.value;
    try { storage?.setItem(PRESENTATION_PREVIEW_KEY, JSON.stringify(preview)); } catch { /* The in-memory test still applies. */ }
    notify(); return true;
  }
  function clearPreview() {
    preview = emptyPresentationBindings();
    try { storage?.removeItem(PRESENTATION_PREVIEW_KEY); } catch { /* Storage is optional. */ }
    notify();
  }
  async function publish(document, expectedRevision, token) {
    if (!online || !token) return { ok: false, status: 0, error: 'offline' };
    const value = checked(document); if (!value.ok) return { ok: false, status: 400, error: 'invalid', why: value.why };
    await flight;
    try {
      const result = await request('/api/gm/presentation', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ expectedRevision, document: value.value }) });
      if (result.status === 200 && Number.isSafeInteger(result.body?.revision) && result.body.revision === expectedRevision + 1) {
        publicationEpoch++; revision = result.body.revision; published = value.value; notify(); return { ok: true, revision };
      }
      return { ...result.body, ok: false, status: result.status };
    } catch { return { ok: false, status: 0, error: 'network' }; }
  }
  const poll = () => { if (target?.visibilityState === 'visible') void load(); };
  function stop() { clearInterval(timer); target?.removeEventListener('visibilitychange', poll); target = null; }
  function start(visibilityDocument) {
    stop(); if (!online) return;
    target = visibilityDocument; timer = setInterval(poll, 60_000); target?.addEventListener('visibilitychange', poll);
  }
  return { online, load, effective, setPreview, clearPreview, publish, start, stop,
    get revision() { return revision; }, get published() { return clone(published); }, get preview() { return clone(preview); },
    onStateChange(callback) { stateListeners.add(callback); return () => stateListeners.delete(callback); },
    onChange(callback) { listeners.add(callback); return () => listeners.delete(callback); } };
}
