// D06a acceptance harness: real market and raft-cargo DOM over a local Worker, software GPU only.
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
const out = path.resolve(process.env.OUT || path.join(root, 'shots/review/d06a-commerce', portrait ? 'portrait' : phone ? 'mobile' : 'desktop'));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let name; try { name = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, `.${name === '/' ? '/index.html' : name}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const hash = (file) => { const b = fs.readFileSync(file); return { bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; };
const evidence = { purpose: 'D06a real market and raft cargo UI over local Worker; software-rendered visual QA',
  base: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  viewport: { width, height, phone, portrait, dpr: 1 }, physicalDevice: false, fpsClaim: false,
  fixture: 'Fresh newProfile, gold=1000, starter raft and empty pack. Debug teleport only places the avatar at the real NPC/deck before normal input.',
  actions: [], screenshots: [], textureRequests: [], pageErrors: [], consoleErrors: [], requestFailures: [],
  renderScheduling: 'Normal Worker/input/frame ticks; render draws only at screenshots, near-camera fade off for inspection.' };
let browser, page;
const ensure = (v, message) => { if (!v) throw new Error(message); };
async function state() {
  return page.evaluate(() => {
    const m = window.__mn, c = m.panels.commercePanel, p = m.client.profile, ship = p?.eco?.ships?.find((s) => s.kind === 'raft');
    return { gold: p?.gold, tradeRev: p?.eco?.tradeRev, pack: p?.eco?.pack, shipRev: ship?.rev,
      hold: ship?.hold, marketActive: c.active, view: c.view, pending: c.pending && { op: c.pending.op, id: c.pending.id, ack: c.pending.ack },
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
async function talkTo(id) {
  await page.evaluate((id) => {
    const m = window.__mn, npc = m.map.npcs.find((n) => n.id === id);
    if (!npc) throw new Error(`missing generated NPC ${id}`);
    m.teleport(npc.x+1, npc.z+1);
  }, id);
  await page.waitForFunction((id) => {
    const m = window.__mn, wanted = m.map.npcs.find((x) => x.id === id), n = wanted && [...m.client.entities.values()].find((x) => x.name === wanted.name);
    return !!n?.ready && Math.hypot(m.ps.x - n.r.x, m.ps.z - n.r.z) < 3.2;
  }, id, { timeout: 20000 });
  if (phone) {
    await page.waitForFunction(() => { const b = document.querySelector('#touch .t-act'); return b && !b.hidden; }, null, { timeout: 10000 });
    await page.locator('#touch .t-act').click();
  } else await page.keyboard.press('KeyF');
  await page.waitForSelector('#dialog [data-market]', { timeout: 15000 });
  await page.locator('#dialog [data-market]').click();
  await page.waitForFunction(() => { const c = window.__mn.panels.commercePanel; return c.active && c.view === 'market' && c.market && c.rows.length > 0; }, null, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.commerce-panel .market-quote b')?.textContent.includes('Solicitando'), null, { timeout: 15000 });
}
async function setGoodQty(g, side, n) {
  const row = page.locator(`.commerce-panel .market-row[data-good="${g}"]`); await row.click();
  await page.locator('.commerce-panel [data-market-side]').selectOption(side);
  await page.locator('.commerce-panel [data-amount]').fill(String(n));
  await page.waitForFunction(() => {
    const c = window.__mn.panels.commercePanel, q = c.quote;
    return q && q.signature === JSON.stringify([c.town, c.selected, c.qty, c.side]) && !c.root.querySelector('.commerce-confirm').disabled;
  }, null, { timeout: 15000 });
}
async function trade(g, side, n, name) {
  await setGoodQty(g, side, n); await shot(`${name}-quote`);
  const lostAck=!phone&&name==='02-buy-three-wood';
  if(lostAck) await page.evaluate(()=>{const m=window.__mn,c=m.panels.commercePanel,original=c.onResult.bind(c);c.onResult=ev=>{if(ev.ok&&ev.op==='buy'&&!m.__droppedCommerceAck){m.__droppedCommerceAck=ev;return;}original(ev);};});
  const before = await state(); await page.locator('.commerce-panel .commerce-confirm').click();
  if(lostAck){
    await page.waitForFunction(rev=>window.__mn.client.profile.eco.tradeRev>rev,before.tradeRev);
    const paid=await state();ensure(paid.pending&&!paid.pending.ack,'Dropped ack must retain pending intent');
    await page.locator('.commerce-close').click();await talkTo('merchant');
    ensure((await state()).pending?.id===paid.pending.id,'Close/reopen lost the pending intent');
    await page.waitForFunction(()=>!document.querySelector('.commerce-retry').hidden);
    await shot('02a-lost-ack-retry');await page.locator('.commerce-retry').click();await settle(before);
    const retried=await state();ensure(retried.gold===paid.gold&&JSON.stringify(retried.pack)===JSON.stringify(paid.pack),'Reply retry repeated resource movement');
    evidence.actions.push({name:'lost-buy-ack-close-reopen-same-intent',paid,retried});
  }else await settle(before);
  const after = await state(); ensure(after.tradeRev === before.tradeRev + 1, `${name} did not advance trade revision once`);
  evidence.actions.push({ name, before, after }); await shot(name); return { before, after };
}
async function openCargo() {
  await page.evaluate(async () => {
    const m = window.__mn,d=m.map.dock;
    m.teleport(d.base.x+d.dir.x*(d.len-10),d.base.z+d.dir.z*(d.len-10));
    const THREE=await import('three'),r=m.client.pred.rafts.find(x=>x.owner===m.client.youServer),c=Math.cos(r.yaw),s=Math.sin(r.yaw),yaw=m.world.rig.yaw;
    const center=new THREE.Vector3(r.x+c*1.5+s*2.5,r.y+.4,r.z-s*1.5+c*2.5);center.x+=Math.cos(yaw)*2.5;center.z-=Math.sin(yaw)*2.5;
    const update=m.world.rig.update.bind(m.world.rig);m.world.rig.blend=null;m.world.rig.dist=m.world.rig.distTarget=19;m.world.rig.snapTo(center);m.world.rig.update=(dt,focus,aim,scale)=>update(dt,center,null,scale);
  });
  await page.waitForFunction(() => !document.querySelector('.commerce-cargo-launcher').hidden, null, { timeout: 15000 });
  if (phone) await page.locator('.commerce-cargo-launcher').click(); else await page.keyboard.press('KeyH');
  await page.waitForFunction(() => { const c = window.__mn.panels.commercePanel; return c.active && c.view === 'cargo' && c.cargoSnapshot; }, null, { timeout: 15000 });
}
async function transfer(side, n, name) {
  const select = page.locator('.commerce-panel [data-cargo-side]'); await select.selectOption(side);
  await page.locator('.commerce-panel [data-good="madera"]').click();
  await page.locator('.commerce-panel [data-amount]').fill(String(n));
  await page.waitForFunction(() => !window.__mn.panels.commercePanel.root.querySelector('.commerce-confirm').disabled, null, { timeout: 10000 });
  const before = await state(); await shot(`${name}-ready`);
  await page.locator('.commerce-panel .commerce-confirm').click(); await settle(before, { raft: true });
  const after = await state(); ensure(after.tradeRev === before.tradeRev + 1 && after.shipRev === before.shipRev + 1, `${name} revisions did not advance exactly once`);
  evidence.actions.push({ name, before, after }); await shot(name); return { before, after };
}

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
    const p = newProfile(); p.gold = 1000; localStorage.setItem(`${GAME.saveKey}.save.solo`, JSON.stringify(p));
  });
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
  console.log('boot ready', {phone,portrait});
  await drawing(); await clickUi('#btn-play');
  await page.waitForFunction(() => window.__mn.st.mode === 'playing' && window.__mn.input.enabled && window.__mn.client.pred.rafts.length === 1, null, { timeout: 90000 });
  console.log('worker joined');
  const boot = await state(); ensure(boot.gold === 1000 && boot.tradeRev === 0 && !Object.keys(boot.pack.goods).length && boot.transport === 'worker' && !boot.online, 'Fresh isolated Worker profile is not the expected fixture');
  await shot('00-fresh-profile');

  await talkTo('merchant');
  await shot('01-market-don-bacalao');
  await trade('madera', 'buy', 3, '02-buy-three-wood');
  await trade('madera', 'sell', 1, '03-sell-one-wood');
  await trade('madera', 'buy', 1, '03b-buy-one-wood');
  await page.locator('.commerce-panel .commerce-close').click();
  if(phone){
    await page.evaluate(()=>window.__mn.client.send({t:'cmd',type:'dev',op:'god',on:true}));
    evidence.fixture+=' Mobile Cala inspection uses local debug god mode to keep combat outside this UI acceptance.';
    await talkTo('calaMerchant');
    ensure(await page.evaluate(()=>window.__mn.panels.commercePanel.town==='cala'&&window.__mn.panels.commercePanel.rows.some(r=>r.illegal)),'Cala merchant must show its own market and contraband');
    await shot('03c-market-la-tuerta');
    await page.locator('.commerce-panel .commerce-close').click();
  }
  const deposit = await openCargo();
  const firstTransfer = await transfer('deposit', 2, '04-deposit-two-wood');
  ensure(firstTransfer.after.hold.goods.madera===2 && firstTransfer.after.hold.cap===6,'Full starter hold witness');
  await page.waitForFunction(()=>{const c=window.__mn.panels.commercePanel,p=window.__mn.client.profile;return c.cargoSnapshot?.raftRev===p.eco.ships[0].rev;});
  ensure(firstTransfer.after.pack.goods.madera===1,'A held unit remains when destination is full');
  const full = await page.locator('.commerce-confirm').isDisabled(); ensure(full,'Full hold must disable another deposit');
  evidence.actions.push({name:'full-hold-deposit-disabled',disabled:full,state:await state()});
  const withdrawal = await transfer('withdraw', 1, '05-withdraw-one-wood');
  ensure(withdrawal.after.pack.goods.madera === 2 && withdrawal.after.hold.goods.madera === 1, 'Expected two wood in pack and one in hold after transfers');
  await shot('06-cargo-summary');
  if(!phone){
    await page.keyboard.press('KeyH');
    await page.evaluate(()=>{window.__mn.loop.running=false;window.__mn.input.clearActions();});
    await page.keyboard.down('KeyG');
    const slots=await page.evaluate(()=>window.__mn.input.consumeSlots({down:{},up:{},held:{}}));
    ensure(slots.down.g&&slots.held.g&&!(await state()).marketActive,'G must remain pearl input next to own raft');
    await page.keyboard.up('KeyG');
    await page.evaluate(()=>{window.__mn.input.clearActions();window.__mn.aimCtl.reset();window.__mn.loop.running=true;});
    evidence.actions.push({name:'G-remains-pearl-near-own-raft',slots});
  }
  evidence.atlas=await page.evaluate(()=>{const a=window.__mn.assets.texture('tex:raft-comic-v1'),im=a?.image||a?.source?.data;return {width:im?.width,height:im?.height};});
  ensure(evidence.atlas.width===(phone?512:1024),'Wrong device atlas');

  // Reload the ordinary saved solo profile and verify the authoritative inventory and both revisions.
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem('mareanegra.v1.save.solo') || 'null');
    return p?.eco?.tradeRev === window.__mn.client.profile.eco.tradeRev && p?.eco?.ships?.[0]?.rev === window.__mn.client.profile.eco.ships[0]?.rev;
  }, null, { timeout: 25000 });
  evidence.savedBeforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('mareanegra.v1.save.solo')));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
  evidence.savedAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('mareanegra.v1.save.solo')));
  ensure(JSON.stringify(evidence.savedAfterReload.eco.pack) === JSON.stringify(evidence.savedBeforeReload.eco.pack)
    && evidence.savedAfterReload.eco.tradeRev === evidence.savedBeforeReload.eco.tradeRev
    && evidence.savedAfterReload.eco.ships[0].rev === evidence.savedBeforeReload.eco.ships[0].rev,
  'Reload changed the locally saved cargo/profile revisions');
  await drawing(); await clickUi('#btn-play');
  await page.waitForFunction(() => window.__mn.st.mode === 'playing' && window.__mn.client.profile?.eco?.tradeRev > 0, null, { timeout: 90000 });
  const restored = await state(); ensure(restored.tradeRev === evidence.savedBeforeReload.eco.tradeRev
    && restored.shipRev === evidence.savedBeforeReload.eco.ships[0].rev, 'Worker rejoin differs from the saved profile');
  evidence.restored = restored; await shot('07-reloaded-save');
  const buy=evidence.actions.find(a=>a.name==='02-buy-three-wood'&&a.before),sell=evidence.actions.find(a=>a.name==='03-sell-one-wood'&&a.before);
  evidence.market = { bought: 4, sold: 1, firstBuyTotal:buy.before.gold-buy.after.gold,soldTotal:sell.after.gold-sell.before.gold,
    finalPackWood: restored.pack.goods.madera || 0, finalHoldWood: restored.hold.goods.madera || 0 };
  evidence.pageErrors = [...new Set(evidence.pageErrors)]; evidence.consoleErrors = [...new Set(evidence.consoleErrors)];
  ensure(evidence.pageErrors.length === 0 && (await state()).errors.length === 0, 'Runtime errors occurred');
  evidence.accepted = true; fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ accepted: true, out, screenshots: evidence.screenshots.length, tradeRev: restored.tradeRev, shipRev: restored.shipRev, pageErrors: evidence.pageErrors }));
} catch (e) {
  evidence.accepted = false; evidence.failure = e.stack;
  if (page) { try { const file = path.join(out, 'failure.png'); await page.screenshot({ path: file }); evidence.screenshots.push({ name: 'failure', path: path.relative(root, file).replaceAll('\\', '/'), ...hash(file) }); } catch {} }
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); throw e;
} finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
