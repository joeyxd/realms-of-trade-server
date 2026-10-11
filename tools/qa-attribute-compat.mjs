// Local UI compatibility fixture for adopted Carga profiles. It does not call a game host.
import http from 'node:http';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const runId = new Date().toISOString().replace(/[:.]/g, '-') + `-${process.pid}`;
const out = resolve(root, 'docs/delivery/inv02b-ui', runId);
if (fs.existsSync(out)) throw new Error(`Evidence directory already exists: ${out}`);
await mkdir(out, { recursive: true });
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightFile).href);

const fixture = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/panels.css"><link rel="stylesheet" href="/styles/workshop.css">
<style>
html,body{margin:0;min-height:100%;background:linear-gradient(130deg,#294b50,#193a47);font-family:system-ui;color:#f5f1df}
#ui>*{pointer-events:auto}.proof-pack{position:fixed;z-index:10;right:12px;top:12px;width:min(330px,calc(100vw - 24px))}
*{transition:none!important;animation:none!important}
@media(max-width:900px){.proof-pack{left:8px;right:8px;top:8px;width:auto}}
@media(max-width:430px) and (min-height:481px){.proof-pack{left:auto;right:8px;top:8px;width:330px;zoom:.62}}
@media(max-height:480px) and (orientation:landscape){.proof-pack{left:auto;right:8px;top:8px;width:190px}}
</style>
<div id="ui"></div><aside class="proof-pack"></aside><script type="module">
import { newProfile } from '/src/sim/systems/inventory.js';
import { WorkshopPanel } from '/src/ui/workshop.js';
import { packInventoryHtml } from '/src/ui/packInventory.js';
import { setLocale } from '/src/core/i18n.js';
const profile=newProfile(); profile.lvl=3; profile.attr={v:1,carga:2,re:0}; profile.eco.pack.maxMass=60;
profile.eco.pack.goods={madera:2,lona:3};
const requests=[]; const parent=document.querySelector('#ui');
const panel=new WorkshopPanel({parent,profile:()=>profile,context:()=>({profile}),enabled:()=>true,
  submit:command=>{requests.push(command);return true},getLocale:()=>document.documentElement.lang});
const pack=document.querySelector('.proof-pack');
window.qa={profile,panel,requests,pack,async show(lang){document.documentElement.lang=lang;setLocale(lang);pack.innerHTML=packInventoryHtml(profile,{},lang);panel.open();panel.render();},
  confirmFlow(){
    const before=profile.eco.tradeRev, button=panel.$('[data-upgrade]'), inputEnabled=!button.disabled;
    button.click(); const started=requests.length>0 && !!panel.pending;
    const pendingBeforeAck=!!panel.pending && panel.pending.command.expectedRev===before;
    const p=panel.pending, command=p?.command;
    const ack=command&&panel.onResult({type:'artisan',op:command.op,opId:command.opId,ok:true,why:'',rev:before+1,
      workshop:p.expectedWorkshop,carry:p.expectedCarry});
    const heldAfterAck=!!panel.pending && panel.confirmProfile()===false;
    profile.carry={v:1,backpack:1}; profile.eco.pack.cap=30; profile.eco.pack.maxMass=60;
    delete profile.eco.pack.goods.madera; delete profile.eco.pack.goods.lona; profile.eco.tradeRev=before+1;
    const clearedAfterProfile=panel.confirmProfile()===true && panel.pending===null;
    pack.innerHTML=packInventoryHtml(profile,{},document.documentElement.lang);
    return {started,inputEnabled,pendingBeforeAck,ackAccepted:ack,heldAfterAck,clearedAfterProfile,
      expectedCarry:p?.expectedCarry??null,confirmedCarry:{v:1,backpack:1,volume:30,strength:12,maxMass:60},confirmedPackText:pack.innerText.replace(/\\s+/g,' ').trim()};
  }};
</script></html>`;

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/fixture') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(fixture); return; }
  const file = resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(root + sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { scope: 'Local presentation fixture using actual WorkshopPanel and packInventoryHtml with lvl3, attr carga2, maxMass60. Workshop layout uses repository CSS without overrides; proof-pack positioning/scale is fixture-specific to avoid covering the centered workshop. No authenticated host or durable operation.', runId, checks: [] };
try {
  const devices = { desktop: { width: 1280, height: 800 }, portrait: { width: 390, height: 844 }, landscape: { width: 844, height: 390 } };
  for (const [device, viewport] of Object.entries(devices)) for (const locale of ['es', 'en']) {
    const page = await browser.newPage({ viewport, isMobile: device !== 'desktop', hasTouch: device !== 'desktop' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.qa?.panel);
    await page.evaluate(lang => window.qa.show(lang), locale);
    const view = await page.evaluate(() => {
      const panel = document.querySelector('.workshop-panel'), pack = document.querySelector('.pack-inventory');
      const bounds = element => { const r = element.getBoundingClientRect(); return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
      return { workshopText: panel.innerText.replace(/\\s+/g,' ').trim(), packText: pack.innerText.replace(/\\s+/g,' ').trim(),
        workshop: bounds(panel), pack: bounds(pack), viewport: { width:innerWidth,height:innerHeight },
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        workshopWithinViewport: (()=>{const r=panel.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})(),
        workshopScroll: { clientHeight:panel.clientHeight,scrollHeight:panel.scrollHeight,overflowY:getComputedStyle(panel).overflowY },
        visible: !panel.hidden && getComputedStyle(pack).display !== 'none' };
    });
    if (!view.visible || !view.noHorizontalOverflow || !view.workshopWithinViewport || errors.length) throw new Error(`${device}/${locale} layout failed: ${JSON.stringify({ view, errors })}`);
    if (!view.workshopText.includes('60') || !view.packText.includes('60') || !view.packText.includes(locale === 'en' ? 'Backpack 1 / 3' : 'Mochila 1 / 3')) {
      throw new Error(`${device}/${locale} adopted capacity was not visible: ${JSON.stringify(view)}`);
    }
    const expectedHeading = locale === 'en' ? 'Salty Shore Workshop' : 'Taller de Salty Shore';
    if (!view.workshopText.includes(expectedHeading)) throw new Error(`${device}/${locale} missing localized workshop heading`);
    const flow = await page.evaluate(() => window.qa.confirmFlow());
    if (!flow.started || !flow.inputEnabled || !flow.pendingBeforeAck || !flow.ackAccepted || !flow.heldAfterAck || !flow.clearedAfterProfile ||
        flow.expectedCarry?.volume !== 30 || flow.expectedCarry?.maxMass !== 60) {
      throw new Error(`${device}/${locale} confirmation compatibility failed: ${JSON.stringify(flow)}`);
    }
    if (!flow.confirmedPackText.includes(locale === 'en' ? 'Backpack 2 / 3' : 'Mochila 2 / 3') ||
        !flow.confirmedPackText.includes('0 / 30 uV') || !flow.confirmedPackText.includes('0 / 60 uM')) {
      throw new Error(`${device}/${locale} pack rendering does not match confirmed profile: ${JSON.stringify(flow)}`);
    }
    const screenshot = `${device}-${locale}.png`;
    await page.screenshot({ path: resolve(out, screenshot), fullPage: true });
    report.checks.push({ device, locale, viewport, ...view, flow, pageErrors: errors, screenshot });
    await page.close();
  }
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(out, 'README.md'), `# INV02b attribute compatibility UI evidence\n\nGenerated by \`node tools/qa-attribute-compat.mjs\`. The six screenshots use the real WorkshopPanel and packInventoryHtml with an adopted level 3 profile (Carga 2, maxMass 60). Each local flow clicks the enabled upgrade control, checks expected carry volume 30/maxMass 60, and verifies that an ACK leaves the workshop pending until the matching confirmed level 2 backpack profile arrives. Screenshots and \`confirmedPackText\` are captured after confirmation: the pack must show backpack 2 / 3, 0 / 30 uV, and 0 / 60 uM.\n\nThe workshop uses repository CSS without layout or scale overrides. Its bounded scroll container is measured in evidence. The separate proof-pack fixture has artificial positioning in compact viewports, including reduced scale in portrait, to keep it from covering the centered workshop.\n\nThis is local presentation and client state evidence only. It does not exercise an authenticated host, SQL receipt, durable persistence, deployment, or physical device.\n`);
  console.log(JSON.stringify({ checks: report.checks.length, out }));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
