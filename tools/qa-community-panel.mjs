#!/usr/bin/env node
// Local browser fixture for the community panel; uses fake project/profile data and no game host.
import fs from 'node:fs';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd(), out = resolve('.scratch/community-panel');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT
  || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles/community.css"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:linear-gradient(140deg,#7b9c7a,#36594d 48%,#1d3436);font:14px system-ui}#stage{position:relative;width:100%;height:100%;container-type:size}#ui{position:absolute;inset:0}.shore{position:absolute;inset:auto 0 0;height:28%;background:linear-gradient(#8b805e,#5c6046);clip-path:polygon(0 35%,18% 0,54% 22%,100% 0,100% 100%,0 100%)}.bench{position:absolute;left:50%;bottom:24%;width:138px;height:26px;border:5px solid #51371f;background:#89643b;transform:translateX(-50%);box-shadow:0 7px 0 #30291e}</style></head><body><div id="stage"><div class="shore"></div><div class="bench"></div><div id="ui"></div></div><script type="module">
import { CommunityPanel } from '/src/ui/community.js';
const profile={eco:{pack:{cap:100,goods:{madera:27,piedra:14,tronco:4}}}};
const sent=[]; const panel=new CommunityPanel({parent:document.querySelector('#ui'),profile:()=>profile,context:()=>({profile}),enabled:()=>true,submit:(cmd)=>{sent.push(structuredClone(cmd));return true;}});
window.qa={panel,profile,sent}; panel.open();
const list=sent[0]; panel.onResult({type:'community',op:'list',opId:list.opId,ok:true,rev:2,durable:true,project:{id:'salty-shore-carpentry',name:'Carpintería de Salty Shore',version:2,requirements:{madera:80,piedra:40},contributed:{madera:78,piedra:18}}}); panel.update();
const tick=()=>{panel.update();requestAnimationFrame(tick)};tick();
</script></body></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/fixture') { res.writeHead(200, { 'content-type': types['.html'] }); res.end(fixture); return; }
  const target = resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!target.startsWith(root + sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': types[extname(target)] || 'application/octet-stream' }); fs.createReadStream(target).pipe(res);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port, browser = await chromium.launch({ headless: true,
  ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }) });
const report = { fixture: 'fake project and pack, no host or external service', screenshots: [], checks: [] };
try {
  for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 720 }, compact: { width: 390, height: 844 } })) {
    const page = await browser.newPage({ viewport }); const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/fixture`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.qa?.panel?.project?.version === 2);
    const view = await page.evaluate(() => {
      const panel = document.querySelector('.community-panel').getBoundingClientRect();
      const controls = ['[data-close]', '[data-good]', '[data-qty]', '[data-contribute]'].map((s) => document.querySelector(s).getBoundingClientRect());
      return { title: document.querySelector('[data-project-name]').textContent, rows: [...document.querySelectorAll('.community-row')].length,
        bounds: panel.left >= 0 && panel.top >= 0 && panel.right <= innerWidth + 1 && panel.bottom <= innerHeight + 1,
        controls: controls.every((r) => r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1),
        inventory: document.querySelector('[data-owned]').textContent };
    });
    if (!view.bounds || !view.controls || view.rows !== 2 || view.title !== 'Carpintería de Salty Shore') throw new Error(`${name}: invalid panel view ${JSON.stringify(view)}`);
    const file = resolve(out, `${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file);
    await page.locator('[data-good]').selectOption('madera'); await page.locator('[data-qty]').fill('28');
    if (!(await page.locator('[data-contribute]').isDisabled())) throw new Error(`${name}: contribution above owned stock was allowed`);
    await page.locator('[data-qty]').fill('7');
    if (await page.locator('[data-contribute]').isDisabled()) throw new Error(`${name}: requested amount above remaining work was rejected before the server could clamp it`);
    await page.locator('[data-contribute]').click();
    await page.locator('[data-retry]').waitFor({ state: 'visible', timeout: 8000 }); await page.locator('[data-retry]').click();
    const receipt = await page.evaluate(() => { const q=window.qa; const cmd=q.sent[1]; const before=q.profile.eco.pack.goods.madera;
      const exactRetry=JSON.stringify(cmd)===JSON.stringify(q.sent[2]);
      q.panel.onResult({type:'community',op:'contribute',opId:cmd.opId,ok:true,accepted:2,good:'madera',durable:true,project:{id:'salty-shore-carpentry',name:'Carpintería de Salty Shore',version:3,requirements:{madera:80,piedra:40},contributed:{madera:80,piedra:18},complete:false}});
      return { sent:cmd, exactRetry, profileWood:q.profile.eco.pack.goods.madera, pending:!!q.panel.pending, status:q.panel.$('[data-status]').textContent, before }; });
    if (receipt.sent.expectedRev !== 2 || receipt.sent.amount !== 7 || !receipt.exactRetry || receipt.pending || receipt.profileWood !== receipt.before || !receipt.status.includes('2 Madera')) throw new Error(`${name}: command, exact retry, clamped acknowledgement, or profile authority mismatch`);
    if (errors.length) throw new Error(`${name}: browser errors ${errors.join('; ')}`);
    report.checks.push({ name, view, command: receipt.sent, exactRetry: receipt.exactRetry, profileUnchanged: true, status: receipt.status });
    await page.close();
  }
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
