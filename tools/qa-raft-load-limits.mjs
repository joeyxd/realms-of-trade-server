#!/usr/bin/env node
// D08c.9 browser acceptance for overweight blocking and an in-place foundation reinforcement.
// Uses one isolated ephemeral memory host and one fresh browser context per viewport.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { ownerRaftCapacity } from '../src/sim/systems/raftCapacity.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { GAME } from '../src/data/meta.js';

const out = resolve('docs/delivery/d08c9-raft-load-limits');
await mkdir(out, { recursive: true });
const playwrightUrl = process.env.MN_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href
  : pathToFileURL(resolve('.scratch/pilot-browser/node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwrightUrl);
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Check that excessive cargo blocks a new helm mount, an in-place reinforced foundation changes the authoritative limit, and the saved plan survives signed guest reentry.',
  harness: 'Fresh isolated ephemeral GameHost and memory store per viewport, GAME.seed, local Three.js/GSAP routes, normal Chrome renderer, no .env, SQL, external hosts, or persistent browser storage. Browser is not launched by this script until explicitly run.',
  fixture: 'Fresh starter raft. QA fixture puts hierro:1 in hold and madera:1+piedra:3 in backpack (cargo 21 uM; hold 3 uV, backpack 9 uV), preserves gold and other goods. Reinforcement spends exactly 1 madera+1 hierro, leaving piedra:3 (12 uM). Inventory injection is setup only, not a reward or balance claim.',
  expected: { before: { dryMass: 21, structuralLimit: 40, safeDisplacement: 50.4, totalLimit: 40, crewMass: 3, cargoMass: 21, totalMass: 45, overMass: 5, status: 'overloaded' }, after: { dryMass: 22, structuralLimit: 44, safeDisplacement: 50.4, totalLimit: 44, crewMass: 3, cargoMass: 12, totalMass: 37, freeMass: 7, status: 'ready' } },
  protocolVersion: PROTOCOL_VERSION,
  performanceClaim: false,
  viewports: [],
  failures: [],
};
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
const specs = [
  { name: 'load-limits-desktop-1280x720', width: 1280, height: 720, touch: false },
  { name: 'load-limits-mobile-844x390', width: 844, height: 390, touch: true },
  { name: 'load-limits-portrait-390x844', width: 390, height: 844, touch: true },
];
const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
function serverFor(host) { return host.game.server; }
async function waitCalm(server, entity, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && server.world.ecs.regenT[entity] < 3) await pause(50);
  check(server.world.ecs.regenT[entity] >= 3, `owner did not reach calm: regenT=${server.world.ecs.regenT[entity]}`);
}
async function installLocalRoutes(page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/); if (!match) return route.abort();
    const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    if (!fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
}
async function waitSaved(server, entity, previousBlob) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const client = [...server.clients.values()].find((c) => c.entity === entity), blob = client?.lastBlob;
    if (client && client.saveAt == null && typeof blob === 'string' && blob && blob !== previousBlob) return blob;
    await pause(100);
  }
  throw new Error('signed profile save did not settle after reinforcement');
}
function placeOwnerAtHelm(host, entity) {
  const server = serverFor(host), world = server.world, raft = publicRafts(world).find((r) => r.owner === entity);
  check(raft?.helm, `missing fixed helm anchor for owner ${entity}`);
  const point = pilotPoint(raft, raft.helm), c = world.ecs;
  c.x[entity] = point.x; c.y[entity] = point.y; c.z[entity] = point.z; c.facing[entity] = point.f;
  c.vx[entity] = c.vz[entity] = c.kbx[entity] = c.kbz[entity] = c.moveMag[entity] = 0;
  world.raftDeck.update(publicRafts(world)); server.broadcastSnapshot(); return { raft, point };
}
async function snapCameraToPlayer(page, point) {
  await page.waitForFunction(({ x, z }) => { const m = window.__mn, e = m?.client?.youLocal, c = m?.client?.pred?.ecs; return e != null && c && Math.hypot(c.x[e] - x, c.z[e] - z) < .8; }, { x: point.x, z: point.z }, { timeout: 20000 });
  await page.evaluate(async () => { const THREE = await import('three'), m = window.__mn, e = m.client.youLocal, c = m.client.pred.ecs; m.world.rig.blend = null; m.world.rig.snapTo(new THREE.Vector3(c.x[e], c.y[e], c.z[e])); });
  await page.waitForTimeout(300);
}
async function openApp(page, port, result) {
  page.on('pageerror', (e) => result.errors.push(String(e?.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
  page.on('requestfailed', (request) => result.requestFailures.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText || '' }));
  page.on('response', (response) => { if (response.status() >= 400) result.httpFailures.push({ url: response.url(), status: response.status() }); });
  await installLocalRoutes(page); await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__mn?.input?.enabled && !window.__mn?.st?.paused, null, { timeout: 30000 });
  await page.evaluate(() => {
    const editor = window.__mn.panels.raftEditor, send = editor.send.bind(editor), onResult = editor.onResult.bind(editor);
    window.__qaRaftSends = []; window.__qaRaftAcks = []; window.__qaActionClicks = 0;
    editor.send = (m) => { window.__qaRaftSends.push({ ...m }); return send(m); };
    editor.onResult = (e) => { window.__qaRaftAcks.push({ type: e?.type, op: e?.op, ok: e?.ok, why: e?.why, rev: e?.rev, opId: e?.opId }); return onResult(e); };
    editor.root.querySelector('.re-action').addEventListener('click', () => window.__qaActionClicks++, true);
    window.__qaNavalEvents = []; window.__mn.client.bus.on('navalPilot', (e) => window.__qaNavalEvents.push({ ...e }));
  });
  return page.evaluate(() => window.__mn.client.youServer);
}
async function snap(page, result, label) {
  await page.waitForTimeout(150); const file = resolve(out, `${result.name}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false }); result.screenshots.push(file);
}
async function snapCanvas(page,result,label){
  const canvas=page.locator('#game'); await canvas.waitFor({state:'visible',timeout:5000});
  const metrics=await canvas.evaluate(el=>{const r=el.getBoundingClientRect();return{width:el.width,height:el.height,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};});
  check(metrics.width>0&&metrics.height>0,'game canvas is empty before deck close-up');
  const ghostWasVisible=await page.evaluate(()=>{const g=window.__mn?.panels?.raftEditor?.ghost;if(!g)return false;const was=g.visible;g.visible=false;return was;});
  const style=await page.addStyleTag({content:'#ui,#fade{visibility:hidden!important}'});
  const file=resolve(out,`${result.name}-${label}.png`); await canvas.screenshot({path:file}); await style.evaluate(el=>el.remove());
  await page.evaluate(was=>{const g=window.__mn?.panels?.raftEditor?.ghost;if(g)g.visible=was;},ghostWasVisible); result.screenshots.push(file);
  result.reinforcedDeckCloseup={file,canvas:metrics,overlayExcluded:true,previewGhostHiddenForCapture:ghostWasVisible,
    method:'temporarily hide only DOM overlay and editor preview ghost while capturing the live raft canvas'};
}
async function scrollEditorToForecast(page, spec, cdp) {
  const trace=[];
  for(let i=0;i<5;i++){
    const read=await page.evaluate(()=>{const root=document.querySelector('.raft-editor'),forecast=root?.querySelector('.re-capacity'),button=root?.querySelector('.re-action');
      const r=e=>{const q=e?.getBoundingClientRect();return q&&{x:q.x,y:q.y,right:q.right,bottom:q.bottom,width:q.width,height:q.height};};
      const within=q=>q&&q.width>0&&q.height>0&&q.left>=0&&q.top>=0&&q.right<=innerWidth&&q.bottom<=innerHeight;
      return{root:r(root),forecast:r(forecast),button:r(button),scrollTop:root?.scrollTop,scrollHeight:root?.scrollHeight,clientHeight:root?.clientHeight,
        visible:!!root&&!root.hidden&&within(forecast?.getBoundingClientRect())&&within(button?.getBoundingClientRect()),rotated:document.body.classList.contains('rotated')};});
    trace.push(read); if(read.visible) break;
    if(!read.root?.width||!read.root?.height) break;
    if(spec.touch&&read.rotated&&cdp){
      // A portrait stage rotates 90 degrees: physical right-to-left scrolls the logical editor downward.
      const y=read.root.y+read.root.height*.52,x0=read.root.x+read.root.width*.78,x1=read.root.x+read.root.width*.22;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y}]});
      for(let n=1;n<=4;n++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*n/4,y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else if(spec.touch&&cdp){
      const x=read.root.x+read.root.width*.5,y0=read.root.y+read.root.height*.8,y1=read.root.y+read.root.height*.2;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:y0}]});
      for(let n=1;n<=4;n++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y0+(y1-y0)*n/4}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else {
      await page.mouse.move(read.root.x+read.root.width/2,read.root.y+read.root.height/2); await page.mouse.wheel(0,180);
    }
    await page.waitForTimeout(90);
  }
  return trace;
}
function cap(c) {
  return c && Object.fromEntries(['dryMass','holdMass','packMass','cargoMass','totalMass','buoyancy','cargoMax','structuralLimit','safeDisplacement','totalLimit','crewCount','crewMass','guestMass','freeMass','overMass','status','holdVolume','holdFree','holdCap','packVolume','packFree','packCap','mode','raftRev','tradeRev'].map(k => [k,c[k]]));
}
async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], consoleErrors: [], requestFailures: [], httpFailures: [], screenshots: [] }; evidence.viewports.push(result);
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store: createMemoryStore(), worldId: null, saveSecret: `qa-raft-load-limits-${spec.name}`, chat: { enabled: false }, log() {} });
  let context;
  try {
    console.log(`[${spec.name}] starting isolated memory host`); const port = await host.listen();
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, hasTouch: spec.touch, isMobile: spec.touch });
    const page = await context.newPage(), cdp=spec.touch?await context.newCDPSession(page):null; let entity = await openApp(page, port, result);
    const server = serverFor(host), world = server.world, profile = world.profiles.get(entity), ship = profile?.eco?.ships?.find(s => s.kind === 'raft' && s.at === 'aldea');
    check(profile && ship && ship.hp > 0, 'fresh profile missing starter raft'); result.initialGold = profile.gold;
    ship.hold.goods = { ...(ship.hold.goods || {}), hierro: 1 };
    profile.eco.pack.goods = { ...(profile.eco.pack.goods || {}), madera: 1, piedra: 3 };
    profile.eco.tradeRev++; ship.rev++; world.rafts.get(ship.id).ship = ship;
    const helm = placeOwnerAtHelm(host, entity); await snapCameraToPlayer(page, helm.point);
    result.fixture = { shipId: ship.id, hold: { hierro: 1 }, pack: { madera: 1, piedra: 3 }, goldPreserved: true,
      helmAnchor: helm.raft.helm, cameraSnapForAcceptance: true, ownerPosition: helm.point, seed: GAME.seed };
    await page.waitForFunction(() => { const c = window.__mn?.client?.capacity; return c?.id && c.status && Number.isFinite(c.structuralLimit) && Number.isFinite(c.safeDisplacement); }, null, { timeout: 25000 });
    await waitCalm(server, entity);
    const serverBefore = ownerRaftCapacity(world, entity), before = await page.evaluate(() => ({ capacity: window.__mn.client.capacity && { ...window.__mn.client.capacity },
      pack: { ...(window.__mn.client.profile?.eco?.pack?.goods || {}) }, hold: { ...(window.__mn.client.profile?.eco?.ships?.find(s => s.kind === 'raft')?.hold?.goods || {}) },
      gold: window.__mn.client.profile?.gold, shipRev: window.__mn.client.profile?.eco?.ships?.find(s => s.kind === 'raft')?.rev }));
    check(before.capacity?.mode === 'port' && before.capacity.status === 'overloaded' && before.capacity.overMass === 5 && before.capacity.cargoMass === 21,
      `owner snapshot did not show overloaded starting fixture: ${JSON.stringify(before)}`);
    check(JSON.stringify(cap(before.capacity)) === JSON.stringify(cap(serverBefore)), 'client capacity differs from server before action');
    result.before = { ...before, authoritative: cap(serverBefore) }; await snap(page, result, '00-overloaded-before');

    // Ask the real pilot command to mount while cargo is over limit; it must be denied before creating a voyage.
    await page.waitForFunction(() => window.__mn.navigation.interaction()?.prompt?.toLowerCase().includes('travesía') ||
      window.__mn.navigation.interaction()?.prompt?.toLowerCase().includes('sobrecargada') ||
      document.querySelector('.ln-prompt [data-run]')?.textContent?.toLowerCase().includes('zarpar'), null, { timeout: 15000 });
    if (spec.touch) await page.locator('.ln-prompt [data-run]').tap(); else await page.keyboard.press('f');
    await page.waitForFunction(() => window.__qaNavalEvents.some(e => e.op === 'mount'), null, { timeout: 12000 });
    result.mountDenied = await page.evaluate(() => ({ event: window.__qaNavalEvents.findLast(e => e.op === 'mount') || null,
      active: window.__mn.client.naval?.active, voyage: window.__mn.client.voyage?.active,
      notice: document.querySelector('.ln-notice')?.textContent || '' }));
    check(result.mountDenied.event?.ok === false && result.mountDenied.event?.why === 'capacity' && !result.mountDenied.active && !result.mountDenied.voyage,
      `overloaded mount was not denied cleanly for capacity: ${JSON.stringify(result.mountDenied)}`);
    check(/porte excedido|reduce carga|refuerza/i.test(result.mountDenied.notice), `capacity denial did not explain the load limit to the player: ${JSON.stringify(result.mountDenied)}`);
    await page.waitForFunction(() => { const p = document.querySelector('.commerce-panel'); return p; }, null, { timeout: 1000 }).catch(() => {});
    const cargoWarning = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.cargo-capacity')], card = cards.find(e => e.classList.contains('is-overloaded'));
      const live = document.querySelector('.ln-load, [data-load-warning]'); const shown = card || live;
      const s = shown && getComputedStyle(shown), r = card?.getBoundingClientRect(); return { card: r && {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}, text: shown?.innerText || '', classes: card?.className || '',
        liveWarning: live?.innerText || '', display: s?.display, visibility: s?.visibility };
    });
    result.overloadWarning = cargoWarning;
    // Cargo panel is also checked by server-private owner capacity below; open through its actual launcher when present.
    if (spec.touch) {
      const launch = page.locator('.commerce-cargo-launcher'); if (await launch.count() && await launch.isVisible()) await launch.tap({ force: true });
    } else await page.keyboard.press('KeyH').catch(() => {});
    await page.waitForFunction(() => document.querySelector('.cargo-capacity.is-overloaded'), null, { timeout: 12000 });
    await snap(page, result, '01-overloaded-warning');

    await page.locator('.commerce-panel .commerce-close').click({ force: true }).catch(() => {});
    await waitCalm(server, entity);
    if (spec.touch) await page.locator('.raft-build-launcher').tap({ force: true }); else await page.keyboard.press('KeyB');
    await page.waitForFunction(() => window.__mn.panels.raftEditor.active, null, { timeout: 15000 });
    await page.waitForFunction(() => { const r = window.__mn.world.rig; return r && !r.blend && Math.hypot(r.look.x, r.look.z) < .08; }, null, { timeout: 5000 }).catch(() => {});
    const cam = await page.evaluate(() => ({ look: { x: window.__mn.world.rig.look.x, z: window.__mn.world.rig.look.z }, blend: !!window.__mn.world.rig.blend }));
    check(!cam.blend && Math.hypot(cam.look.x, cam.look.z) < .12, `editor camera not settled: ${JSON.stringify(cam)}`); result.editorCamera = cam;
    await page.locator('.raft-editor [data-mode="reinforce"]').click({ force: true });

    // Set the target by real pointer movement/touch on an existing basic foundation; confirmation is a separate real action button.
    const attempts = []; let chosen = null;
    for (const [x,z] of [[0,0],[1,0],[0,1],[1,1]]) {
      const p = await page.evaluate(async ({x,z}) => { const THREE = await import('three'), {stage}=await import('./src/ui/stage.js'), m=window.__mn;
        const raft=m.client.pred.rafts.find(r=>String(r.id)===String(m.client.capacity.id)); const lx=(x+.5)*2,lz=(z+.5)*2,c=Math.cos(raft.yaw),s=Math.sin(raft.yaw);
        m.world.camera.updateMatrixWorld(true); const v=new THREE.Vector3(raft.x+c*lx+s*lz,raft.y,raft.z-s*lx+c*lz).project(m.world.camera);
        const px=(v.x+1)*stage.w/2,py=(1-v.y)*stage.h/2,screen=stage.rotated?{x:innerWidth-py,y:px}:{x:px,y:py};
        return {screen,inside:screen.x>=0&&screen.y>=0&&screen.x<innerWidth&&screen.y<innerHeight,hit:document.elementFromPoint(screen.x,screen.y)?.id||document.elementFromPoint(screen.x,screen.y)?.tagName}; },{x,z});
      if (!p.inside || p.hit !== 'game') { attempts.push({cell:[x,z],...p,skip:'not canvas'}); continue; }
      if (spec.touch) await page.touchscreen.tap(p.screen.x,p.screen.y); else await page.mouse.move(p.screen.x,p.screen.y);
      await page.waitForTimeout(100);
      const q=await page.evaluate(()=>{const e=window.__mn.panels.raftEditor; return {target:e.target, disabled:e.root.querySelector('.re-action').disabled,
        forecast:e.placementForecast(e.context()), text:e.root.querySelector('.re-capacity')?.innerText||'', button:e.root.querySelector('.re-action')?.textContent||''};});
      attempts.push({cell:[x,z],...p,...q}); if(q.target&&q.forecast?.state==='valid'&&q.forecast?.after&& !q.disabled){chosen={cell:[x,z],point:p,read:q};break;}
    }
    check(chosen,`no basic foundation produced a valid reinforcement forecast: ${JSON.stringify(attempts)}`);
    const beforeShipRev=ship.rev, partsBefore=publicRafts(world).find(r=>r.owner===entity).parts.map(p=>[...p]);
    const capBefore=ownerRaftCapacity(world,entity); const expectedIndex=partsBefore.findIndex(p=>p[0]==='foundation'&&p[1]===chosen.cell[0]&&p[2]===chosen.cell[1]&&p[3]===0);
    check(expectedIndex>=0,`selected target is not an authoritative basic foundation: ${JSON.stringify({chosen,partsBefore})}`);
    const preview=chosen.read.forecast;
    check(preview.before.structuralLimit===40&&preview.after.structuralLimit===44&&preview.before.buoyancy===preview.after.buoyancy&&preview.before.overMass===5&&preview.after.status==='ready',
      `reforcement forecast did not show the expected structural/load change: ${JSON.stringify({preview: {before:cap(preview.before),after:cap(preview.after)}})}`);
    check(/VISTA PREVIA/i.test(chosen.read.text)&&/REFUERZO/i.test(chosen.read.text)&&/exceso/i.test(chosen.read.text)&&/libres/i.test(chosen.read.text)&&/Confirmar refuerzo/i.test(chosen.read.button),
      `reinforcement UI lacks before/after warning or explicit confirmation: ${JSON.stringify(chosen.read)}`);
    const scrollTrace=await scrollEditorToForecast(page,spec,cdp);
    const scrolled=scrollTrace.at(-1),forecastRect=scrolled?.forecast,actionRect=scrolled?.button;
    check(scrolled?.visible&&forecastRect?.x>=0&&forecastRect.right<=spec.width+1&&actionRect?.x>=0&&actionRect.right<=spec.width+1,
      `reinforcement forecast/button could not be brought into the viewport by scrolling the editor: ${JSON.stringify(scrollTrace)}`);
    result.reinforcementPreview={cell:chosen.cell,point:chosen.point.screen,forecast:{before:cap(preview.before),after:cap(preview.after)},text:chosen.read.text,button:chosen.read.button,
      rect:forecastRect,actionRect,editorScroll:scrollTrace,attempts};
    await snap(page,result,'02-reinforce-forecast');

    const preBlob=[...server.clients.values()].find(c=>c.entity===entity)?.lastBlob||'';
    const sendCount=await page.evaluate(()=>window.__qaRaftSends.length), ackCount=await page.evaluate(()=>window.__qaRaftAcks.length);
    // A user click/tap on the enabled confirmation button is the commit; canvas targeting did not submit.
    if(spec.touch) await page.locator('.raft-editor .re-action').tap(); else await page.locator('.raft-editor .re-action').click();
    await page.waitForFunction(n=>window.__qaRaftSends.length>n,sendCount,{timeout:10000});
    await page.waitForFunction(n=>window.__qaRaftAcks.length>n,ackCount,{timeout:20000});
    const sentAck=await page.evaluate(({sendCount,ackCount})=>({send:window.__qaRaftSends[sendCount],ack:window.__qaRaftAcks[ackCount],clicks:window.__qaActionClicks}),{sendCount,ackCount});
    check(sentAck.send?.op==='reinforce'&&sentAck.send.index===expectedIndex&&sentAck.ack?.ok===true,
      `server did not accept the explicit reinforcement intent: ${JSON.stringify(sentAck)}`);
    await page.waitForFunction(({rev})=>{const p=window.__mn.client.profile,s=p?.eco?.ships?.find(q=>q.kind==='raft'&&q.at==='aldea');return s?.rev>rev&&!window.__mn.panels.raftEditor.pending;},{rev:beforeShipRev},{timeout:25000});
    const after=await page.evaluate(()=>{const m=window.__mn,p=m.client.profile,s=p?.eco?.ships?.find(q=>q.kind==='raft'&&q.at==='aldea');return {gold:p.gold,tradeRev:p.eco.tradeRev,shipRev:s.rev,
      hold:{...(s.hold.goods||{})},pack:{...(p.eco.pack.goods||{})},parts:s.grid.parts.map(q=>[...q]),capacity:m.client.capacity&&{...m.client.capacity}};});
    const reinforced=after.parts.filter(p=>p[0]==='reinforcedFoundation');
    check(reinforced.length===1&&after.parts.length===partsBefore.length&&after.parts[expectedIndex][0]==='reinforcedFoundation'&&
      after.parts[expectedIndex][1]===partsBefore[expectedIndex][1]&&after.parts[expectedIndex][2]===partsBefore[expectedIndex][2],
      `reinforcement did not replace exactly one foundation in place: ${JSON.stringify({expectedIndex,partsBefore,after})}`);
    check(!after.hold.hierro&&!after.pack.madera&&after.hold.piedra===undefined&&after.pack.piedra===3,
      `reinforcement cost was not paid from hold/backpack while retaining other goods: ${JSON.stringify(after)}`);
    const expectedAfter=ownerRaftCapacity(world,entity);
    check(after.capacity.status==='ready'&&after.capacity.overMass===0&&after.capacity.cargoMass===12&&after.capacity.structuralLimit===44&&after.capacity.buoyancy===56,
      `post-refit capacity did not allow the current load: ${JSON.stringify(after.capacity)}`);
    check(JSON.stringify(cap(after.capacity))===JSON.stringify(cap(expectedAfter)),'post-refit client capacity differs from server projection');
    result.reinforcement={interaction:spec.touch?'touch tap on Confirmar refuerzo':'mouse click on Confirmar refuerzo',sentAck,clicks:sentAck.clicks,
      before:{shipRev:beforeShipRev,parts:partsBefore,capacity:cap(capBefore)},after:{...after,capacity:cap(after.capacity)},authoritativeAfter:cap(expectedAfter)};
    await snap(page,result,'03-reinforced-plan');
    await snapCanvas(page,result,'03b-reinforced-deck-canvas-only');

    // Save, reload the same signed guest session, then verify the exact blueprint and remaining cargo.
    await page.locator('.raft-editor .re-close').click({force:true}); console.log(`[${spec.name}] waiting for signed profile save`);
    const blob=await waitSaved(server,entity,preBlob); result.savedProfileBlobBytes=Buffer.byteLength(blob);
    console.log(`[${spec.name}] saved ${result.savedProfileBlobBytes} bytes; reloading browser page`);
    await page.reload({waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.__mn&&!document.querySelector('#btn-play')?.disabled,null,{timeout:30000});
    await page.locator('#btn-play').click({force:true}); await page.waitForFunction(()=>window.__mn?.client?.joined&&window.__mn?.st?.mode==='playing',null,{timeout:90000});
    await page.waitForFunction(()=>window.__mn.client.profile?.eco?.ships?.some(s=>s.grid.parts.some(p=>p[0]==='reinforcedFoundation'))&&
      window.__mn.client.profile.eco.pack.goods.piedra===3,null,{timeout:30000});
    entity=await page.evaluate(()=>window.__mn.client.youServer);
    await page.evaluate(() => { window.__qaNavalEvents=[]; window.__mn.client.bus.on('navalPilot',e=>window.__qaNavalEvents.push({...e})); });
    const restored=await page.evaluate(()=>{const m=window.__mn,p=m.client.profile,s=p?.eco?.ships?.find(q=>q.kind==='raft'&&q.at==='aldea');return {gold:p.gold,tradeRev:p.eco.tradeRev,shipRev:s.rev,
      hold:{...(s.hold.goods||{})},pack:{...(p.eco.pack.goods||{})},parts:s.grid.parts.map(q=>[...q]),capacity:m.client.capacity&&{...m.client.capacity}};});
    check(restored.gold===result.initialGold&&JSON.stringify(restored.parts)===JSON.stringify(after.parts)&&JSON.stringify(restored.hold)===JSON.stringify(after.hold)&&JSON.stringify(restored.pack)===JSON.stringify(after.pack),
      `signed profile reentry changed the refit plan or remaining cargo: ${JSON.stringify({after,restored})}`);
    const restoredHelm=placeOwnerAtHelm(host,entity); await snapCameraToPlayer(page,restoredHelm.point); await waitCalm(server,entity);
    result.reentry={signedProfileRestored:true,blobBytes:result.savedProfileBlobBytes,state:{...restored,capacity:cap(restored.capacity)}};

    // Retry the actual helm mount after the reinforcement; it should now pass with the same cargo load.
    await page.waitForFunction(() => window.__mn.navigation.interaction()?.prompt?.toLowerCase().includes('travesía') ||
      document.querySelector('.ln-prompt [data-run]')?.textContent?.toLowerCase().includes('zarpar'), null, { timeout: 15000 });
    if (spec.touch) await page.locator('.ln-prompt [data-run]').tap(); else await page.keyboard.press('f');
    await page.waitForFunction(()=>window.__qaNavalEvents.some(e=>e.op==='mount'&&e.ok===true),null,{timeout:25000});
    await page.waitForFunction(()=>window.__mn.client.naval?.active&&window.__mn.client.voyage?.active,null,{timeout:15000});
    await page.waitForFunction(()=>window.__mn.client.capacity?.mode==='sailing'&&window.__mn.client.capacity.status==='ready',null,{timeout:20000});
    result.mountAccepted=await page.evaluate(()=>{const event=window.__qaNavalEvents.findLast(e=>e.op==='mount'&&e.ok===true),naval=window.__mn.client.naval;
      return{event:event&&Object.fromEntries(['op','ok','why','epoch','active','shipId','ack'].filter(k=>k in event).map(k=>[k,event[k]])),
        capacity:window.__mn.client.capacity&&{...window.__mn.client.capacity},voyage:window.__mn.client.voyage&&{...window.__mn.client.voyage},
        naval:Object.fromEntries(['epoch','active','seq','ack','shipId','authorityTick'].filter(k=>k in naval).map(k=>[k,naval[k]]))};});
    check(result.mountAccepted.event?.ok&&result.mountAccepted.capacity?.status==='ready'&&result.mountAccepted.capacity?.structuralLimit===44,
      `mount did not succeed with the reinforced, under-limit raft: ${JSON.stringify(result.mountAccepted)}`);
    await page.waitForFunction(touch=>{const root=window.__mn.navigation.root,load=root.querySelector(touch?'[data-touch-load]':'[data-load]'),r=load?.getBoundingClientRect();return !root.hidden&&r?.width>0&&/Porte libre/.test(load.textContent);},spec.touch,{timeout:15000});
    await snap(page,result,'04-sailing-after-refit');
    check(result.errors.length===0&&result.consoleErrors.length===0,`browser errors: ${JSON.stringify({errors:result.errors,console:result.consoleErrors})}`);
    result.status='passed'; await context.close(); context=null;
  } catch(error) {
    result.status='failed'; result.failure=String(error?.stack||error); evidence.failures.push(`${spec.name}: ${error?.message||error}`);
    result.hostDebug={tick:host.game.server.world.tick,status:host.game.status(),clients:[...host.game.server.clients].map(([id,c])=>({id,entity:c.entity})),
      entity:[...host.game.server.clients.values()].find(c=>c.entity)?.entity};
    try { const page=context?.pages()[0]; if(page){result.browserDebug=await page.evaluate(()=>({url:location.href,readyState:document.readyState,bodyText:document.body?.innerText?.slice(0,1500),joined:window.__mn?.client?.joined,entity:window.__mn?.client?.youServer,
      capacity:window.__mn?.client?.capacity,naval:window.__mn?.client?.naval,voyage:window.__mn?.client?.voyage,profile:window.__mn?.client?.profile?.eco,
      sends:window.__qaRaftSends||[],acks:window.__qaRaftAcks||[],navalEvents:window.__qaNavalEvents||[],editor:window.__mn?.panels?.raftEditor?.active,
      editorMode:window.__mn?.panels?.raftEditor?.mode,editorStatus:document.querySelector('.re-status')?.textContent,editorForecast:document.querySelector('.re-capacity')?.innerText,
      consoleErrors:window.__mn?.errors||[]})); const file=resolve(out,`${result.name}-failure.png`);await page.screenshot({path:file,fullPage:false});result.screenshots.push(file);} } catch {}
  } finally { if(context) await context.close().catch(()=>{}); await host.close(); }
}
try {
  const selected=process.env.MN_RAFT_LOAD_LIMITS_VIEWPORT?specs.filter(s=>s.name===process.env.MN_RAFT_LOAD_LIMITS_VIEWPORT):specs;
  check(selected.length>0,'MN_RAFT_LOAD_LIMITS_VIEWPORT did not match a configured viewport');
  for(const spec of selected) await run(spec);
} finally { await browser.close(); }
evidence.finishedAt=new Date().toISOString(); evidence.status=evidence.failures.length?'failed':'passed';
const filename=process.env.MN_RAFT_LOAD_LIMITS_VIEWPORT?`${process.env.MN_RAFT_LOAD_LIMITS_VIEWPORT}.json`:'raft-load-limits-evidence.json';
await writeFile(resolve(out,filename),`${JSON.stringify(evidence,null,2)}\n`,'utf8');
console.log(JSON.stringify({status:evidence.status,viewports:evidence.viewports.map(({name,status,failure,screenshots})=>({name,status,failure,screenshots})),output:resolve(out,filename)},null,2));
if(evidence.status!=='passed') process.exitCode=1;
