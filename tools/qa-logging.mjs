// Actual character panel, local profile fixtures; no host, accounts, or external services.
import http from 'node:http';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(), out = resolve('docs/delivery/prg01b2-logging/ui');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT
  || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const fixture = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/hud.css"><link rel="stylesheet" href="/styles/panels.css">
<style>body{margin:0;background:linear-gradient(130deg,#294b50,#193a47);font-family:system-ui}#stage{width:100vw;height:100vh}#charpanel{padding:16px}</style>
<script type="importmap">{"imports":{"gsap":"/qa-gsap.js","three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<div id="stage"><div id="charpanel"></div></div><script type="module">
import { CharPanel } from '/src/ui/charpanel.js';
import { newProfile } from '/src/sim/systems/inventory.js';
let locale='es'; const profile=newProfile();
const panel=new CharPanel(document.querySelector('#charpanel'),{send(){},profile:()=>profile,stats:()=>({}),locale:()=>locale});
window.qa={panel,profile,set(lang,practice){locale=lang;document.documentElement.lang=lang;profile.progression={v:2,practice:{logging:practice},milestones:practice>=60?['pilot_coastal','logging_steady']:['pilot_coastal'],knowledge:[]};panel.open('logging');}};
window.qa.set('es',30);
</script></html>`;
const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/fixture') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(fixture); return; }
  if (path === '/qa-gsap.js') { res.setHeader('content-type', 'text/javascript'); res.end('export const gsap={fromTo(){}};'); return; }
  const file = resolve(root, '.' + decodeURIComponent(path));
  if (!file.startsWith(root + sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', ({ '.js':'text/javascript', '.css':'text/css' })[extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { scope:'actual CharPanel with local profiles, GSAP animation stub; no host or physical phone', checks:[] };
try {
  for (const [device, viewport] of Object.entries({desktop:{width:1280,height:720},compact:{width:390,height:844}})) {
    const page = await browser.newPage({ viewport, isMobile:device==='compact', hasTouch:device==='compact' });
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    await page.waitForFunction(()=>window.qa?.panel);
    for (const locale of ['es','en']) for (const practice of [30,60]) {
      await page.evaluate(({locale,practice})=>window.qa.set(locale,practice), {locale,practice});
      await page.getByRole('button',{name:locale==='en'?'Trades':'Oficios',exact:true}).click();
      const check = await page.evaluate(()=>{
        const panel=document.querySelector('.cp'), card=document.querySelector('.cp-logging'), rect=panel.getBoundingClientRect();
        return {text:card.textContent.replace(/\s+/g,' ').trim(), fits:rect.left>=0&&rect.top>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1,
          noOverflow:card.scrollWidth<=card.clientWidth+1, practice:document.querySelector('.cp-logging .st-row').textContent};
      });
      if(!check.fits||!check.noOverflow||!check.practice.includes(String(practice))||errors.length) throw new Error(JSON.stringify({device,locale,practice,check,errors}));
      const name=`${device}-${locale}-${practice}.png`; await page.screenshot({path:resolve(out,name)});
      report.checks.push({device,locale,practice,...check,screenshot:name});
    }
    await page.close();
  }
  await writeFile(resolve(out,'evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checks:report.checks.length,out}));
} finally {await browser.close(); await new Promise(done=>server.close(done));}
