import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const { chromium } = await import(pathToFileURL(resolve(root, '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const baseUrl = 'http://127.0.0.1:5194/tools/character-alpha-lab/index.html';
const manifestUrl = 'http://127.0.0.1:5194/docs/art/source/character-alpha-v1/manifest.json';
const evidencePath = resolve(root, 'docs/art/character-alpha-v1/browser-evidence-v1.json');
const imageDir = resolve(root, 'docs/art/character-alpha-v1/browser-evidence-v1');
const downloadDir = resolve(imageDir, 'downloads');
await mkdir(downloadDir, { recursive: true });

const evidence = {
  schema: 'character-alpha-browser-evidence-v1',
  generatedAt: new Date().toISOString(),
  target: baseUrl,
  technicalBrowserAcceptance: { status: 'running', viewport: { desktop: '1440x900', mobile: '390x844' }, assertions: [], screenshots: [], downloads: [], networkErrors: [], pageErrors: [], consoleErrors: [], mobilePngRequests: [] },
  subjectiveVisualAcceptance: { status: 'not-assessed', note: 'Captures are evidence for human visual review; this script does not accept the illustration style or art quality.' }
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await desktopContext.newPage();
const state = evidence.technicalBrowserAcceptance;
const recordAssertion = (name, detail = {}) => state.assertions.push({ name, passed: true, ...detail });
const recordPage = (target, bucket = state) => {
  target.on('pageerror', (error) => bucket.pageErrors.push(String(error)));
  target.on('console', (message) => { if (message.type() === 'error') bucket.consoleErrors.push(message.text()); });
  target.on('requestfailed', (request) => bucket.networkErrors.push({ url: request.url(), error: request.failure()?.errorText ?? 'request failed' }));
  target.on('response', async (response) => {
    if (response.status() >= 400 && new URL(response.url()).host === '127.0.0.1:5194') bucket.networkErrors.push({ url: response.url(), status: response.status() });
  });
};
recordPage(page);

async function waitReady(target = page) {
  await target.waitForFunction(() => document.querySelector('#load-state')?.textContent === 'CATÁLOGO LISTO' && !document.querySelector('#export-png')?.disabled && !document.querySelector('#export-json')?.disabled, null, { timeout: 30000 });
}
async function capture(target, name) {
  await target.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const path = resolve(imageDir, name);
  await target.screenshot({ path, fullPage: true, animations: 'disabled' });
  state.screenshots.push(path.slice(root.length + 1).replaceAll('\\', '/'));
}
async function exportFile(target, buttonSelector, name) {
  const [download] = await Promise.all([target.waitForEvent('download'), target.locator(buttonSelector).click()]);
  const path = resolve(downloadDir, name);
  await download.saveAs(path);
  state.downloads.push({ name, path: path.slice(root.length + 1).replaceAll('\\', '/'), suggestedFilename: download.suggestedFilename() });
  return path;
}
function parsePng(bytes) {
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', 'PNG signature');
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), dataStart = offset + 8;
    if (type === 'IHDR') { width = bytes.readUInt32BE(dataStart); height = bytes.readUInt32BE(dataStart + 4); bitDepth = bytes[dataStart + 8]; colorType = bytes[dataStart + 9]; }
    if (type === 'IEND') break;
    offset += length + 12;
  }
  return { width, height, bitDepth, colorType };
}
function pngContainsTransparentPixel(bytes) {
  const chunks = []; let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), start = offset + 8;
    if (type === 'IDAT') chunks.push(bytes.subarray(start, start + length));
    if (type === 'IEND') break;
    offset += length + 12;
  }
  const header = parsePng(bytes);
  if (header.bitDepth !== 8 || header.colorType !== 6) return false;
  const raw = (awaitlessInflate(Buffer.concat(chunks)));
  const bpp = 4, stride = header.width * bpp, previous = Buffer.alloc(stride);
  for (let row = 0; row < header.height; row++) {
    const filter = raw[row * (stride + 1)], scan = Buffer.from(raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? scan[i - bpp] : 0, above = previous[i], upperLeft = i >= bpp ? previous[i - bpp] : 0;
      if (filter === 1) scan[i] = (scan[i] + left) & 255;
      else if (filter === 2) scan[i] = (scan[i] + above) & 255;
      else if (filter === 3) scan[i] = (scan[i] + Math.floor((left + above) / 2)) & 255;
      else if (filter === 4) scan[i] = (scan[i] + paeth(left, above, upperLeft)) & 255;
      else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
    }
    for (let i = 3; i < stride; i += 4) if (scan[i] === 0) return true;
    scan.copy(previous);
  }
  return false;
}
function awaitlessInflate(data) {
  // PNG's IDAT stream is synchronous to keep the artifact script dependency-free.
  return requireInflate(data);
}
function requireInflate(data) {
  return inflateSync(data);
}
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
// Imported lazily through Node's built-in module; no extra image package is needed.
const { inflateSync } = await import('node:zlib');

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const manifestResponse = await page.request.get(manifestUrl);
  assert.equal(manifestResponse.status(), 200, 'character alpha manifest is available');
  const manifest = await manifestResponse.json();
  assert.ok(manifest.bodies?.length >= 2, 'manifest provides both body bases');
  const findBody = (pattern, fallbackIndex) => manifest.bodies.find((item) => pattern.test(`${item.id} ${item.label}`)) ?? manifest.bodies[fallbackIndex];
  const male = findBody(/\bmale\b|mascul|hombre|var[oó]n/i, 0), female = findBody(/female|femen|mujer/i, 1);
  assert.notEqual(male.id, female.id, 'male and female bodies resolve to distinct manifest entries');
  recordAssertion('manifest exposes two body choices', { bodyIds: { male: male.id, female: female.id }, bodyLabels: { male: male.label, female: female.label } });
  await waitReady();
  assert.equal(await page.locator('#body-select option').count(), manifest.bodies.length);
  assert.equal(await page.locator('[data-mode="master"]').getAttribute('aria-pressed'), 'true');
  recordAssertion('initial master view reaches ready state');

  await capture(page, 'desktop-male-master.png');
  await page.locator('[data-mode="modular"]').click(); await waitReady();
  assert.equal(await page.locator('[data-mode="modular"]').getAttribute('aria-pressed'), 'true');
  await capture(page, 'desktop-male-modular.png');
  recordAssertion('master and modular modes render');

  await page.locator('#body-select').selectOption(female.id); await waitReady();
  assert.equal(await page.locator('#body-select').inputValue(), female.id);
  await capture(page, 'desktop-female-modular.png');
  await page.locator('[data-mode="master"]').click(); await waitReady();
  await capture(page, 'desktop-female-master.png');
  recordAssertion('both body choices render in master and modular modes');

  await page.locator('[data-mode="modular"]').click(); await waitReady();
  const chosenCategory = await page.locator('.part-group').evaluateAll((sections) => sections.find((section) => section.querySelectorAll('.choice').length > 1)?.dataset.category ?? null);
  assert.ok(chosenCategory, 'at least one category has an illustrated selectable piece');
  const categorySection = page.locator(`.part-group[data-category="${chosenCategory}"]`);
  await categorySection.locator('.choice').nth(1).click(); await waitReady();
  assert.equal(await categorySection.locator('.choice').nth(1).getAttribute('aria-pressed'), 'true');
  await categorySection.locator('.choice').first().click(); await waitReady();
  assert.equal(await categorySection.locator('.choice').first().getAttribute('aria-pressed'), 'true');
  recordAssertion('individual piece selection and removal render');

  await page.locator('#shuffle').click(); await waitReady();
  const shufflePath = await exportFile(page, '#export-json', 'desktop-shuffle-descriptor.json');
  const shuffleDescriptor = JSON.parse(await (await import('node:fs/promises')).readFile(shufflePath, 'utf8'));
  for (const [category, id] of Object.entries(shuffleDescriptor.parts)) assert.ok(id === null || female.layers?.[category]?.some((item) => item.id === id), `shuffle selects a supplied ${category} option`);
  assert.equal(shuffleDescriptor.mode, 'modular');
  recordAssertion('shuffle uses only supplied catalog choices', { bodyId: female.id });

  await page.locator('[data-zoom="face"]').click();
  assert.equal(await page.locator('#artboard').evaluate((node) => node.classList.contains('zoom-face')), true);
  await page.locator('[data-backdrop="checker"]').click();
  assert.equal(await page.locator('#artboard').evaluate((node) => node.classList.contains('backdrop-checker')), true);
  await capture(page, 'desktop-face-checker.png');
  recordAssertion('face zoom and checker backdrop toggles work');
  await page.locator('[data-zoom="full"]').click();

  await page.locator('#reset').click(); await waitReady();
  const resetSnapshotPath = await exportFile(page, '#export-json', 'desktop-reset-descriptor.json');
  const resetDescriptor = JSON.parse(await (await import('node:fs/promises')).readFile(resetSnapshotPath, 'utf8'));
  const expectedDefaults = Object.fromEntries(Object.entries(female.defaults ?? {}).filter(([category, id]) => female.layers?.[category]?.some((item) => item.id === id)));
  for (const [category, id] of Object.entries(expectedDefaults)) assert.equal(resetDescriptor.parts[category], id, `reset applies default ${category}`);
  assert.equal(resetDescriptor.bodyId, female.id);
  assert.equal(resetDescriptor.mode, 'modular');
  recordAssertion('reset restores the selected body defaults and exports their snapshot', { bodyId: female.id, defaultsChecked: Object.keys(expectedDefaults) });

  await page.locator('#body-select').selectOption(male.id); await waitReady();
  await page.locator('[data-mode="modular"]').click(); await waitReady();
  const pngPath = await exportFile(page, '#export-png', 'desktop-male-composite.png');
  const pngBytes = await (await import('node:fs/promises')).readFile(pngPath), pngInfo = parsePng(pngBytes);
  assert.deepEqual([pngInfo.width, pngInfo.height], [manifest.canvas?.width ?? 1024, manifest.canvas?.height ?? 1536]);
  assert.equal(pngContainsTransparentPixel(pngBytes), true, 'exported character PNG retains transparent pixels');
  const descriptorPath = await exportFile(page, '#export-json', 'desktop-male-descriptor.json');
  const descriptor = JSON.parse(await (await import('node:fs/promises')).readFile(descriptorPath, 'utf8'));
  assert.equal(descriptor.bodyId, male.id); assert.equal(descriptor.mode, 'modular'); assert.equal(descriptor.quality, 'desktop');
  recordAssertion('PNG and JSON downloads reflect the completed transparent composition', { png: pngInfo, hasTransparency: true, descriptorBody: descriptor.bodyId });

  const beforeVariant = await page.locator('#character').evaluate(c=>c.toDataURL());
  await page.locator('.part-group[data-category="hair"]').getByRole('button',{name:'Barrido',exact:true}).click(); await waitReady();
  await page.locator('.part-group[data-category="eyes"]').getByRole('button',{name:'Océano',exact:true}).click(); await waitReady();
  await page.locator('.part-group[data-category="beard"]').getByRole('button',{name:'Barba corta',exact:true}).click(); await waitReady();
  assert.notEqual(await page.locator('#character').evaluate(c=>c.toDataURL()), beforeVariant, 'catalog variants change actual rendered pixels');
  const variantPath = await exportFile(page,'#export-json','desktop-male-variant-descriptor.json');
  const variant = JSON.parse(await (await import('node:fs/promises')).readFile(variantPath,'utf8'));
  assert.deepEqual([variant.parts.hair,variant.parts.eyes,variant.parts.beard],['swept','blue','short']);
  await page.locator('[data-zoom="face"]').click();
  await capture(page,'desktop-male-variants-face.png');
  await page.locator('.part-group[data-category="beard"]').getByRole('button',{name:'Ninguno',exact:true}).click(); await waitReady();
  assert.notEqual(await page.locator('#character').evaluate(c=>c.toDataURL()), beforeVariant);
  const withoutBeardPath=await exportFile(page,'#export-json','desktop-male-without-beard.json');
  assert.equal(JSON.parse(await (await import('node:fs/promises')).readFile(withoutBeardPath,'utf8')).parts.beard,null);
  recordAssertion('hair, iris and beard variants change rendered pixels and exported selection');

  const raceContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const racePage = await raceContext.newPage(); recordPage(racePage);
  let releaseFemale;
  const femaleGate = new Promise((resolveGate) => { releaseFemale = resolveGate; });
  let femaleRequestSeen;
  const seenFemale = new Promise((resolveSeen) => { femaleRequestSeen = resolveSeen; });
  const femaleMasterUrl = new URL(female.master.url, manifestUrl).href;
  await racePage.route(femaleMasterUrl, async (route) => { femaleRequestSeen(); await femaleGate; await route.continue(); });
  await racePage.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await waitReady(racePage);
  await racePage.locator('#body-select').selectOption(female.id); await seenFemale;
  assert.equal(await racePage.locator('#export-json').isDisabled(), true, 'exports are disabled while the current composition is pending');
  await racePage.locator('#body-select').selectOption(male.id); await waitReady(racePage);
  const [raceDownload] = await Promise.all([racePage.waitForEvent('download'), racePage.locator('#export-json').click()]);
  const racePath = resolve(downloadDir, 'rapid-switch-descriptor.json'); await raceDownload.saveAs(racePath);
  const raceDescriptor = JSON.parse(await (await import('node:fs/promises')).readFile(racePath, 'utf8'));
  assert.equal(raceDescriptor.bodyId, male.id, 'rapid switch cannot export stale female identity');
  releaseFemale(); await racePage.waitForTimeout(150);
  assert.equal(await racePage.locator('#body-select').inputValue(), male.id);
  state.downloads.push({ name: 'rapid-switch-descriptor.json', path: racePath.slice(root.length + 1).replaceAll('\\', '/') });
  recordAssertion('rapid body changes prevent stale or partial export', { finalBodyId: male.id, pendingExportDisabled: true });
  await raceContext.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, acceptDownloads: true });
  const mobilePage = await mobileContext.newPage(); recordPage(mobilePage);
  const pngResponseEvents = [];
  mobilePage.on('response', async (response) => {
    if (/\.png(?:\?|$)/i.test(response.url())) {
      try {
        const bytes = await response.body(), info = parsePng(bytes);
        pngResponseEvents.push({ url: response.url(), status: response.status(), width: info.width, height: info.height });
      } catch { /* Preserve the original response error record for malformed or failed assets. */ }
    }
  });
  await mobilePage.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await waitReady(mobilePage);
  await mobilePage.locator('#body-select').selectOption(female.id); await waitReady(mobilePage);
  await mobilePage.locator('[data-mode="modular"]').click(); await waitReady(mobilePage);
  await capture(mobilePage, 'mobile-female-modular-full.png');
  await mobilePage.waitForLoadState('networkidle', { timeout: 15000 });
  await mobilePage.locator('[data-zoom="face"]').click(); await mobilePage.locator('[data-backdrop="checker"]').click();
  await capture(mobilePage, 'mobile-female-modular-face-checker.png');
  const mobileMetrics = await mobilePage.evaluate(() => {
    const interactive = [...document.querySelectorAll('button,select')].filter((element) => !element.disabled);
    return { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, controls: interactive.map((element) => { const r=element.getBoundingClientRect(); return { id:element.id||element.dataset.category||element.dataset.mode||element.dataset.zoom||element.dataset.backdrop||element.textContent.trim().slice(0,30), left:Math.round(r.left), right:Math.round(r.right), insideViewport:r.left>=0&&r.right<=innerWidth }; }) };
  });
  assert.equal(mobileMetrics.horizontalOverflow, false, 'mobile page has no horizontal overflow');
  assert.ok(mobileMetrics.controls.every((item) => item.insideViewport), 'mobile controls remain horizontally reachable');
  assert.ok(pngResponseEvents.length > 0, 'mobile image requests were observed');
  for (const asset of pngResponseEvents) {
    assert.match(new URL(asset.url).pathname, /\/mobile\//, `mobile image request must use mobileUrl: ${asset.url}`);
    assert.ok(asset.width <= 512 && asset.height <= 768, `mobile PNG dimensions exceed the 512px-wide derivative contract: ${asset.width}x${asset.height}`);
  }
  state.mobilePngRequests = pngResponseEvents;
  recordAssertion('mobile layout has reachable controls and loads only <=512px-wide mobile PNGs', { ...mobileMetrics, mobilePngCount: pngResponseEvents.length });
  const mobileJsonPath=await exportFile(mobilePage,'#export-json','mobile-female-descriptor.json');
  const mobileDescriptor=JSON.parse(await (await import('node:fs/promises')).readFile(mobileJsonPath,'utf8'));
  assert.equal(mobileDescriptor.quality,'mobile'); assert.equal(mobileDescriptor.mobileFallback,false);
  assert.equal(mobileDescriptor.bodyId,female.id);
  const mobilePngPath=await exportFile(mobilePage,'#export-png','mobile-female-composite.png');
  assert.equal(pngContainsTransparentPixel(await (await import('node:fs/promises')).readFile(mobilePngPath)),true);
  recordAssertion('mobile exports preserve alpha and report the loaded mobile quality');
  await mobileContext.close();

  const errors = [...state.pageErrors, ...state.networkErrors.filter((item) => item.status || item.error), ...state.consoleErrors];
  assert.deepEqual(errors, [], 'browser run has no page, first-party network, or console errors');
  state.status = 'passed';
  state.completedAt = new Date().toISOString();
} catch (error) {
  state.status = 'failed'; state.failure = String(error?.stack ?? error);
  throw error;
} finally {
  await browser.close();
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify({ evidence: evidencePath, status: state.status, screenshots: state.screenshots, downloads: state.downloads, failure: state.failure ?? null }, null, 2));
}
