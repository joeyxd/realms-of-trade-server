#!/usr/bin/env node
// Headless local fixture for account/storage rejection copy in resource UI components.
import fs from 'node:fs';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const out = resolve('docs/delivery/m5-resource-authority/ui');
await mkdir(out, { recursive: true });
const playwrightPath = process.env.MN_PLAYWRIGHT
  || 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles/hud.css"><link rel="stylesheet" href="/styles/workbench.css"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#223b3c;color:#f7e8c7;font:14px system-ui}
#stage{position:relative;width:100vw;height:100vh;container-type:size;background:radial-gradient(ellipse at 70% 22%,#698879,#335855 45%,#1b3337 78%)}
#stage:before{content:"";position:absolute;inset:55% 0 0;background:linear-gradient(165deg,#817454,#4e5844 60%,#343e34);clip-path:polygon(0 28%,27% 0,60% 18%,100% 0,100% 100%,0 100%)}
#ui{position:absolute;inset:0;container-type:size;pointer-events:none}#ui>*{pointer-events:auto}
#toasts{position:absolute;z-index:60;left:12px;top:18px;width:min(300px,calc(100cqw - 24px));display:grid;gap:8px}
.toast{padding:9px 12px;border:1px solid #b48b50;border-radius:8px;background:#211e1bec;color:#f7e8c7;font-weight:800;font-size:13px;line-height:1.35;box-shadow:0 8px 24px #0008;overflow-wrap:anywhere}
.toast b{color:#f0ce7e}
.bench-scene{position:absolute;left:50%;bottom:18%;width:138px;height:26px;transform:translateX(-50%);border:5px solid #51371f;background:#89643b;box-shadow:0 7px 0 #30291e}
</style></head><body><main id="stage"><div class="bench-scene"></div><div id="ui"><div id="toasts" aria-live="polite"></div></div></main><script type="module">
import { ResourceActions } from '/src/ui/resourceActions.js';
import { WorkbenchPanel } from '/src/ui/workbench.js';
const params = new URLSearchParams(location.search), locale = params.get('locale') || 'es', reason = params.get('reason') || 'account_required';
document.documentElement.lang = locale;
const profile = { pirateId:'account:fixture', tools:{axe:0,pickaxe:0}, eco:{tradeRev:4,pack:{cap:100,goods:{tronco:3,piedra:1}}} };
const client = { joined:true, t:{closed:false}, youServer:1, profile,
  resources:{bench:{x:0,y:0,z:0},nodes:[{id:'fixture-wood',kind:'wood',x:1,y:0,z:0,ready:true,rev:0}]}, sent:[],
  send(command){this.sent.push(structuredClone(command));} };
const toast = html => { const node=document.createElement('div'); node.className='toast'; node.innerHTML=html; document.querySelector('#toasts').replaceChildren(node); };
const resources = new ResourceActions({client:()=>client,player:()=>({x:0,y:0,z:0}),enabled:()=>true,locale:()=>locale,toast});
const panel = new WorkbenchPanel({parent:document.querySelector('#ui'),profile:()=>profile,player:()=>({x:0,y:0,z:0}),
  bench:()=>client.resources.bench,enabled:()=>true,blocked:()=>false,submit:command=>{client.sent.push(structuredClone(command));return true;}});
resources.send({t:'cmd',type:'resource',op:'gather',opId:'fixture-gather',node:'fixture-wood',expectedRev:0});
const gatherEvent={type:'resource',op:'gather',opId:'fixture-gather',ok:false,why:reason};
resources.onResult(gatherEvent); panel.onResult(gatherEvent);
if (!panel.open()) throw new Error('fixture could not open the real workbench component');
if (!panel.confirm()) throw new Error('fixture could not create a real workbench command');
const craftCommand=client.sent.at(-1);
const craftEvent={type:'resource',op:'craft',opId:craftCommand.opId,ok:false,why:reason};
resources.onResult(craftEvent); panel.onResult(craftEvent);
window.qa={locale,reason,profile,client,resources,panel};
</script></body></html>`;

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/fixture') { res.writeHead(200, { 'content-type': types['.html'] }); res.end(fixture); return; }
  const target = resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!target.startsWith(root + sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': types[extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const report = { schema:'mn.m5-resource-ui.v1', fixture:'local components and fake profile; no host or external service',
  viewportSizes:{desktop:{width:1280,height:720},compact:{width:390,height:844}},screenshots:[],checks:[] };
const expected = {
  es:{account_required:{resource:'Inicia sesión para recoger o fabricar en este servidor.',workbench:'Inicia sesión para fabricar en este servidor.'},
    storage:{resource:'El servidor no pudo confirmar el guardado. Vuelve a conectar.',workbench:'El servidor no pudo confirmar el guardado. Vuelve a conectar.'}},
  en:{account_required:{resource:'Sign in to gather or craft on this server.',workbench:'Sign in to craft on this server.'},
    storage:{resource:'The server could not confirm the save. Reconnect to continue.',workbench:'The server could not confirm the save. Reconnect to continue.'}},
};
try {
  browser = await chromium.launch({headless:true,
    ...(process.env.MN_BROWSER ? {executablePath:process.env.MN_BROWSER} : {channel:'chrome'})});
  for (const [viewportName, viewport] of Object.entries(report.viewportSizes)) {
    for (const locale of ['es','en']) for (const reason of ['account_required','storage']) {
      const page = await browser.newPage({viewport});
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.goto(`http://127.0.0.1:${server.address().port}/fixture?locale=${locale}&reason=${reason}`, {waitUntil:'load'});
      await page.waitForFunction(() => window.qa?.panel && window.qa.panel.$('[data-feedback]')?.textContent);
      const check = await page.evaluate(() => {
        const toast=document.querySelector('#toasts .toast'),panel=document.querySelector('.workbench-panel');
        const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const t=box(toast),p=box(panel),feedback=box(panel.querySelector('[data-feedback]'));
        return {locale:window.qa.locale,reason:window.qa.reason,resourceMessage:toast.innerText.trim(),
          workbenchMessage:panel.querySelector('[data-feedback]').textContent.trim(),toast:t,panel:p,feedback,
          fitsViewport:t.left>=0&&t.top>=0&&t.right<=innerWidth+1&&t.bottom<=innerHeight+1
            &&p.left>=0&&p.top>=0&&p.right<=innerWidth+1&&p.bottom<=innerHeight+1,
          pageOverflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,
          panelContentOverflow:panel.scrollWidth>panel.clientWidth,
          feedbackOverflow:panel.querySelector('[data-feedback]').scrollWidth>panel.querySelector('[data-feedback]').clientWidth};
      });
      const target=expected[locale][reason];
      if (check.resourceMessage!==target.resource||check.workbenchMessage!==target.workbench) throw new Error(`${viewportName}/${locale}/${reason}: unexpected message copy`);
      if (!check.fitsViewport||check.pageOverflow||check.panelContentOverflow||check.feedbackOverflow) throw new Error(`${viewportName}/${locale}/${reason}: UI overflow ${JSON.stringify(check)}`);
      if (pageErrors.length) throw new Error(`${viewportName}/${locale}/${reason}: browser page errors`);
      const name=`${viewportName}-${locale}-${reason}`;
      const screenshot=resolve(out,`${name}.png`);
      await page.screenshot({path:screenshot,fullPage:true});
      report.screenshots.push(screenshot);
      report.checks.push({name,...check,pageErrors:pageErrors.length});
      await page.close();
    }
  }
  await writeFile(resolve(out,'evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  if (browser) await browser.close();
  await new Promise(done=>server.close(done));
}
