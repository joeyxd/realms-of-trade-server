// Real editor + IndexedDB UI acceptance. Loopback only; remote responses use the local fake client.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd(), out = path.resolve('docs/delivery/i18n04b/editor');
fs.mkdirSync(out, { recursive: true });
const { chromium } = await import(pathToFileURL(path.resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  // Keep catalog requests isolated from the real asset catalog and deny private paths.
  if (/^\/assets\/editor\/(catalog|thumbnails)\.json$/.test(name)) {
    res.writeHead(200, { 'content-type': mime['.json'] }); res.end(JSON.stringify({ version: 1, assets: [] })); return;
  }
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep) || /(^|\/)\./.test(name) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = { schema: 'i18n04b-editor/v1', at: new Date().toISOString(), scope: 'current GM02/GM03a/GM03b1 WorldEditor and IndexedDB; simulated local and remote failures; no credentials or gameplay host', checks: [], screenshots: [], errors: [] };
const check = async (name, fn) => { await fn(); report.checks.push(name); console.log(`PASS ${name}`); };
const shot = async (page, name) => { const file = path.join(out, name + '.png'); await page.screenshot({ path: file }); report.screenshots.push(path.relative(root, file)); };
const status = page => page.locator('.gm-status');
const snapshot = page => page.evaluate(() => {
  const e = editorQA.editor;
  return { document: e.history.current(), revision: e.revision, dirty: e.dirty, selected: e.selectedId, saves: editorQA.requests.save,
    remoteRequests: { inspect: editorQA.requests.remoteInspect, save: editorQA.requests.remoteSave } };
});
const locale = async (page, lang) => { await page.evaluate(lang => editorQA.setLocale(lang), lang); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-MX' });
  const open = async () => {
    const page = await context.newPage(); page.on('pageerror', error => { report.errors.push(error.message); console.error('EDITOR PAGE:', error.message); });
    await page.goto(origin + '/tools/fixtures/i18n-editor.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.editorQA?.editor.active); return page;
  };
  const page = await open();
  await check('initial status and toolbar switch ES/EN without draft changes or autosave', async () => {
    assert.equal(await page.evaluate(() => editorQA.editor.baseLayer.map === editorQA.editor.map), true,
      'GM BaseDecorationLayer must use the fixture’s generated map');
    assert.ok(await page.evaluate(() => editorQA.editor.map.props.length > 0), 'fixture must use generated world props');
    assert.ok(await page.evaluate(() => editorQA.editor.baseLayer.entries.size > 0),
      'generated editable base props must remain available to the GM base layer');
    assert.match(await status(page).innerText(), /Borrador local/);
    const before = await snapshot(page);
    await page.locator('[data-role=language]').click();
    assert.match(await status(page).innerText(), /Local draft/);
    assert.equal(await page.locator('[data-action=save]').innerText(), 'Save locally');
    await page.locator('[data-role=language]').click();
    await page.waitForTimeout(1100);
    assert.match(await status(page).innerText(), /Borrador local/);
    assert.deepEqual(await snapshot(page), before);
  });
  await page.evaluate(() => { editorQA.add(); void editorQA.pendingSave(); });
  await page.waitForFunction(() => !!editorQA.rejectSave);
  const pending = await snapshot(page);
  await check('pending save changes language without duplicate writes; late conflict uses current locale', async () => {
    await locale(page, 'en');
    assert.deepEqual(await snapshot(page), pending);
    await page.evaluate(() => editorQA.rejectSave(Object.assign(new Error('<img src=x>raw revision_conflict'), { code: 'revision_conflict' })));
    await page.waitForFunction(() => !editorQA.editor.saveTask);
    assert.match(await status(page).innerText(), /conflict|another tab/i);
    assert.doesNotMatch(await status(page).innerText(), /revision_conflict|<img|raw/);
    const message = await status(page).innerText();
    await shot(page, '01-save-conflict-en');
    await locale(page, 'es');
    assert.notEqual(await status(page).innerText(), message);
    assert.match(await status(page).innerText(), /conflicto|otra pestaña/i);
    assert.deepEqual(await snapshot(page), pending);
    await shot(page, '02-save-conflict-es');
  });
  await check('remote panel language selector persists globally; late CAS conflict rerenders without repeating the save', async () => {
    const dialog = page.locator('.gm-remote-dialog');
    await page.locator('[data-action=remote]').click();
    await page.waitForFunction(() => editorQA.editor.remotePanel.state === 'ready');
    await dialog.locator('[data-remote=language]').click();
    assert.deepEqual(await page.evaluate(() => [editorQA.editor.lang, localStorage.getItem('mn.locale')]), ['en', 'en']);
    await dialog.locator('[data-remote=save]').click();
    await dialog.locator('[data-remote=confirm]').click();
    await page.waitForFunction(() => !!editorQA.rejectRemoteSave);
    const localBefore = await page.evaluate(() => ({ document: editorQA.editor.history.current(), revision: editorQA.editor.revision,
      dirty: editorQA.editor.dirty, selected: editorQA.editor.selectedId, saves: editorQA.requests.save }));
    const attempt = await page.evaluate(() => editorQA.remoteAttempt);
    assert.equal(attempt.expectedRevision, 1);
    assert.deepEqual(attempt.document, localBefore.document);
    assert.equal(await page.evaluate(() => editorQA.requests.remoteSave), 1);
    await locale(page, 'es');
    assert.match(await dialog.locator('.gm-remote-state').innerText(), /esperando confirmaci/i);
    await page.evaluate(() => editorQA.rejectRemoteSave(Object.assign(new Error('raw provider bytes'), { code: 'gm_draft_conflict' })));
    await page.waitForFunction(() => editorQA.editor.remotePanel.state === 'conflict');
    assert.match(await dialog.locator('.gm-remote-error').innerText(), /Otro navegador/i);
    assert.doesNotMatch(await dialog.innerText(), /raw provider bytes|gm_draft_conflict/);
    await shot(page, '07-remote-conflict-es');
    await dialog.locator('[data-remote=language]').click();
    assert.deepEqual(await page.evaluate(() => [editorQA.editor.lang, localStorage.getItem('mn.locale')]), ['en', 'en']);
    assert.match(await dialog.locator('.gm-remote-error').innerText(), /Another browser/i);
    assert.equal(await page.evaluate(() => editorQA.requests.remoteSave), 1);
    assert.deepEqual(await page.evaluate(() => ({ document: editorQA.editor.history.current(), revision: editorQA.editor.revision,
      dirty: editorQA.editor.dirty, selected: editorQA.editor.selectedId, saves: editorQA.requests.save })), localBefore);
    await shot(page, '08-remote-conflict-en');
  });
  await check('invalid import preserves draft and translates existing error without replay', async () => {
    await locale(page, 'es');
    const before = await snapshot(page);
    await page.locator('[data-role=import]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
    await page.waitForFunction(() => !editorQA.editor.importTask);
    const message = await status(page).innerText();
    assert.match(message, /JSON|formato|importación/i);
    assert.doesNotMatch(message, /SyntaxError|Unexpected|import_json/);
    await locale(page, 'en');
    assert.notEqual(await status(page).innerText(), message);
    assert.match(await status(page).innerText(), /JSON|format|import/i);
    assert.deepEqual(await snapshot(page), before);
    await shot(page, '03-import-error-en');
  });
  await check('pending model load and unknown external error switch safely without refetch', async () => {
    await page.evaluate(() => { void editorQA.pendingModel(); });
    await page.waitForFunction(() => !!editorQA.rejectModel);
    assert.match(await page.locator('.gm-catalog-status').innerText(), /Preparing/);
    const before = await snapshot(page);
    await locale(page, 'es');
    assert.match(await page.locator('.gm-catalog-status').innerText(), /Preparando/);
    await page.evaluate(() => editorQA.rejectModel(new Error('<svg onload=alert(1)>provider private details')));
    await page.waitForFunction(() => editorQA.editor.catalog.busy.size === 0);
    const message = await page.locator('.gm-catalog-status').innerText();
    assert.match(message, /modelo/i);
    assert.doesNotMatch(message, /provider|private|svg|onload/);
    await locale(page, 'en');
    assert.match(await page.locator('.gm-catalog-status').innerText(), /model/i);
    assert.notEqual(await page.locator('.gm-catalog-status').innerText(), message);
    assert.equal(await page.evaluate(() => editorQA.requests.model), 1);
    assert.deepEqual(await snapshot(page), before);
    await shot(page, '04-model-error-en');
  });
  // Actual IndexedDB compare-and-swap conflict between independent editor tabs.
  await page.close();
  const first = await open(), second = await open();
  await check('two real tabs keep newer IndexedDB draft on conflict and locale changes', async () => {
    await first.evaluate(async () => { editorQA.add(); await editorQA.editor.saveNow(); });
    const saved = await first.evaluate(() => editorQA.editor.store.load());
    await second.evaluate(async () => { editorQA.add(); await editorQA.editor.saveNow(); });
    assert.equal(await second.evaluate(() => editorQA.editor.dirty), true);
    const before = await snapshot(second);
    await locale(second, 'es'); assert.match(await status(second).innerText(), /conflicto|otra pestaña/i);
    await locale(second, 'en'); assert.match(await status(second).innerText(), /conflict|another tab/i);
    assert.deepEqual(await second.evaluate(() => editorQA.editor.store.load()), saved);
    assert.deepEqual(await snapshot(second), before);
    await shot(second, '05-indexeddb-conflict-en');
    await second.setViewportSize({ width: 1024, height: 720 });
    await locale(second, 'es'); await shot(second, '09-compact-conflict-es');
    assert.equal(await status(second).evaluate(el => {
      const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    }), true);
    assert.equal(await second.locator('[data-setting=space]').evaluate(el => {
      const context = document.createElement('canvas').getContext('2d'); context.font = getComputedStyle(el).font;
      return context.measureText(el.selectedOptions[0].textContent).width + 40 < el.clientWidth;
    }), true, 'translated axis label fits the compact inspector');
  });
  assert.deepEqual(report.errors, []);
  await context.close();
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
