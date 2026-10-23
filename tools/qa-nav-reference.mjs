#!/usr/bin/env node
// D08c.6 visual and real-pointer acceptance for the live navigation reference controls.
// Uses a fresh loopback memory host per viewport; it never reads project .env or external storage.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';

const out = resolve('docs/delivery/d08c6-live-coastal-loop');
await mkdir(out, { recursive: true });
const playwrightUrl = process.env.MN_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href
  : pathToFileURL(resolve('.scratch/pilot-browser/node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwrightUrl);
const lifecycleOnly = process.env.MN_NAV_LIFECYCLE_ONLY === '1';
const compactOnly = process.env.MN_NAV_COMPACT_UI_ONLY === '1';
const arcOnly = process.env.MN_NAV_ARC_UI_ONLY === '1';
const evidence = {
  generatedAt: new Date().toISOString(),
  harness: 'ephemeral GameHost + memory store; local Three.js/GSAP routes; Chrome SwiftShader',
  performanceClaim: false,
  viewports: [],
  failures: [],
};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function bounds(element) {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
}
function overlaps(a, b) {
  return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
}
function pointFor(bounds, fx = .5, fy = .5) {
  return { x: bounds.x + bounds.width * fx, y: bounds.y + bounds.height * fy };
}
function touchPoint(point, id) { return { x: point.x, y: point.y, id, radiusX: 4, radiusY: 4, force: 1 }; }

async function readMobileHud(page) {
  return page.evaluate(() => {
    const root = window.__mn.navigation.root, bag = document.querySelector('#hud-bag');
    const hull = document.querySelector('.hud-player .bars .ln-touch-hull');
    const ornament = (selector) => { const el = root.querySelector(selector), style = getComputedStyle(el), r = el.getBoundingClientRect();
      return { display: style.display, visibility: style.visibility, width: r.width, height: r.height }; };
    const r = bag.getBoundingClientRect();
    return { aboard: root.classList.contains('is-aboard'), bodyTouchClass: document.body.classList.contains('is-naval-touch'),
      touchEnabled: window.__mn.navigation.touch.diagnostics().enabled,
      objective: ornament('.ln-touch-objective'), compass: ornament('.ln-touch-compass'),
      hull: hull ? { display: getComputedStyle(hull).display, width: hull.getBoundingClientRect().width,
        height: hull.getBoundingClientRect().height } : null,
      bag: { visible: getComputedStyle(bag).display !== 'none' && getComputedStyle(bag).visibility !== 'hidden' && r.width > 0 && r.height > 0,
        disabled: bag.disabled, width: r.width, height: r.height } };
  });
}

const browser = await chromium.launch({
  ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function installLocalRoutes(page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    if (!match) return route.abort();
    const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    if (!fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript',
      headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
}

async function putOwnerAtHelm(host, entity) {
  const server = host.game.server, world = server.world, raft = publicRafts(world).find((record) => record.owner === entity);
  check(raft?.helm, `fresh memory profile has no helm anchor for entity ${entity}`);
  const point = pilotPoint(raft, raft.helm), ecs = world.ecs;
  ecs.x[entity] = point.x; ecs.y[entity] = point.y; ecs.z[entity] = point.z; ecs.facing[entity] = point.f;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
  world.raftDeck.update(publicRafts(world));
  server.broadcastSnapshot();
  return { shipId: raft.id, helm: raft.helm, point };
}

async function runViewport(spec) {
  const result = { name: spec.name, width: spec.width, height: spec.height, touch: spec.touch,
    screenshots: [], status: 'running', errors: [], consoleErrors: [] };
  evidence.viewports.push(result);
  const host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 2, dev: true,
    store: createMemoryStore(), worldId: null, saveSecret: `isolated-navigation-reference-${spec.name}`, log() {} });
  let context;
  try {
    const port = await host.listen();
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: 1, hasTouch: spec.touch, isMobile: spec.touch });
    const page = await context.newPage();
    page.on('pageerror', (error) => result.errors.push(String(error?.stack || error)));
    page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
    await installLocalRoutes(page);
    await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 60000 });
    await page.waitForFunction(() => window.__mn?.input?.enabled && !window.__mn?.st?.paused, null, { timeout: 30000 });
    const entity = await page.evaluate(() => window.__mn.client.youServer);
    result.player = await putOwnerAtHelm(host, entity);
    await page.waitForFunction(({ x, z }) => {
      const m = window.__mn, p = m?.client?.cur;
      return p && Math.hypot(p.x - x, p.z - z) < .7 && m.navigation.interaction()?.prompt?.includes('iniciar travesía');
    }, result.player.point, { timeout: 20000 });
    if ((lifecycleOnly || compactOnly || arcOnly) && spec.touch) {
      result.lifecycle = { beforeBoard: await readMobileHud(page) };
      const beforeShot = resolve(out, `${spec.name}-lifecycle-before-board.png`);
      await page.screenshot({ path: beforeShot, fullPage: true }); result.screenshots.push(beforeShot);
      const pre = result.lifecycle.beforeBoard;
      check(!pre.aboard && pre.objective.display === 'none' && pre.compass.display === 'none',
        `mobile voyage ornaments are visible before boarding: ${JSON.stringify(pre)}`);
      check(!pre.hull || pre.hull.display === 'none' || !pre.hull.width || !pre.hull.height,
        `naval hull meter is visible before boarding: ${JSON.stringify(pre.hull)}`);
      check(pre.bag.visible && !pre.bag.disabled, `ordinary bag HUD is unavailable before boarding: ${JSON.stringify(pre.bag)}`);
    }
    if (spec.touch) await page.locator('.ln-prompt [data-run]').click();
    else await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.__mn?.client?.naval?.active && window.__mn?.client?.voyage?.active, null, { timeout: 20000 });
      if (spec.touch) await page.waitForFunction(() => window.__mn?.navigation?.touch?.diagnostics?.().enabled, null, { timeout: 10000 });

    const visual = await page.evaluate(() => {
      const m = window.__mn, touch = m.navigation.touch, slotContainer = document.querySelector('.naval-touch-slots');
      const meter = m.navigation.root.querySelector('.ln-dial');
      const navRoot = m.navigation.root, wind = navRoot.querySelector('.ln-touch-wind');
      const windValue = wind?.querySelector('[data-touch-wind]'), gustMeter = wind?.querySelector('.ln-gust-track[role="meter"]');
      const windStyle = wind && getComputedStyle(wind), windColor = windStyle?.backgroundColor || 'transparent';
      const colorParts = windColor.match(/rgba?\(([^)]+)\)/)?.[1]?.split(/[\s,/]+/).filter(Boolean) || [];
      const windAlpha = windColor === 'transparent' ? 0 : colorParts.length >= 4 ? Number(colorParts[3]) : 1;
      const windBounds = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const hull = document.querySelector('.hud-player .bars .ln-touch-hull');
      const hullMeter = hull?.querySelector('.ln-touch-hull-meter[role="meter"]');
      const hullFill = hull?.querySelector('[data-touch-hull]');
      const raft = m.client.renderRafts(1).find((r) => String(r.id) === String(m.client.naval.shipId));
      const view = raft && m.world.rafts.views.get(String(raft.id));
      return {
        layout: touch?.wrapper?.dataset.layout || null,
        touchEnabled: touch?.diagnostics?.().enabled || false,
        slotCount: slotContainer?.querySelectorAll('[data-slot]').length || 0,
        pickerExists: !!document.querySelector('.naval-touch-picker'),
        sticks: [...document.querySelectorAll('.naval-touch-stick')].map((el) => ({ name: el.dataset.stick, ...(() => {
          const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        })() })),
        slots: [...document.querySelectorAll('.naval-touch-slot')].map((el) => ({ slot: el.dataset.slot, disabled: el.disabled, ...(() => {
          const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        })() })),
        arc: (() => {
          const stage = m.navigation.stage, rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
            const points = [[r.left,r.top],[r.right,r.top],[r.right,r.bottom],[r.left,r.bottom]].map(([x,y]) => stage.toLocal(x,y));
            return { x: Math.min(...points.map(p=>p.x)), y: Math.min(...points.map(p=>p.y)),
              right: Math.max(...points.map(p=>p.x)), bottom: Math.max(...points.map(p=>p.y)) }; };
          const gauge = touch?.instrument?.querySelector('.naval-touch-gauge');
          const gc = rectOf(gauge), gaugeCenter = gc && { x:(gc.x+gc.right)/2, y:(gc.y+gc.bottom)/2 };
          const slots = [...document.querySelectorAll('.naval-touch-slot')].map((el) => { const r=rectOf(el), center={x:(r.x+r.right)/2,y:(r.y+r.bottom)/2};
            const dx=center.x-gaugeCenter.x, dy=center.y-gaugeCenter.y;
            return { slot:Number(el.dataset.slot), x:r.x,y:r.y,right:r.right,bottom:r.bottom,cx:center.x,cy:center.y,
              radius:Math.hypot(dx,dy), angle:(Math.atan2(dy,dx)*180/Math.PI+360)%360,
              hit: document.elementFromPoint((el.getBoundingClientRect().left+el.getBoundingClientRect().right)/2,
                (el.getBoundingClientRect().top+el.getBoundingClientRect().bottom)/2)?.closest('.naval-touch-slot')?.dataset?.slot === el.dataset.slot };
          });
          const move = touch?.wrapper?.querySelector('.naval-touch-stick-move');
          const look = touch?.wrapper?.querySelector('.naval-touch-stick-look');
          const chat = document.querySelector('.mn-chat-toggle'), prompt = navRoot.querySelector('.ln-prompt');
          const settings = document.querySelector('#hud-settings');
          const wheelLocal=rectOf(move), caption=rectOf(move?.querySelector('.naval-touch-caption'));
          const pseudoRect=(pseudo)=>{if(!move)return null;const s=getComputedStyle(move,pseudo),font=parseFloat(s.fontSize)||0;
            if(s.content==='none'||s.content==='normal'||!font)return null;
            const top=parseFloat(s.top)||0,left=parseFloat(s.left),right=parseFloat(s.right),width=font,height=font*1.3;
            const x=Number.isFinite(left)?wheelLocal.x+left:wheelLocal.right-(Number.isFinite(right)?right:0)-width;
            return {x,y:wheelLocal.y+top,right:x+width,bottom:wheelLocal.y+top+height,content:s.content,fontSize:font};};
          return { gauge: gc, gaugeCenter, slots, move: rectOf(move), look: rectOf(look), chat: rectOf(chat),
            prompt: rectOf(prompt), settings: rectOf(settings), caption,
            tillerArrows:[pseudoRect('::before'),pseudoRect('::after')].filter(Boolean),
            moveBottomCss: move ? getComputedStyle(move).bottom : null,
            stageWidth: stage?.w, stageHeight: stage?.h };
        })(),
        hud: { fireGauge: !!(touch?.instrument?.querySelector('.naval-touch-gauge #nt-speed-fire') || meter?.querySelector('#ln-speed-fire')),
          svg: !!(touch?.instrument?.querySelector('.naval-touch-gauge svg') || meter?.querySelector('svg')),
          speed: meter?.querySelector('[data-speed]')?.textContent || null,
        touchGauge: !!touch?.instrument?.querySelector('.naval-touch-gauge #nt-speed-fire'),
        wheelDecal: !!touch?.wrapper?.querySelector('.naval-touch-stick-move svg path'),
        wheelDecalPaths: touch?.wrapper?.querySelectorAll('.naval-touch-stick-move svg path').length || 0,
          helmMesh: !!view?.helm?.visible, helmWheel: !!view?.helm?.userData?.tiller },
        compact: { stripDisplay: getComputedStyle(navRoot.querySelector('.ln-strip')).display,
          wind: wind && { text: windValue?.textContent?.trim() || '', valueVisible: !!windValue && getComputedStyle(windValue).display !== 'none' &&
            windValue.getBoundingClientRect().width > 0, valueFontSize: windValue ? parseFloat(getComputedStyle(windValue).fontSize) : 0,
            iconVisible: !!wind.querySelector('svg, .ln-touch-wind-icon'), gustText: wind.querySelector('[data-touch-gust-text]')?.textContent?.trim() || '',
            gustValue: Number(gustMeter?.getAttribute('aria-valuenow')), gustMin: Number(gustMeter?.getAttribute('aria-valuemin')),
            gustMax: Number(gustMeter?.getAttribute('aria-valuemax')), marker: !!wind.querySelector('[data-touch-gust-marker]'),
            backgroundColor: windColor, backgroundImage: windStyle?.backgroundImage || 'none', backgroundAlpha: windAlpha,
            rect: windBounds(wind) },
          hull: hull && { insidePlayerBars: !!document.querySelector('.hud-player .bars')?.contains(hull),
            text: hull.querySelector('[data-touch-hull-text]')?.textContent?.trim() || '',
            value: Number(hullMeter?.getAttribute('aria-valuenow')), min: Number(hullMeter?.getAttribute('aria-valuemin')),
            max: Number(hullMeter?.getAttribute('aria-valuemax')), fillWidth: hullFill?.getBoundingClientRect().width || 0,
            rect: windBounds(hull) },
          compass: windBounds(navRoot.querySelector('.ln-touch-compass')),
          objective: windBounds(navRoot.querySelector('.ln-touch-objective')),
          cluster: windBounds(touch?.instrument), wheel: windBounds(touch?.wrapper?.querySelector('.naval-touch-stick-move')) },
        chrome: { clockHidden: (() => { const el = document.querySelector('.world-clock'); if (!el) return true;
            const r = el.getBoundingClientRect(), s = getComputedStyle(el); return s.display === 'none' || s.visibility === 'hidden' || !r.width || !r.height; })(),
          settings: (() => { const el = document.querySelector('#hud-settings'); if (!el) return null;
            const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; })() },
        stage: { width: innerWidth, height: innerHeight, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          rotated: document.body.classList.contains('rotated') },
        controlRect: slotContainer ? (() => { const r = slotContainer.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })() : null,
        headerRect: (() => { const r = m.navigation.root.querySelector('.ln-strip').getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })(),
      };
    });
    result.visual = visual;
    check((spec.touch ? visual.hud.touchGauge : visual.hud.fireGauge) && visual.hud.helmMesh && visual.hud.helmWheel,
      `missing live gauge/helm rendering: ${JSON.stringify(visual.hud)}`);
    if (!spec.touch) {
      check(visual.sticks.length === 0 && visual.slots.length === 0, 'touch controls leaked onto desktop');
    } else {
      check(visual.layout === 'reference', `touch controller not in reference layout: ${visual.layout}`);
      check(visual.slotCount === 3, `expected three binding slots, got ${visual.slotCount}`);
      check(visual.hud.touchGauge && visual.hud.wheelDecalPaths >= 8,
        `missing touch gauge/wheel SVG: ${JSON.stringify(visual.hud)}`);
      check(visual.sticks.length === 2 && visual.slots.length === 3, 'mobile dual sticks or slots are missing');
      check(!visual.stage.documentOverflow, 'mobile page overflows horizontally');
      for (const target of [...visual.sticks, ...visual.slots]) check(target.width >= 44 && target.height >= 44 &&
        target.x >= 0 && target.y >= 0 && target.right <= spec.width + 1 && target.bottom <= spec.height + 1,
        `touch target is too small or clipped: ${JSON.stringify(target)}`);
      check(!overlaps(visual.controlRect, visual.headerRect), `skill selector overlaps navigation header: ${JSON.stringify(visual)}`);
      check(visual.chrome.clockHidden, 'inline world clock remains visible over the naval touch HUD');
      check(visual.chrome.settings && visual.chrome.settings.width >= 44 && visual.chrome.settings.height >= 44 &&
        visual.chrome.settings.x >= 0 && visual.chrome.settings.y >= 0 && visual.chrome.settings.right <= spec.width + 1 &&
        visual.chrome.settings.bottom <= spec.height + 1,
        `settings target is too small or clipped: ${JSON.stringify(visual.chrome.settings)}`);
      if (compactOnly) {
        const compact = visual.compact;
        check(compact.stripDisplay === 'none', `legacy navigation strip remains visible on mobile: ${compact.stripDisplay}`);
        check(compact.wind && compact.wind.valueVisible && /\d/.test(compact.wind.text) && compact.wind.valueFontSize >= 20 &&
          compact.wind.iconVisible, `touch wind number/icon is missing or too small: ${JSON.stringify(compact.wind)}`);
        check(compact.wind.gustText.length > 0 && compact.wind.marker && Number.isFinite(compact.wind.gustValue) &&
          compact.wind.gustValue >= compact.wind.gustMin && compact.wind.gustValue <= compact.wind.gustMax,
          `live gust progress is unavailable: ${JSON.stringify(compact.wind)}`);
        check(compact.wind.backgroundAlpha <= .12 && compact.wind.backgroundImage === 'none',
          `touch wind acquired an opaque backdrop: ${JSON.stringify(compact.wind)}`);
        check(compact.hull && compact.hull.insidePlayerBars && /\d+\s*\/\s*\d+/.test(compact.hull.text) &&
          Number.isFinite(compact.hull.value) && compact.hull.value > 0 && compact.hull.value <= 100 &&
          compact.hull.fillWidth > 0, `compact hull readout is missing or not live: ${JSON.stringify(compact.hull)}`);
        check(compact.cluster && compact.cluster.width < 236 && compact.cluster.height < 222 &&
          compact.wheel && compact.wheel.width < 144 && compact.wheel.height < 144,
          `compact controls did not shrink from baseline 236x222/144: ${JSON.stringify({ cluster: compact.cluster, wheel: compact.wheel })}`);
        const inputs=[...visual.sticks,...visual.slots].map((r)=>({ ...r,cx:(r.x+r.right)/2,cy:(r.y+r.bottom)/2,
          radius:Math.min(r.width,r.height)/2 }));
        for(let i=0;i<inputs.length;i++) for(let j=i+1;j<inputs.length;j++) {
          const a=inputs[i],b=inputs[j];
          check(Math.hypot(a.cx-b.cx,a.cy-b.cy)>=a.radius+b.radius-1.5,
            `mobile circular input targets overlap: ${JSON.stringify({a,b})}`);
        }
        for(const slot of visual.arc.slots) check(slot.hit,`slot center is not hit-testable: ${JSON.stringify(slot)}`);
        for (const decoration of [compact.wind.rect, compact.hull?.rect]) if (decoration)
          for (const target of [...visual.sticks, ...visual.slots]) check(!overlaps(decoration, target),
            `compact reading overlaps a touch input target: ${JSON.stringify({ decoration, target })}`);
        if (compact.hull?.rect && compact.objective)
          check(!overlaps(compact.hull.rect, compact.objective),
            `hull row overlaps the navigation objective: ${JSON.stringify({ hull: compact.hull.rect, objective: compact.objective })}`);
        if (compact.compass && compact.wind.rect) {
          const dx = compact.compass.x + compact.compass.width / 2 - (compact.wind.rect.x + compact.wind.rect.width / 2);
          const dy = compact.compass.y + compact.compass.height / 2 - (compact.wind.rect.y + compact.wind.rect.height / 2);
          check(Math.hypot(dx, dy) <= 200, `wind reading drifted too far from compass: ${JSON.stringify({ compass: compact.compass, wind: compact.wind.rect })}`);
        }
      }
      if (arcOnly) {
        const arc=visual.arc, expectedAngles=[210,245,280], expectedRadius=arc.stageWidth<=700?90:96;
        check(arc.slots.length===3 && arc.gaugeCenter, `radial action arc is missing: ${JSON.stringify(arc)}`);
        for (const slot of arc.slots) {
          const angleError=Math.abs(((slot.angle-expectedAngles[slot.slot]+540)%360)-180);
          check(Math.abs(slot.radius-expectedRadius)<=8 && angleError<=3,
            `skill slot missed radial center/radius: ${JSON.stringify({slot,expectedRadius,angle:expectedAngles[slot.slot]})}`);
          check(slot.hit, `slot center is not hit-testable: ${JSON.stringify(slot)}`);
        }
        for(let i=0;i<arc.slots.length;i++) for(let j=i+1;j<arc.slots.length;j++) {
          const a=arc.slots[i],b=arc.slots[j];
          check(Math.hypot(a.cx-b.cx,a.cy-b.cy)>50, `radial skill circles overlap: ${JSON.stringify({a,b})}`);
        }
        const wheel=arc.move, camera=arc.look;
        check(Number.parseFloat(arc.moveBottomCss)>=14 && Number.parseFloat(arc.moveBottomCss)<=30,
          `helm wheel bottom safe inset is unexpected: ${arc.moveBottomCss}`);
        for(const slot of arc.slots) for(const [name,circle] of [['wheel',wheel],['camera',camera]]) {
          const radius=Math.min(circle.right-circle.x,circle.bottom-circle.y)/2,cx=(circle.x+circle.right)/2,cy=(circle.y+circle.bottom)/2;
          check(Math.hypot(cx-slot.cx,cy-slot.cy)>=radius+25-1, `skill circle overlaps ${name} stick: ${JSON.stringify({slot,circle})}`);
        }
        check(arc.chat && arc.chat.bottom<=wheel.y, `closed chat is not above/non-overlapping helm wheel: ${JSON.stringify({chat:arc.chat,wheel})}`);
        check(!arc.caption||!overlaps(arc.chat,arc.caption),`closed chat overlaps the TIMÓN caption: ${JSON.stringify({chat:arc.chat,caption:arc.caption})}`);
        for(const arrow of arc.tillerArrows) check(!overlaps(arc.chat,arrow),
          `closed chat overlaps a tiller arrow decoration: ${JSON.stringify({chat:arc.chat,arrow})}`);
        for(const slot of arc.slots) for(const [name,rect] of [['settings',arc.settings],['prompt',arc.prompt]]) if(rect && rect.right>rect.x && rect.bottom>rect.y) {
          const dx=Math.max(rect.x-slot.cx,0,slot.cx-rect.right),dy=Math.max(rect.y-slot.cy,0,slot.cy-rect.bottom);
          check(Math.hypot(dx,dy)>=25, `radial skill overlaps ${name}: ${JSON.stringify({slot,rect})}`);
        }
      }
    }
    const initialShot = resolve(out, `${spec.name}-reference.png`);
    await page.screenshot({ path: initialShot, fullPage: true }); result.screenshots.push(initialShot);

    if (arcOnly && spec.touch) await runChatAcceptance(page, result, spec);
    if (spec.touch) await runTouchAcceptance(page, context, result, spec);
    if ((lifecycleOnly || compactOnly || arcOnly) && spec.touch) {
      await page.waitForFunction(() => window.__mn?.client?.voyage?.active && window.__mn.client.voyage.canDock &&
        window.__mn.navigation.keyAction('G')?.verb === 'Amarrar', null, { timeout: 20000 });
      result.lifecycle.dockAction = await page.evaluate(() => window.__mn.navigation.keyAction('G')?.verb || null);
      await page.keyboard.press('KeyG');
      await page.waitForFunction(() => !window.__mn.client.voyage?.active && !window.__mn.client.naval?.active &&
        !document.body.classList.contains('is-naval-touch') && !window.__mn.navigation.touch.diagnostics().enabled,
        null, { timeout: 30000 });
      await page.waitForFunction(() => !window.__mn.navigation.cameraWasNaval);
      await page.waitForTimeout(1200);
      result.lifecycle.afterDock = await readMobileHud(page);
      const afterShot = resolve(out, `${spec.name}-lifecycle-after-dock.png`);
      await page.screenshot({ path: afterShot, fullPage: true }); result.screenshots.push(afterShot);
      const post = result.lifecycle.afterDock;
      check(!post.aboard && !post.bodyTouchClass && !post.touchEnabled && post.objective.display === 'none' &&
        post.compass.display === 'none', `naval touch HUD did not leave with dock: ${JSON.stringify(post)}`);
      check(!post.hull || post.hull.display === 'none' || !post.hull.width || !post.hull.height,
        `naval hull meter stayed visible after dock: ${JSON.stringify(post.hull)}`);
      check(post.bag.visible && !post.bag.disabled, `ordinary bag HUD did not return after dock: ${JSON.stringify(post.bag)}`);
    }
    check(result.errors.length === 0 && result.consoleErrors.length === 0,
      `browser errors: ${JSON.stringify({ page: result.errors, console: result.consoleErrors })}`);
    result.status = 'passed';
    await context.close(); context = null;
  } catch (error) {
    result.status = 'failed'; result.failure = String(error?.stack || error);
    evidence.failures.push(`${spec.name}: ${error?.message || error}`);
    try {
      if (context) {
        const pages = context.pages();
        if (pages[0]) {
          const failureShot = resolve(out, `${spec.name}-failure.png`);
          await pages[0].screenshot({ path: failureShot, fullPage: true }); result.screenshots.push(failureShot);
          result.diagnostics = await pages[0].evaluate(() => {
            const m = window.__mn, n = m?.client?.naval;
            return m ? { errors: [...m.errors], mode: m.st.mode, joined: m.client.joined, you: m.client.youServer,
              paused: m.st.paused, axes: m.navigation.fixedAxes(),
              naval: { active: n?.active, epoch: n?.epoch, ack: n?.ack, pose: n?.body?.pose },
              touch: m.navigation.touch?.diagnostics?.(), bindings: m.navigation.touch?.bindings,
              trace: window.__navReferenceTrace || [], actions: window.__navReferenceActions || [],
              slots: [...document.querySelectorAll('.naval-touch-slot')].map((el) => { const r = el.getBoundingClientRect();
                return { slot: el.dataset.slot, x: r.x, y: r.y, width: r.width, height: r.height,
                  hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.className || null }; }),
              pickerVisible: m.navigation.touch?.picker ? !m.navigation.touch.picker.hidden : null,
              voyage: m.client.voyage } : null;
          }).catch(() => null);
        }
      }
    } catch { /* The browser may have already closed. */ }
    if (context) { await context.close().catch(() => {}); context = null; }
  } finally {
    await host.close();
  }
}

async function runTouchAcceptance(page, context, result, spec) {
  const cdp = await context.newCDPSession(page);
  const dispatch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type,
    touchPoints: points.map(({ point, id }) => touchPoint(point, id)) });
  const getRect = async (selector) => page.locator(selector).evaluate(bounds);
  const pickSlot = async () => page.locator('.naval-touch-slot').first();
  const stageDrag = async (center, rect, localX, localY, fraction = .36) => {
    const amount = rect.width * fraction;
    const rotated = await page.evaluate(() => document.body.classList.contains('rotated'));
    return rotated ? { x: center.x - localY * amount, y: center.y + localX * amount }
      : { x: center.x + localX * amount, y: center.y + localY * amount };
  };
  const slot = await pickSlot();
  const slotBox = await slot.boundingBox();
  check(slotBox, 'first touch binding slot is not visible');
  const slotCenter = pointFor(slotBox);
  const instrumentation = await page.evaluate(() => {
    const n = window.__mn.navigation, touch = n.touch;
    window.__navReferenceActions = [];
    window.__navReferenceTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'click'])
      document.addEventListener(type, (event) => window.__navReferenceTrace.push({ type, pointerId: event.pointerId,
        pointerType: event.pointerType, detail: event.detail, x: event.clientX, y: event.clientY,
        target: event.target?.className || event.target?.dataset?.bindId || event.target?.tagName,
        pickerVisible: touch.picker ? !touch.picker.hidden : false }), true);
    const closePicker = touch.closePicker.bind(touch);
    touch.closePicker = (...args) => { window.__navReferenceTrace.push({ type: 'closePicker', stack: new Error().stack,
      pickerVisible: !touch.picker.hidden, catalogSignature: touch.catalogSignature }); return closePicker(...args); };
    const setActions = touch.setActions.bind(touch);
    touch.setActions = (actions) => { window.__navReferenceTrace.push({ type: 'setActions', count: actions?.length,
      pickerVisible: !touch.picker.hidden, catalogSignature: touch.catalogSignature }); return setActions(actions); };
    const openPicker = touch.openPicker.bind(touch);
    touch.openPicker = (index) => { window.__navReferenceTrace.push({ type: 'openPicker', index,
      catalogSignature: touch.catalogSignature }); return openPicker(index); };
    const ignore = touch.ignoreLongPressCompatibilityClick.bind(touch);
    touch.ignoreLongPressCompatibilityClick = (event) => {
      const recent = touch.recentLongPressRelease && { ...touch.recentLongPressRelease };
      const localPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
        ? touch.toLocal(event.clientX, event.clientY) : null;
      const ignored = ignore(event);
      window.__navReferenceTrace.push({ type: 'ignoreClick', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        localPoint, recent, distance: recent && localPoint ? Math.hypot(localPoint.x - recent.x, localPoint.y - recent.y) : null,
        now: Date.now(), ignored, remaining: touch.recentLongPressRelease && { ...touch.recentLongPressRelease } });
      return ignored;
    };
    const run = n.runAction.bind(n);
    n.runAction = (id) => { window.__navReferenceActions.push(id); return run(id); };
    if (touch.catalog.has('capture')) touch.chooseBinding(0, 'capture');
    return { catalog: [...touch.catalog.keys()], binding: touch.bindings[0], camera: { ...n.sceneCamera.look } };
  });
  result.touchInitial = instrumentation;
  check(instrumentation.catalog.includes('capture') && instrumentation.catalog.includes('center'),
    `reference action catalog lacks capture/center: ${JSON.stringify(instrumentation.catalog)}`);
  check(instrumentation.binding === 'capture', 'test could not bind capture to the long-press slot');

  // A long press opens the picker. Releasing this pointer must never execute its former action.
  await dispatch('touchStart', [{ point: slotCenter, id: 8 }]);
  await pause(720);
  result.pickerOpened = await page.locator('.naval-touch-picker').evaluate((el) => !el.hidden);
  check(result.pickerOpened, '650 ms slot hold did not open the picker');
  const pickerShot = resolve(out, `${spec.name}-picker.png`);
  await page.screenshot({ path: pickerShot, fullPage: true }); result.screenshots.push(pickerShot);
  await dispatch('touchEnd');
  await page.waitForFunction(() => window.__mn.navigation.touch.diagnostics().pointers === 0);
  await pause(100);
  result.actionsAfterLongPressRelease = await page.evaluate(() => [...window.__navReferenceActions]);
  result.longPressTrace = await page.evaluate(() => [...window.__navReferenceTrace]);
  check(result.actionsAfterLongPressRelease.length === 0,
    `long-press release executed an action: ${JSON.stringify(result.actionsAfterLongPressRelease)}`);
  check(await page.locator('.naval-touch-picker').evaluate((el) => !el.hidden), 'picker closed on long-press release');

  const centerOption = page.locator('.naval-touch-picker-option[data-bind-id="center"]');
  check(await centerOption.count() === 1, 'picker does not expose the center action by bind id');
  const centerBox = await centerOption.boundingBox(); check(centerBox, 'center picker option not visible');
  await centerOption.tap({ force: true });
  await page.waitForFunction(() => window.__mn.navigation.touch.bindings[0] === 'center' &&
    window.__mn.navigation.touch.picker.hidden);
  result.bindingAfterPick = await page.evaluate(() => ({ binding: window.__mn.navigation.touch.bindings[0],
    actions: [...window.__navReferenceActions] }));
  check(result.bindingAfterPick.binding === 'center', 'picker did not bind center to the slot');

  // Force a catalog redraw to prove the chosen binding survives component re-render.
  result.bindingAfterRedraw = await page.evaluate(() => {
    const touch = window.__mn.navigation.touch;
    touch.catalogSignature = '';
    touch.setActions([...touch.catalog.values()]);
    return { binding: touch.bindings[0], text: touch.slotButtons[0].label.textContent };
  });
  check(result.bindingAfterRedraw.binding === 'center', 'selected binding did not survive redraw');

  const move = await getRect('.naval-touch-stick-move'), look = await getRect('.naval-touch-stick-look');
  const moveCenter = pointFor(move), moveForward = await stageDrag(moveCenter, move, 0, -1);
  const lookCenter = pointFor(look), lookRight = await stageDrag(lookCenter, look, 1, 0, .34);
  const before = await page.evaluate(() => ({ pose: { ...window.__mn.client.naval.body.pose }, tick: window.__mn.client.naval.body.state.tick,
    camera: { ...window.__mn.navigation.sceneCamera.look }, actions: [...window.__navReferenceActions] }));
  await dispatch('touchStart', [{ point: moveCenter, id: 1 }]);
  await dispatch('touchMove', [{ point: moveForward, id: 1 }]);
  await dispatch('touchStart', [{ point: moveForward, id: 1 }, { point: lookCenter, id: 2 }]);
  await dispatch('touchMove', [{ point: moveForward, id: 1 }, { point: lookRight, id: 2 }]);
  await page.waitForFunction(({ tick }) => {
    const m = window.__mn, nav = m?.client?.naval, camera = m?.navigation?.sceneCamera;
    return nav?.body?.state.tick > tick && nav.body.state.vx ** 2 + nav.body.state.vz ** 2 > .25 &&
      camera?.look?.x > .35;
  }, before, { timeout: 15000 });
  result.simultaneous = await page.evaluate(() => ({ input: window.__mn.navigation.fixedAxes(),
    camera: window.__mn.navigation.sceneCamera.diagnostics(), pose: window.__mn.client.naval.body.pose,
    tick: window.__mn.client.naval.body.state.tick }));
  check(result.simultaneous.input.naval.throttle > .5 && result.simultaneous.camera.look.x > .35,
    `left movement and right camera did not act independently: ${JSON.stringify(result.simultaneous)}`);
  // Cancel both still-active contacts; CDP then resets the touch sequence for later slot taps.
  await dispatch('touchCancel');
  await page.waitForFunction(() => window.__mn.navigation.touch.diagnostics().pointers === 0 &&
    window.__mn.navigation.fixedAxes().naval.throttle === 0 &&
    window.__mn.navigation.sceneCamera.look.x === 0 && window.__mn.navigation.sceneCamera.look.y === 0);
  result.cancelNeutral = await page.evaluate(() => ({ controls: window.__mn.navigation.touch.diagnostics(),
    input: window.__mn.navigation.fixedAxes(), cameraLook: { ...window.__mn.navigation.sceneCamera.look } }));

  // Verify the bound center action is live after redraw by first setting a camera look, then tapping slot 0.
  await page.evaluate(() => window.__mn.navigation.sceneCamera.setLook({ x: .72, y: .25 }));
  const reboundBox = await page.locator('.naval-touch-slot[data-slot="0"]').boundingBox();
  await page.locator('.naval-touch-slot[data-slot="0"]').tap({ force: true });
  result.centerActivation = await page.evaluate(() => ({ look: { ...window.__mn.navigation.sceneCamera.look },
    actions: [...window.__navReferenceActions] }));
  check(result.centerActivation.actions.at(-1) === 'center' && result.centerActivation.look.x === 0 && result.centerActivation.look.y === 0,
    `center binding did not invoke the real camera action: ${JSON.stringify(result.centerActivation)}`);

  const moveBox = await page.locator('.naval-touch-stick-move').boundingBox();
  const movePoint = pointFor(moveBox), moveHeld = await stageDrag(movePoint, moveBox, 0, -1, .34);
  await dispatch('touchStart', [{ point: movePoint, id: 11 }]); await dispatch('touchMove', [{ point: moveHeld, id: 11 }]);
  await page.waitForFunction(() => window.__mn.navigation.fixedAxes().naval.throttle > .5);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__mn.input.enabled);
  await page.waitForFunction(() => !window.__mn.navigation.touch.diagnostics().enabled &&
    window.__mn.navigation.touch.diagnostics().pointers === 0 && window.__mn.navigation.fixedAxes().naval.throttle === 0);
  result.pausedNeutral = await page.evaluate(() => ({ paused: !window.__mn.input.enabled,
    enabled: window.__mn.navigation.touch.diagnostics().enabled, axes: window.__mn.navigation.fixedAxes() }));
  check(result.pausedNeutral.paused && !result.pausedNeutral.enabled && result.pausedNeutral.axes.naval.throttle === 0,
    'pause did not disable and neutralize touch controls');
  await page.locator('#btn-resume').click();
  await page.waitForFunction(() => window.__mn.input.enabled && window.__mn.navigation.touch.diagnostics().enabled);

  const hiddenMove = await page.locator('.naval-touch-stick-move').boundingBox();
  const hiddenCenter = pointFor(hiddenMove), hiddenForward = await stageDrag(hiddenCenter, hiddenMove, 0, -1, .34);
  await dispatch('touchStart', [{ point: hiddenCenter, id: 12 }]); await dispatch('touchMove', [{ point: hiddenForward, id: 12 }]);
  await page.waitForFunction(() => window.__mn.navigation.fixedAxes().naval.throttle > .5);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => window.__mn.navigation.touch.diagnostics().pointers === 0 &&
    !window.__mn.navigation.touch.diagnostics().enabled && window.__mn.navigation.fixedAxes().naval.throttle === 0);
  result.hiddenNeutral = await page.evaluate(() => ({ paused: !window.__mn.input.enabled, enabled: window.__mn.navigation.touch.diagnostics().enabled,
    throttle: window.__mn.navigation.fixedAxes().naval.throttle }));
  check(result.hiddenNeutral.paused && !result.hiddenNeutral.enabled && result.hiddenNeutral.throttle === 0,
    'visibility loss did not pause and neutralize touch controls');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange')); });
  if (await page.evaluate(() => !window.__mn.input.enabled)) await page.locator('#btn-resume').click();
  await page.waitForFunction(() => window.__mn.input.enabled && window.__mn.navigation.touch.diagnostics().enabled);

  const endShot = resolve(out, `${spec.name}-touch-accepted.png`);
  await page.screenshot({ path: endShot, fullPage: true }); result.screenshots.push(endShot);
  result.endDiagnostics = await page.evaluate(() => ({ touch: window.__mn.navigation.touch.diagnostics(),
    errors: [...window.__mn.errors], viewport: { width: innerWidth, height: innerHeight },
    htmlScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth }));
  check(!result.endDiagnostics.errors.length && result.endDiagnostics.htmlScrollWidth <= spec.width + 1,
    `final viewport or game diagnostics failed: ${JSON.stringify(result.endDiagnostics)}`);
  await cdp.detach();
}

async function runChatAcceptance(page, result, spec) {
  const toggle=page.locator('.mn-chat-toggle'), panel=page.locator('.mn-chat-panel');
  check(await toggle.count()===1, 'real chat launcher is missing');
  const closed=await toggle.evaluate((el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,
      visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,
      expanded:el.getAttribute('aria-expanded'),label:el.getAttribute('aria-label')||el.textContent.trim()};});
  result.chat={closed};
  check(closed.visible&&closed.width>=44&&closed.height>=44&&closed.x>=0&&closed.y>=0&&closed.right<=spec.width+1&&closed.bottom<=spec.height+1,
    `closed chat launcher is hidden/clipped/undersized: ${JSON.stringify(closed)}`);
  check(closed.expanded==='false',`chat did not begin closed: ${JSON.stringify(closed)}`);
  await toggle.click();
  await page.waitForFunction(()=>{const t=document.querySelector('.mn-chat-toggle'),p=document.querySelector('.mn-chat-panel');
    return t?.getAttribute('aria-expanded')==='true'&&p&&!p.hidden;},{},{timeout:10000});
  await page.waitForFunction(()=>{const p=document.querySelector('.mn-chat-panel');return p&&[...p.getAnimations()].every(a=>a.playState!=='running')},null,{timeout:5000});
  await page.waitForTimeout(220);
  const open=await page.evaluate(()=>{const panel=document.querySelector('.mn-chat-panel'),input=panel?.querySelector('.mn-chat-input'),send=panel?.querySelector('.mn-chat-send');
    const read=(el)=>{if(!el)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};};
    const ancestors=[];for(let el=panel;el&&ancestors.length<8;el=el.parentElement){const s=getComputedStyle(el),r=el.getBoundingClientRect();ancestors.push({tag:el.tagName,cls:typeof el.className==='string'?el.className:'',display:s.display,visibility:s.visibility,opacity:s.opacity,zIndex:s.zIndex,rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom}});}
    const pr=panel.getBoundingClientRect(),hit=document.elementFromPoint(pr.left+pr.width/2,pr.top+pr.height/2);
    return {panel:read(panel),input:read(input),send:read(send),focused:document.activeElement===input,
      opacity:getComputedStyle(panel).opacity,background:getComputedStyle(panel).backgroundImage,
      centerHit:hit?.className||hit?.tagName,centerInside:!!hit?.closest('.mn-chat-panel'),ancestors,
      connectionState:document.querySelector('.mn-chat')?.dataset?.connection||null};});
  result.chat.open=open;
  const inside=(r)=>r&&r.visible&&r.x>=0&&r.y>=0&&r.right<=spec.width+1&&r.bottom<=spec.height+1;
  check(inside(open.panel)&&inside(open.input)&&inside(open.send)&&Number(open.opacity)>=.95&&open.centerInside,
    `chat panel/composer is not visibly rendered in viewport: ${JSON.stringify(open)}`);
  const chatShot=resolve(out,`${spec.name}-chat-open.png`); await page.screenshot({path:chatShot,fullPage:true}); result.screenshots.push(chatShot);
  await page.locator('.mn-chat-close').click();
  await page.waitForFunction(()=>document.querySelector('.mn-chat-toggle')?.getAttribute('aria-expanded')==='false'&&document.querySelector('.mn-chat-panel')?.hidden,
    null,{timeout:10000});
  await page.waitForFunction(()=>window.__mn?.input?.enabled&&window.__mn?.navigation?.touch?.diagnostics?.().enabled,null,{timeout:10000});
  result.chat.closedAfter=await toggle.evaluate((el)=>({expanded:el.getAttribute('aria-expanded'),visible:!!(el.getBoundingClientRect().width&&el.getBoundingClientRect().height)}));
  check(result.chat.closedAfter.expanded==='false'&&result.chat.closedAfter.visible,'chat did not close cleanly after composer check');
}

try {
  const allViewports = [
    { name: 'reference-landscape-844x390', width: 844, height: 390, touch: true },
    { name: 'reference-portrait-390x844', width: 390, height: 844, touch: true },
    { name: 'reference-desktop-1280x800', width: 1280, height: 800, touch: false },
  ];
  const compactViewports = [
    { name: 'compact-landscape-844x390', width: 844, height: 390, touch: true },
    { name: 'compact-portrait-390x844', width: 390, height: 844, touch: true },
    { name: 'compact-container-640x360', width: 640, height: 360, touch: true },
  ];
  const arcViewports = [
    { name: 'arc-landscape-844x390', width: 844, height: 390, touch: true },
    { name: 'arc-portrait-390x844', width: 390, height: 844, touch: true },
    { name: 'arc-container-640x360', width: 640, height: 360, touch: true },
  ];
  check([lifecycleOnly,compactOnly,arcOnly].filter(Boolean).length<=1, 'focused mobile QA modes are mutually exclusive');
  const selected = arcOnly ? process.env.MN_NAV_ARC_UI_VIEWPORT
    ? arcViewports.filter((spec) => spec.name === process.env.MN_NAV_ARC_UI_VIEWPORT) : arcViewports
    : compactOnly ? process.env.MN_NAV_COMPACT_UI_VIEWPORT
    ? compactViewports.filter((spec) => spec.name === process.env.MN_NAV_COMPACT_UI_VIEWPORT) : compactViewports
    : lifecycleOnly ? allViewports.filter((spec) => spec.name === 'reference-landscape-844x390') : process.env.MN_NAV_REFERENCE_VIEWPORT
    ? allViewports.filter((spec) => spec.name === process.env.MN_NAV_REFERENCE_VIEWPORT) : allViewports;
  check(selected.length > 0, 'MN_NAV_REFERENCE_VIEWPORT did not match a configured case');
  for (const spec of selected) await runViewport(spec);
} finally {
  await browser.close();
}
evidence.status = evidence.failures.length ? 'failed' : 'passed';
evidence.finishedAt = new Date().toISOString();
await writeFile(resolve(out, arcOnly ? 'arc-ui-evidence.json' : compactOnly ? 'compact-ui-evidence.json' : lifecycleOnly ? 'reference-ui-lifecycle-evidence.json' : 'reference-ui-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ status: evidence.status,
  viewports: evidence.viewports.map(({ name, status, failure, screenshots }) => ({ name, status, failure, screenshots })), out }, null, 2));
if (evidence.status !== 'passed') process.exitCode = 1;
