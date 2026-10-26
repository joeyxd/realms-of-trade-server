import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// Run from the repository root; MN_PLAYWRIGHT may select an existing external QA installation.
const { chromium } = await import(pathToFileURL(path.resolve(process.env.MN_PLAYWRIGHT ||
  '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const out = 'docs/delivery/rnv03-dark-night';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1365, height: 768 } });
await context.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ quality: 'low', reducedMotion: true, vol: 0, timeOfDay: 'day' })));
const page = await context.newPage();
const evidence = { target: 'https://marea.62.171.136.148.sslip.io', scope: 'Public guest session, actual clock, portable N on/off and map. No inventory writes, SQL or authenticated durability claim.', pageErrors: [], failedRequests: [], phase: 'boot', websockets: [] };
page.on('websocket', socket => { const u = new URL(socket.url()); evidence.websockets.push(u.origin + u.pathname); });
page.on('pageerror', e => evidence.pageErrors.push(e.message.slice(0, 250)));
page.on('requestfailed', r => evidence.failedRequests.push({ path: new URL(r.url()).pathname, error: r.failure()?.errorText }));
try {
  await page.goto(evidence.target + '/?debug=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 60000 });
  evidence.phase = 'title';
  await page.locator('#btn-play').click();
  await page.waitForTimeout(1000);
  if (await page.locator('.account-guest').isVisible()) {
    await page.locator('.account-guest').click(); await page.locator('#btn-play').click();
  }
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 30000 });
  evidence.phase = 'joined';
  evidence.release = await page.evaluate(async () => { const [{GAME},{PROTOCOL_VERSION},{EDITOR_PARTS}] = await Promise.all([import('/src/data/meta.js'),import('/src/net/protocol.js'),import('/src/data/raftEditor.js')]); return {version:GAME.version,protocol:PROTOCOL_VERSION,editorParts:EDITOR_PARTS}; });
  await page.locator('#personal-lantern').waitFor({ state: 'visible', timeout: 10000 });
  evidence.initialOff = await page.evaluate(() => window.__mn.client.personalLantern === false);
  await page.keyboard.press('n');
  await page.waitForFunction(() => window.__mn.client.personalLantern === true && window.__mn.world.lights.portableSources.get(String(window.__mn.client.youServer))?.w > 0.9, null, { timeout: 12000 });
  await page.waitForTimeout(1200);
  evidence.lit = await page.evaluate(() => { const m=window.__mn, s=m.world.lights.portableSources.get(String(m.client.youServer)); return { confirmed: m.client.personalLantern, pressed:document.querySelector('#personal-lantern').getAttribute('aria-pressed'), core:!!m.world.views.get(m.client.youServer)?.personalLanternCore?.visible, radius:s?.r, weight:s?.w }; });
  await page.screenshot({ path: out+'/public-gameplay.png' });
  await page.keyboard.press('n');
  await page.waitForFunction(() => window.__mn.client.personalLantern === false && !window.__mn.world.lights.portableSources.has(String(window.__mn.client.youServer)), null, { timeout: 12000 });
  evidence.offAgain = true;
  evidence.clock = await page.evaluate(async () => { const {phaseAt}=await import('/src/data/clock.js'); const m=window.__mn; const phase=phaseAt(m.client.pred.gameHoursAt(m.client.viewTick(1))); m.tod('day'); return {phase, lightingPhase:m.world.lighting.phase, hours:m.client.pred.gameHoursAt(m.client.viewTick(1)), gameplay:m.world.lighting.gameplay}; });
  await page.keyboard.press('KeyM'); await page.waitForTimeout(300);
  evidence.state = await page.evaluate(() => ({ mode: window.__mn.st.mode, joined: window.__mn.client.joined, clientErrors: window.__mn.errors, titleHidden: document.querySelector('#title').hidden, minimapVisible: !!document.querySelector('.world-minimap'), mapHidden: document.querySelector('#mapview').hidden }));
  await page.screenshot({ path: out+'/public-map.png' });
  evidence.pass = evidence.initialOff && evidence.lit.confirmed && evidence.lit.core && evidence.lit.radius===7.5 && evidence.offAgain && evidence.clock.gameplay && Math.abs(evidence.clock.phase-evidence.clock.lightingPhase)<0.02 && evidence.websockets.includes('wss://marea.62.171.136.148.sslip.io/ws') && evidence.state.joined && evidence.pageErrors.length===0 && evidence.release.protocol===40 && evidence.release.version==='0.6.0-alpha.28' && !evidence.state.mapHidden && evidence.state.minimapVisible && evidence.failedRequests.length===0 && Object.keys(evidence.state.clientErrors||{}).length===0;
} catch(e) {
  evidence.pass=false; evidence.error=e.message.slice(0,250);
  evidence.ui=await page.evaluate(()=>({text:document.body.innerText.slice(-1800),mode:window.__mn?.st?.mode,joined:window.__mn?.client?.joined}));
  await page.screenshot({path:out+'/public-failure.png'});
} finally {
  evidence.generatedAt=new Date().toISOString();
  fs.writeFileSync(out+'/public-browser.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence)); await browser.close();
}
if(!evidence.pass)process.exitCode=1;
