// D06b acceptance harness: real market and raft-cargo DOM over a local Worker, software GPU only.
// env: PHONE=1, PORTRAIT=1, OUT, MN_PLAYWRIGHT, MN_BROWSER, MN_THREE, MN_GSAP.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phone = process.env.PHONE === '1', portrait = process.env.PORTRAIT === '1';
const width = portrait ? 390 : phone ? 844 : 1280, height = portrait ? 844 : phone ? 390 : 720;
const out = path.resolve(process.env.OUT || path.join(root, 'shots/review/d06b-production', portrait ? 'portrait' : phone ? 'mobile' : 'desktop'));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let name; try { name = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, `.${name === '/' ? '/index.html' : name}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  if (name === '/src/net/worker.js') {
    const hook = '\nconst qaOriginal=self.onmessage;let qaLock=false;self.onmessage=ev=>{const m=ev.data;if(m.t!=="qaProduction"){qaOriginal(ev);const c=server?.clients.get(CLIENT);if(c&&qaLock)c.paused=true;if((m.t===MSG.CMD||m.t===MSG.HELLO)&&c?.paused){server.flushEvents();server.sendProfile(CLIENT,c);server.broadcastSnapshot();server.sendSave(CLIENT,c);}return;}const c=server.clients.get(CLIENT);if(m.op==="advance"){for(let s=0;s<m.seconds;s+=5){server.world.economy.advance(5);server.flushEvents();}}if(m.op==="pause"){qaLock=true;c.paused=true;}if(m.op==="unpause"){qaLock=false;c.paused=false;}server.sendProfile(CLIENT,c);server.broadcastSnapshot();server.sendSave(CLIENT,c);self.postMessage({t:"qaProductionAck",nonce:m.nonce});};';
    res.end(fs.readFileSync(file,'utf8')+hook);return;
  }
  fs.createReadStream(file).pipe(res);
});
const hash = (file) => { const b = fs.readFileSync(file); return { bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; };
const evidence = { purpose: 'D06b net/grill construction and production UI over local Worker; software-rendered visual QA',
  base: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  viewport: { width, height, phone, portrait, dpr: 1 }, physicalDevice: false, fpsClaim: false,
  fixture: 'Isolated starter, gold1000; 2 wood/1 iron in pack and3 cloth in hold. Net/grill built through UI; extra2wood/1iron paid in editor. QA-only Worker hook advances actual economy in5s steps, never directly grants production goods.',
  actions: [], screenshots: [], textureRequests: [], pageErrors: [], consoleErrors: [], requestFailures: [],
  renderScheduling: 'Normal Worker/input/frame ticks for construction and initial work; then QA-only Worker pauses the world, services commands, and advances the actual economy in5s slices. Render draws only at screenshots, near-camera fade off.' };
let browser, page;
const ensure = (v, message) => { if (!v) throw new Error(message); };
async function state() {
  return page.evaluate(() => {
    const m = window.__mn, c = m.panels.commercePanel, p = m.client.profile, ship = p?.eco?.ships?.find((s) => s.kind === 'raft');
    return { gold: p?.gold, tradeRev: p?.eco?.tradeRev, pack: p?.eco?.pack, shipRev: ship?.rev,
      hold: ship?.hold, grid: ship?.grid, productionStatus: c.productionStatus, marketActive: c.active, view: c.view, pending: c.pending && { op: c.pending.op, id: c.pending.id, ack: c.pending.ack },
      status: c.root.querySelector('.commerce-feedback')?.textContent, errors: [...m.errors], transport: m.transport.kind, online: m.st.online,
      player: {x:m.ps.x,y:m.ps.y,z:m.ps.z,wade:m.ps.wade}, predErr:m.client.stats.predErr,
      deck: m.client.pred.raftDeck.surface(m.ps.x,m.ps.z,m.ps.y),
      pose: m.client.pred.rafts.find(r=>r.owner===m.client.youServer) };
  });
}
async function settle(before, { raft = false } = {}) {
  await page.waitForFunction(({ before, raft }) => {
    const p = window.__mn.client.profile, c = window.__mn.panels.commercePanel, s = p?.eco?.ships?.find((x) => x.kind === 'raft');
    return !c.pending && p.eco.tradeRev > before.tradeRev && (!raft || s.rev > before.shipRev);
  }, { before, raft }, { timeout: 25000 });
}
async function shot(name) {
  await page.evaluate(() => { const m = window.__mn; m.world.pipeline.markDirty(); m.__commerceDraw(); });
  const file = path.join(out, `${name}.png`); await page.screenshot({ path: file, fullPage: false });
  evidence.screenshots.push({ name, path: path.relative(root, file).replaceAll('\\', '/'), ...hash(file) });
  evidence.actions.push({ name, state: await state() });
  console.log('shot', name);
}
async function clickUi(selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const p = await page.locator(selector).evaluate(el => {
    const b=el.getBoundingClientRect(), x=b.x+b.width/2, y=b.y+b.height/2;
    if (!el.contains(document.elementFromPoint(x,y))) throw new Error('UI target is covered');
    return {x,y};
  });
  if(phone) await page.touchscreen.tap(p.x,p.y); else await page.mouse.click(p.x,p.y);
}
async function drawing() {
  await page.evaluate(() => {const m=window.__mn; m.__commerceDraw=m.world.render.bind(m.world);m.world.render=()=>{};m.world.nearFade(false);});
}
async function aimAt(x, z, level, heightOffset = 0) {
  const p = await page.evaluate(async ({ x, z, level, heightOffset }) => {
    const THREE = await import('three'), { stage } = await import('./src/ui/stage.js');
    const m = window.__mn, r = m.client.pred.rafts.find((a) => a.owner === m.client.youServer), c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    const lx = (x + .5) * 2, lz = (z + .5) * 2;
    const v = new THREE.Vector3(r.x + c * lx + s * lz, r.y + level * 2.6 + heightOffset, r.z - s * lx + c * lz).project(m.world.camera);
    const sx = (v.x + 1) * stage.w / 2, sy = (1 - v.y) * stage.h / 2;
    return { x: stage.rotated ? innerWidth - sy : sx, y: stage.rotated ? sx : sy, sx, sy };
  }, { x, z, level, heightOffset });
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, p);
  ensure(hit === 'game', `Target ${x},${z},${level} covered by UI (${hit}) at ${JSON.stringify(p)}`);
  if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(70);
  const selected = await editorState(); ensure(selected.target?.x === x && selected.target?.z === z, `Ray did not select ${x},${z}: ${JSON.stringify(selected.target)}`);
  return p;
}

async function editorState(){return page.evaluate(()=>{const m=window.__mn,b=m.panels.raftEditor,s=m.client.profile.eco.ships[0];return{rev:s.rev,parts:s.grid.parts,dir:b.dir,target:b.target,status:b.root.querySelector('.re-status').textContent,pending:b.pending};});}
async function settleEditor(){await page.waitForFunction(()=>{const m=window.__mn,b=m.panels.raftEditor,s=m.client.profile.eco.ships[0],r=m.client.pred.rafts[0];return !b.pending&&s.rev===r.rev;});}
async function build(piece){
 const [id,x,z,l,d]=piece;await clickUi('[data-part="'+id+'"]');await page.locator('.re-level').selectOption(String(l));
 while((await editorState()).dir!==d)await clickUi('.re-rotate');
 const p=await aimAt(x,z,l),before=await editorState();await shot('preview-'+id);
 if(phone)await clickUi('.re-action');else await page.mouse.click(p.x,p.y);
 await settleEditor();const after=await editorState();ensure(after.parts.length===before.parts.length+1&&after.parts.some(p=>p.every((v,i)=>v===piece[i])),'Missing built '+id+':'+after.status);
 evidence.actions.push({name:'build-'+id,before,after});
}
async function qa(op,seconds=0){
 await page.evaluate(({op,seconds})=>new Promise(resolve=>{const m=window.__mn,nonce=crypto.randomUUID(),w=m.transport.worker;const listener=e=>{if(e.data.t==='qaProductionAck'&&e.data.nonce===nonce){w.removeEventListener('message',listener);resolve();}};w.addEventListener('message',listener);w.postMessage({t:'qaProduction',op,seconds,nonce});}),{op,seconds});
}
async function dockCamera(){await page.evaluate(async()=>{
 const m=window.__mn,d=m.map.dock,THREE=await import('three');m.teleport(d.base.x+d.dir.x*(d.len-10),d.base.z+d.dir.z*(d.len-10));
 const r=m.client.pred.rafts[0],c=Math.cos(r.yaw),s=Math.sin(r.yaw),yaw=m.world.rig.yaw,center=new THREE.Vector3(r.x+c*1.5+s*2.5,r.y+.4,r.z-s*1.5+c*2.5);
 center.x+=Math.cos(yaw)*2.5;center.z-=Math.sin(yaw)*2.5;const update=m.world.rig.update.bind(m.world.rig);m.world.rig.blend=null;m.world.rig.dist=m.world.rig.distTarget=19;m.world.rig.snapTo(center);m.world.rig.update=(dt,focus,aim,scale)=>update(dt,center,null,scale);
 });await page.waitForFunction(()=>!document.querySelector('.commerce-cargo-launcher').hidden);}
async function production(){await clickUi('.commerce-cargo-launcher');await page.waitForFunction(()=>window.__mn.panels.commercePanel.cargoSnapshot);await clickUi('[data-view="production"]');await page.waitForSelector('.production-card');}
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.MN_BROWSER || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  page = await context.newPage();
  page.on('pageerror', (e) => evidence.pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') evidence.consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => evidence.requestFailures.push({ url: r.url(), error: r.failure()?.errorText }));
  page.on('request', r=>{if(/comic-materials-v1.*\.webp/.test(r.url()))evidence.textureRequests.push(new URL(r.url()).pathname);});
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/), dir = m[1].startsWith('three') ? process.env.MN_THREE : process.env.MN_GSAP;
    if (!dir) return route.continue(); const file = path.join(dir, m[2]);
    return route.fulfill({ status: fs.existsSync(file) ? 200 : 404, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.existsSync(file) ? fs.readFileSync(file) : '' });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (r) => r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/?solo&debug&q=${phone ? 'low' : 'high'}&tod=day&maxdt=0.5`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
  await page.evaluate(async () => {
    const { GAME } = await import('./src/data/meta.js'), { newProfile } = await import('./src/sim/systems/inventory.js');
    const p = newProfile(); p.gold = 1000; p.eco.pack.goods={madera:2,hierro:1};p.eco.ships[0].hold.goods={lona:3}; localStorage.setItem(`${GAME.saveKey}.save.solo`, JSON.stringify(p));
  });
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
  console.log('boot ready', {phone,portrait});
  await drawing(); await clickUi('#btn-play');
  await page.waitForFunction(() => window.__mn.st.mode === 'playing' && window.__mn.input.enabled && window.__mn.client.pred.rafts.length === 1, null, { timeout: 90000 });
  console.log('worker joined');

  await dockCamera();await shot('00-starter');
  if(phone)await clickUi('.raft-build-launcher');else await page.keyboard.press('KeyB');
  await page.waitForFunction(()=>window.__mn.panels.raftEditor.active);await build(['net',1,0,0,0]);
  for(const g of ['madera','madera','hierro']){const before=await state();await page.waitForFunction(g=>!document.querySelector('[data-supply="'+g+'"]').disabled,g);await clickUi('[data-supply="'+g+'"]');await settleEditor();const after=await state();ensure(after.gold<before.gold,'Supply must charge gold');evidence.actions.push({name:'buy-'+g,before,after});}
  await build(['grill',0,1,0,0]);await clickUi('.re-close');await shot('01-built-net-grill');
  const before=await state();await page.waitForTimeout(5500);const natural=await state();
  ensure(Object.entries(natural.grid.work).some(([k,v])=>v>(before.grid.work[k]||0)),'Natural5s runtime did not advance work');evidence.actions.push({name:'normal-worker-clock',before,natural});
  await qa('pause');await production();await shot('02-working-net-waiting-grill');
  await qa('advance',60);await shot('03-fractional-work');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mareanegra.v1.save.solo')));ensure(saved.eco.ships[0].grid.work&&Object.values(saved.eco.ships[0].grid.work).some(v=>v>0&&v<1),'Fraction missing from save');
  evidence.savedBeforeReload=saved;
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__mn&&!document.querySelector('#btn-play').disabled,null,{timeout:180000});
  evidence.savedAfterReload=await page.evaluate(()=>JSON.parse(localStorage.getItem('mareanegra.v1.save.solo')));ensure(JSON.stringify(evidence.savedAfterReload.eco.ships[0].grid.work)===JSON.stringify(saved.eco.ships[0].grid.work),'Reload altered saved work');
  await drawing();await qa('pause');await clickUi('#btn-play');await page.waitForFunction(()=>window.__mn.st.mode==='playing'&&window.__mn.client.pred.rafts.length===1,null,{timeout:90000});await qa('pause');await dockCamera();await production();
  const rejoined=await state();ensure(JSON.stringify(rejoined.grid.work)===JSON.stringify(saved.eco.ships[0].grid.work)&&JSON.stringify(rejoined.hold)===JSON.stringify(saved.eco.ships[0].hold),'Rejoin changed work or cargo');evidence.restored=rejoined;await shot('04-restored-fraction');await qa('unpause');await page.waitForTimeout(4500);await qa('pause');
  await qa('advance',110);let s=await state();ensure(s.hold.goods.pescado===1&&!s.hold.goods.galleta,'First net lot missing or duplicated');await shot('05-first-fish');
  await qa('advance',160);s=await state();ensure(s.hold.goods.pescado===2&&!s.hold.goods.galleta,'Second net lot missing');await shot('06-grill-started');
  await qa('advance',160);s=await state();ensure(s.hold.goods.galleta===2&&s.hold.goods.pescado===1,'Atomic grill conversion incorrect');await shot('07-first-grill-lot');
  await qa('advance',800);const full=await state();ensure((full.hold.goods.pescado||0)+(full.hold.goods.galleta||0)===6,'Hold not full');await shot('08-full-hold');
  await qa('advance',320);const still=await state();ensure(JSON.stringify(still.hold)===JSON.stringify(full.hold)&&JSON.stringify(still.grid.work)===JSON.stringify(full.grid.work),'Full hold lost goods or banked hidden work');evidence.actions.push({name:'full-hold-freezes',full,still});
  await clickUi('[data-view="cargo"]');await page.waitForFunction(()=>window.__mn.panels.commercePanel.cargoSnapshot?.raftRev===window.__mn.client.profile.eco.ships[0].rev);await page.locator('[data-cargo-side]').selectOption('withdraw');
  await clickUi('.commerce-good[data-good="galleta"]');await page.locator('[data-amount]').fill('2');await clickUi('.commerce-confirm');await page.waitForFunction(()=>!window.__mn.panels.commercePanel.pending&&window.__mn.client.profile.eco.pack.goods.galleta===2);await clickUi('[data-view="production"]');await qa('advance',160);const resumed=await state();ensure((resumed.hold.goods.pescado||0)+(resumed.hold.goods.galleta||0)>4,'Net failed to resume after withdrawal');await shot('09-resumed-after-withdrawal');
  evidence.atlas=await page.evaluate(()=>{const im=window.__mn.assets.texture('tex:raft-comic-v1').image;return{width:im.width,height:im.height};});ensure(evidence.atlas.width===(phone?512:1024),'Wrong mobile atlas');
  evidence.final=resumed;ensure(!evidence.pageErrors.length&&!resumed.errors.length,'Game JS errors');evidence.accepted=true;fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({accepted:true,out,shots:evidence.screenshots.length,hold:resumed.hold}));
}catch(e){evidence.accepted=false;evidence.failure=e.stack;if(page){try{const file=path.join(out,'failure.png');await page.screenshot({path:file});evidence.screenshots.push({name:'failure',path:path.relative(root,file).replaceAll('\\','/'),...hash(file)});}catch{}}fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));throw e;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
