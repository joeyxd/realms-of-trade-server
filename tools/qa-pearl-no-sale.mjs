// Real panel modules in a local browser fixture. No game host, .env, database or external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'shots/review/m5-pearl-no-sale');
const { chromium } = await import(pathToFileURL(path.resolve(root,
  process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const libraries = {
  '/libs/gsap/': path.join(root, '.scratch/gsap-local/package'),
  '/libs/three/': path.join(root, 'node_modules/three'),
};
const html = `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/hud.css">
<link rel="stylesheet" href="/styles/panels.css">
<style>body{margin:0;background:#17333a;font-family:system-ui} [hidden]{display:none!important}</style>
<script type="importmap">{"imports":{"gsap":"/libs/gsap/index.js","three":"/libs/three/build/three.module.js","three/addons/":"/libs/three/examples/jsm/"}}</script>
<div id="stage"><div id="ui"><div id="charpanel" hidden></div></div></div>
<script type="module">
import { CharPanel } from '/src/ui/charpanel.js';
import { Rewards } from '/src/ui/rewards.js';
import { newProfile } from '/src/sim/systems/inventory.js';
import { stage } from '/src/ui/stage.js';
stage.update();
const p = newProfile(); p.pearls.bag = [{uid:'found:brasa',kind:'brasa'}];
const commands = [], toasts = [], floats = [];
const panel = new CharPanel(document.querySelector('#charpanel'), {
  send: m => commands.push(m), profile: () => p, nearby: () => [{id:2,name:'Grumete'}],
});
const rewards = new Rewards({hud:{toast: m => toasts.push(m)},
  worldUI:{float: (...v) => floats.push(v)}, ps:{x:0,y:0,z:0}});
panel.open('pearl');
window.qa = {p,panel,commands,toasts,floats,rewards};
window.ready = true;
</script></html>`;

// Serve only fixture modules/styles and the two local library roots, never config or secret files.
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
  if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const prefix = Object.keys(libraries).find(p => pathname.startsWith(p));
  const base = prefix ? libraries[prefix] : root;
  const relative = prefix ? pathname.slice(prefix.length) : pathname.slice(1);
  const file = path.resolve(base, relative);
  if ((!prefix && !/^\/(src|styles)\//.test(pathname)) ||
      !file.startsWith(base + path.sep) || !/\.(js|mjs|css)$/.test(file) || !fs.existsSync(file)) {
    res.writeHead(404); return res.end();
  }
  res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { localOnly: true, fixtureOnly: true, cases: [] };
try {
  fs.mkdirSync(out, { recursive: true });
  for (const spec of [{ name: 'desktop', width: 1280, height: 1000, touch: false },
    { name: 'mobile', width: 390, height: 844, touch: true }]) {
    const context = await browser.newContext({ viewport: spec, hasTouch: spec.touch, isMobile: spec.touch });
    const page = await context.newPage(), errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.ready);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.cp')).opacity) > .99);
    const initial = await page.evaluate(() => {
      const root = document.querySelector('#charpanel'), body = root.querySelector('.cp-body');
      return { actions: [...root.querySelectorAll('[data-pearl-op]')].map(b => b.dataset.pearlOp),
        copy: root.textContent, overflow: body.scrollWidth > body.clientWidth + 1,
        viewportOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.deepEqual(initial.actions, ['swallow', 'leave', 'give']);
    assert.match(initial.copy, /ningún puesto las compra ni las vende/);
    assert.equal(initial.overflow, false); assert.equal(initial.viewportOverflow, false);
    await page.screenshot({ path: path.join(out, `${spec.name}-empty.png`) });
    if (spec.touch) {
      await page.evaluate(() => { const body = document.querySelector('.cp-body'); body.scrollTop = body.scrollHeight; });
      await page.screenshot({ path: path.join(out, 'mobile-empty-footer.png') });
    }
    for (const op of ['swallow', 'leave', 'give']) {
      if (spec.touch) await page.locator(`[data-pearl-op="${op}"]`).tap();
      else await page.locator(`[data-pearl-op="${op}"]`).click();
    }
    const result = await page.evaluate(() => {
      const { panel, p, commands, rewards, toasts, floats } = qa;
      const count = commands.length;
      // A stale/injected sale button also cannot pass the panel's action whitelist.
      const stale = document.createElement('button'); stale.dataset.pearlOp = 'sell'; stale.dataset.pearlUid = 'found:brasa';
      panel.pearlClick(stale);
      const staleBlocked = commands.length === count;
      rewards.handle({type:'pearlDenied',me:1,why:'notForSale'});
      const denial = toasts.at(-1), messageCount = toasts.length;
      rewards.handle({type:'pearlChanged',me:1,op:'sell',gold:600});
      const historicalIgnored = toasts.length === messageCount && floats.length === 0;
      p.pearls.swallowed = {uid:'bound:escarcha',kind:'escarcha'}; panel.refresh();
      const button = panel.root.querySelector('[data-pearl-op="swallow"]'); panel.pearlClick(button);
      return { commands, staleBlocked, denial, historicalIgnored,
        boundBlocked: commands.length === count && button.disabled,
        boundCopy: panel.root.textContent, saleButtons: panel.root.querySelectorAll('[data-pearl-op="sell"]').length };
    });
    assert.deepEqual(result.commands, [{type:'pearl',op:'swallow',uid:'found:brasa'},
      {type:'pearl',op:'leave',uid:'found:brasa'}, {type:'pearl',op:'give',uid:'found:brasa',target:2}]);
    assert.equal(result.staleBlocked, true); assert.equal(result.boundBlocked, true);
    assert.equal(result.historicalIgnored, true); assert.equal(result.saleButtons, 0);
    assert.match(result.denial, /ningún puesto las compra ni las vende/);
    assert.match(result.boundCopy, /Permanece contigo hasta morir/);
    await page.screenshot({ path: path.join(out, `${spec.name}-bound.png`) });
    if (spec.touch) {
      await page.evaluate(() => { const body = document.querySelector('.cp-body'); body.scrollTop = body.scrollHeight; });
      await page.screenshot({ path: path.join(out, 'mobile-bound-footer.png') });
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    evidence.cases.push({ ...spec, ...initial, ...result, runtimeErrors: errors,
      screenshots: [`${spec.name}-empty.png`, `${spec.name}-bound.png`,
        ...(spec.touch ? ['mobile-empty-footer.png', 'mobile-bound-footer.png'] : [])] });
    await context.close();
  }
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ cases: evidence.cases.length, screenshots: 6, runtimeErrors: 0, out }));
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
