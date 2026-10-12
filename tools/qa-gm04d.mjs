// GM04d browser acceptance. Production changes only this disposable browser's private local draft.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { GAME } from '../src/data/meta.js';
const production = !!process.env.MN_GM_QA_ORIGIN;
const out = resolve(process.env.MN_GM04D_QA_OUTPUT || `docs/delivery/gm04d/${production ? 'public' : 'local'}`);
const evidence = { schema: 'gm04d-browser/v1', at: new Date().toISOString(), version: GAME.version, production,
  simulatedAuth: !production, checks: [], screenshots: [], pageErrors: [], consoleErrors: [], networkFailures: [], remoteWrites: [] };
const GM = '77777777-7777-4777-8777-777777777777';
const redact = value => String(value).replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
  .replace(/((?:gm_setup_token|access_token|refresh_token|token_hash)=)[^&\s"']+/gi, '$1[redacted]');
let game, browser, page, origin = process.env.MN_GM_QA_ORIGIN, phase = 'start';
const check = async (name, fn) => { phase = name; await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); };
const shot = async name => { await page.screenshot({ path: resolve(out, name + '.png') }); evidence.screenshots.push(name + '.png'); };
const watch = p => {
  p.on('pageerror', error => evidence.pageErrors.push(redact(error.message)));
  p.on('console', msg => { if (msg.type() === 'error') evidence.consoleErrors.push(redact(msg.text())); });
  p.on('requestfailed', req => evidence.networkFailures.push({ path: new URL(req.url()).pathname, error: req.failure()?.errorText }));
  p.on('request', req => { if (req.method() !== 'GET' && /\/api\/gm\//.test(req.url())) evidence.remoteWrites.push(new URL(req.url()).pathname); });
};
async function setup(context) {
  if (!production) await context.addInitScript(accountId => {
    const session = { access_token: 'gm04d-fixture', user: { id: accountId } };
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }), onAuthStateChange() {},
      signInWithPassword: async () => ({ data: { session } }), signUp: async () => ({ data: { session } }), signOut: async () => ({ error: null }) } }) };
  }, GM);
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    return fs.existsSync(file) ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) }) : route.abort();
  });
}
async function enter(p) {
  await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-gm-editor')?.disabled, null, { timeout: 90000 });
  await p.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  await p.locator('#btn-gm-editor').click();
  await p.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor?.active && __mn.gmEditor.history, null, { timeout: 30000 });
  await p.evaluate(() => __mn.world.lighting.setTimeOfDay('day', 0));
}
async function choose(id) {
  await page.locator('[data-action="tab-library"]').click();
  await page.locator(`[data-editor-asset="${id}"]`).click();
  await page.waitForFunction(id => __mn.gmEditor.scatterPanel.entry?.id === id, id);
  await page.locator('[data-action="tab-scatter"]').click();
}
async function setControl(field, value) {
  await page.locator(`[data-scatter-field="${field}"], [data-scatter-select="${field}"]`).evaluate((el, value) => {
    el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function screenPoint(point) {
  return page.evaluate(async point => {
    const THREE = await import('three'), e = __mn.gmEditor, y = e.draftMap.groundAt(point.x, point.z);
    const p = new THREE.Vector3(point.x, y, point.z).project(e.camera), r = e.canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }, point);
}
async function aim(point) {
  await page.evaluate(point => {
    const e = __mn.gmEditor, h = e.draftMap.groundAt(point.x, point.z);
    e.camera.position.set(point.x + 2, h + 25, point.z + 22); e.camera.lookAt(point.x, h, point.z);
    e.camera.updateMatrixWorld(true); e.invalidate();
  }, point);
}
try {
  await mkdir(out, { recursive: true });
  if (!production) {
    game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, log: () => {},
      saveSecret: 'gm04d-local-only', gmDraftsAllowMemory: true, gmAccountIds: [GM],
      publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_fixture' },
      resolvePlayer: async (_req, hello) => hello.token === 'gm04d-fixture' ? GM : null });
    origin = `http://127.0.0.1:${await game.listen()}`;
  }
  evidence.runtime = await (await fetch(origin + '/status')).json();
  if (!production) assert.equal(evidence.runtime.version, GAME.version);
  else {
    evidence.checkoutVersion = GAME.version; evidence.version = evidence.runtime.version;
    evidence.sourceHashes = {};
    for (const file of ['editor.js', 'editor.css', 'resourcePanel.js', 'resourceAdapters.js', 'modelFactory.js', 'contentProjection.js', 'activeContent.js', 'remotePanel.js', 'document.js']) {
      const path = 'src/editor/' + file, response = await fetch(origin + '/' + path, { cache: 'no-store' });
      assert.equal(response.status, 200, path);
      const hash = value => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
      const publicHash = hash(await response.text());
      assert.equal(publicHash, hash(await readFile(path, 'utf8')), path);
      evidence.sourceHashes[path] = publicHash;
    }
  }
  const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await setup(context);
  page = await context.newPage(); watch(page);
  let suffix = '';
  if (production) {
    const file = resolve(process.env.MN_GM_SETUP_FILE); let session;
    try { session = JSON.parse(await readFile(file, 'utf8')); } finally { await unlink(file); }
    assert.match(session.tokenHash, /^[a-f0-9]{32,128}$/i); suffix = `&account-setup=1#gm_setup_token=${session.tokenHash}`;
  }
  await page.goto(origin + '/?q=high&tod=day' + suffix, { waitUntil: 'domcontentloaded' });
  if (production) {
    await page.waitForFunction(() => window.__mn?.gmEntry?.allowed && !document.querySelector('.gm-account-setup-overlay')?.hidden, null, { timeout: 90000 });
    await page.locator('.gm-account-setup-card [data-action="cancel"]').click();
  }
  await enter(page);
  const initial = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));

  const sites = await page.evaluate(async () => {
    const { compileAuthoredResources } = await import('/src/editor/resourceAdapters.js');
    const { createDecoration } = await import('/src/editor/document.js');
    const e = __mn.gmEditor, found = [], objects = [...e.document.objects];
    for (let z = -160; z < 170 && found.length < 2; z += 10) for (let x = -160; x < 170 && found.length < 2; x += 10) {
      if (found.some(p => Math.hypot(x-p.x,z-p.z)<20)) continue;
      const o = createDecoration({id:'gm-'+crypto.randomUUID(),assetId:'prop:gm-resource-palm-v1',
        position:{x,y:e.draftMap.groundAt(x,z),z},collider:'none'});
      try { compileAuthoredResources(e.draftMap,{...e.document,objects:[...objects,o]}); }
      catch { continue; }
      found.push({x,z}); objects.push(o);
    }
    if(found.length!==2) throw Error('No valid resource sites'); return found;
  });
  await check('functional_palette_and_native_models', async () => {
    await page.locator('[data-action="tab-resources"]').click();
    assert.match(await page.locator('.gm-resource-panel').innerText(),/Palmera talable/);
    assert.equal(await page.locator('[data-resource-asset]').count(),2);
    await shot('palette-es-desktop');
  });
  for (const [i,kind] of ['palm','stone'].entries()) await check(`place_${kind}_through_canvas`, async () => {
    await page.locator(`[data-resource-asset="prop:gm-resource-${kind}-v1"]`).click();
    await page.waitForFunction(kind=>__mn.gmEditor.pendingEntry?.id===`prop:gm-resource-${kind}-v1`,kind);
    await aim(sites[i]); const at=await screenPoint(sites[i]); await page.mouse.move(at.x,at.y); await page.mouse.click(at.x,at.y);
    await page.waitForFunction(n=>__mn.gmEditor.document.objects.length===n,initial.objects.length+i+1);
    await page.keyboard.press('Escape');
    evidence[kind] = await page.evaluate(()=>structuredClone(__mn.gmEditor.document.objects.at(-1)));
    assert.match(evidence[kind].id,/^gm-[0-9a-f-]{36}$/); assert.equal(evidence[kind].collider,'none');
    await shot(`placed-${kind}-es`);
  });
  await check('invalid_spacing_is_atomic',async()=>{
    await page.locator('[data-resource-asset="prop:gm-resource-palm-v1"]').click();
    await page.waitForFunction(()=>__mn.gmEditor.pendingEntry?.id==='prop:gm-resource-palm-v1');
    await aim(sites[0]); const at=await screenPoint(sites[0]); const before=await page.evaluate(()=>__mn.gmEditor.document);
    await page.mouse.move(at.x,at.y); await page.mouse.click(at.x,at.y);
    assert.deepEqual(await page.evaluate(()=>__mn.gmEditor.document),before);
    assert.match(await page.locator('[data-role="status"]').innerText(),/5|suelo|recurso/i);
    await page.keyboard.press('Escape');
  });
  await check('resource_duplicate_delete_undo_redo_and_inspector',async()=>{
    await page.locator('[data-action="tab-scene"]').click();
    await page.locator(`[data-selection-id="${evidence.palm.id}"]`).click();
    assert.equal(await page.locator('[data-field="y"]').isDisabled(),true);
    assert.equal(await page.locator('[data-field="rx"]').isDisabled(),true);
    assert.equal(await page.locator('[data-setting="collider"]').isDisabled(),true);
    const before=await page.evaluate(()=>__mn.gmEditor.document);
    await page.locator('[data-action="duplicate"]').click();
    const copied=await page.evaluate(()=>__mn.gmEditor.document); assert.equal(copied.objects.length,before.objects.length+1);
    assert.notEqual(copied.objects.at(-1).id,evidence.palm.id);
    await page.locator('[data-action="delete"]').click(); assert.deepEqual(await page.evaluate(()=>__mn.gmEditor.document),before);
    await page.locator('[data-action="undo"]').click(); assert.deepEqual(await page.evaluate(()=>__mn.gmEditor.document),copied);
    await page.locator('[data-action="redo"]').click(); assert.deepEqual(await page.evaluate(()=>__mn.gmEditor.document),before);
  });
  await check('resource_move_preserves_identity_and_grounding',async()=>{
    const old=evidence.palm; await page.locator(`[data-selection-id="${old.id}"]`).click();
    const x=page.locator('[data-field="x"]'); await x.fill(String(old.transform.position.x+0.5)); await x.dispatchEvent('change');
    const moved=await page.evaluate(id=>__mn.gmEditor.document.objects.find(o=>o.id===id),old.id);
    assert.equal(moved.id,old.id); assert.equal(moved.transform.position.x,old.transform.position.x+0.5);
    const y=await page.evaluate(o=>__mn.gmEditor.draftMap.groundAt(o.transform.position.x,o.transform.position.z),moved);
    assert.ok(Math.abs(moved.transform.position.y-y)<0.001);
  });
  const saved=await page.evaluate(async()=>{await __mn.gmEditor.saveNow();return __mn.gmEditor.document;});
  await check('private_save_and_reopen_preserve_resources',async()=>{
    await page.locator('[data-action="close"]').click();await page.waitForFunction(()=>!__mn.gmEditor?.active);
    await enter(page);assert.deepEqual(await page.evaluate(()=>__mn.gmEditor.document),saved);
    await page.locator('[data-action="tab-resources"]').click();
    await shot('resources-es-desktop');
    await page.locator('[data-role="language"]').click();await shot('resources-en-desktop');
    assert.match(await page.locator('.gm-resource-panel').innerText(),/Harvestable palm/);
  });
  await check('mobile_resource_controls_and_native_preview',async()=>{
    const mobile=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,
      storageState:production?await context.storageState():undefined});
    await setup(mobile);const desktop=page;page=await mobile.newPage();watch(page);
    await page.goto(origin+'/?q=low&tod=day',{waitUntil:'domcontentloaded'});await enter(page);
    await page.locator('[data-action="tab-resources"]').click();
    await page.locator('[data-resource-asset="prop:gm-resource-stone-v1"]').scrollIntoViewIfNeeded();
    await shot('resources-es-mobile');await page.locator('[data-resource-asset="prop:gm-resource-stone-v1"]').tap();
    await page.waitForFunction(()=>__mn.gmEditor.pendingEntry?.id==='prop:gm-resource-stone-v1');
    await page.locator('[data-role="language"]').click();await shot('resources-en-mobile');
    await mobile.close();page=desktop;
  });
  await page.locator('[data-action="close"]').click();
  await check('no_remote_writes_or_render_errors',async()=>{
    assert.deepEqual(evidence.remoteWrites,[]);assert.deepEqual(evidence.pageErrors,[]);
    assert.deepEqual(evidence.consoleErrors.filter(e=>/WebGL|shader|GL_INVALID/i.test(e)),[]);
  });
  phase='complete';
} catch(error){
  evidence.failure={phase,error:redact(error.message)};process.exitCode=1;
  if(page)try{await shot('failure');}catch{}
} finally{
  await browser?.close();await game?.close();evidence.phase=phase;
  await writeFile(resolve(out,'browser.json'),JSON.stringify(evidence,null,2)+'\n');
}
