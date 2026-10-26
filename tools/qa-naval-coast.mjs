#!/usr/bin/env node
// Isolated D08c.4 composition and authoritative-impact checks, never hardware performance claims.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = resolve(import.meta.dirname, '../docs/delivery/d08c4-coastal-hull');
const url = process.env.MN_NAVAL_PILOT_URL || 'http://127.0.0.1:5198/tools/naval-pilot/';
const { chromium } = await import(pathToFileURL(process.env.MN_PLAYWRIGHT).href);
const evidence = { generatedAt: new Date().toISOString(), url, renderer: 'Headless Chrome / SwiftShader', scenarios: [], failures: [] };
const check = (ok, message) => { if (!ok) throw new Error(message); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
 args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox'] });
const waits = (page, fn, timeout = 60000) => page.waitForFunction(fn, null, { timeout });
async function run(viewport, house = false) {
 const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
 const page = await context.newPage(), errors = [], consoleErrors = [];
 page.on('pageerror', e => errors.push(e.message));
 page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
 const r = { viewport, house, errors, consoleErrors, screenshots: [] };
 try {
  r.stage = 'join';
  await page.goto(url + (viewport.width < 900 ? '?mobile=1' : ''), { waitUntil: 'networkidle' });
  await waits(page, () => window.__navalPilotLab?.client?.joined);
  if (house) { await page.locator('#fixture').selectOption('house'); await waits(page, () => window.__navalPilotLab?.client?.joined); }
  r.stage = 'approach';
  await page.locator('#impact-test').click();
  await waits(page, () => window.__navalPilotLab?.client?.naval?.active && !!window.__navalPilotLab.diagnostics().impactFixture);
  await page.locator('#passenger').click();
  await waits(page, () => window.__navalPilotLab.guest?.deck?.active);
  await page.locator('#sound').click();
  await waits(page, () => window.__navalPilotLab.diagnostics().sound?.unlocked);
  r.baseline = await page.evaluate(() => {
   const l=window.__navalPilotLab, d=l.diagnostics();
   return { profile:JSON.stringify(l.server.world.profiles.get(l.client.youServer)), source:d.sourceEcsPose,
    guest:JSON.stringify(l.server.world.profiles.get(l.guest.youServer)), fixture:d.impactFixture };
  });
  r.stage = 'sail';
  if (viewport.width < 900) {
   const throttle = page.locator('[data-axis="throttle"]');
   // Opening audio can scroll the console below the sea. Real CDP touches use viewport coordinates.
   await throttle.scrollIntoViewIfNeeded();
   const session = await context.newCDPSession(page), bounds = await throttle.boundingBox();
   check(bounds && bounds.y + bounds.height/2 > 0 && bounds.y + bounds.height/2 < viewport.height, 'touch target outside viewport');
   r.touchTarget = bounds;
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,id:1}]});
   await waits(page, () => window.__navalPilotLab.diagnostics().controls.throttle === 1);
   await waits(page, () => window.__navalPilotLab.diagnostics().impactCount > 0, 120000);
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  } else {
   await page.keyboard.down('w');
   await waits(page, () => window.__navalPilotLab.diagnostics().impactCount > 0, 120000);
   await page.keyboard.up('w');
  }
  r.stage = 'impact';
  r.impact = await page.evaluate(() => {
   const l=window.__navalPilotLab, d=l.diagnostics(), naval=l.server.world.navalPilot.snapshot(l.client.youServer);
   const publicRaft=l.client.renderRafts(1).find(s=>s.id===d.shipId), e=l.client.youServer;
   return { diagnostics:d, authority:naval, publicRaft, text:document.querySelector('#impact-readout').textContent,
    meter:document.querySelector('#hull-meter').getAttribute('aria-valuenow'),
    owner:{x:l.server.world.ecs.x[e],y:l.server.world.ecs.y[e],z:l.server.world.ecs.z[e]},
    overflow:document.documentElement.scrollWidth>innerWidth };
  });
  check(r.impact.diagnostics.lastImpact.damage > 0, 'no authoritative hull damage');
  check(r.impact.diagnostics.visualImpactCount > 0 && r.impact.diagnostics.effects.impactBursts > 0, 'no impact splash');
  check(r.impact.diagnostics.audioImpactCount > 0 && r.impact.diagnostics.sound.played.impact > 0, 'no scheduled audio impact');
  check(r.impact.diagnostics.profileBaseline && r.impact.diagnostics.guest.profileBaseline, 'saved profile changed');
  check(!r.impact.overflow && r.impact.diagnostics.glError === 0, 'overflow or WebGL error');
  check(r.impact.diagnostics.assetErrors.length === 0 && r.impact.diagnostics.errors.length === 0, 'asset/lab error');
  const label=`${viewport.width}x${viewport.height}${house?'-house':''}`;
  for (const [name, locator] of [['impact',null],['impact-canvas',page.locator('#bay')]]) {
   const file=`${label}-${name}-v1.png`, path=resolve(out,file);
   if (locator) await locator.screenshot({path}); else await page.screenshot({path,fullPage:true});
   r.screenshots.push(file);
  }
  r.stage = 'leave';
  await page.locator('#leave').click();
  await waits(page, () => !window.__navalPilotLab.client.naval.active && !window.__navalPilotLab.guest.deck.active);
  r.after = await page.evaluate(() => {
   const l=window.__navalPilotLab,d=l.diagnostics();
   return {d,profile:JSON.stringify(l.server.world.profiles.get(l.client.youServer)),
    guest:JSON.stringify(l.server.world.profiles.get(l.guest.youServer)), bodies:l.server.world.navalTrial.size};
  });
  check(r.after.profile===r.baseline.profile && r.after.guest===r.baseline.guest,'exit changed saved cargo/blueprint');
  check(JSON.stringify(r.after.d.sourceEcsPose)===JSON.stringify(r.baseline.source),'canonical fixture pose changed');
  check(r.after.bodies===0 && errors.length===0 && consoleErrors.length===0,'teardown or JS error');
  r.pass=true;
 } catch(e) { r.pass=false;r.error=e.stack;try{r.finalDiagnostics=await page.evaluate(()=>window.__navalPilotLab?.diagnostics());}catch{}evidence.failures.push({viewport,house,error:e.message,stage:r.stage}); }
 evidence.scenarios.push(r); console.log(JSON.stringify({viewport,house,pass:r.pass,stage:r.stage,error:r.error?.split('\n')[0]}));
 await writeFile(resolve(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
 await context.close();
}
try {
 await run({width:1280,height:800});
 await run({width:390,height:844});
 await run({width:844,height:390});
 await run({width:1280,height:800},true);
} finally { await browser.close();await writeFile(resolve(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n'); }
process.exitCode=evidence.failures.length?1:0;
