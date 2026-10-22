// Automated screenshots + console check (Playwright, headless Chromium with SwiftShader WebGL).
// Usage: node tools/shot.mjs [outDir] [--quality=high] [--scenario=all|title|play|village-night] [--dof=0|1]
//   [--tod=night|golden|day] (village-night scenario: the light preset, default night)
//   [--pose=plaza|props|fence-east|fence-north|board] (village-night scenario: plaza = the campfire view, default; props = three
//   frames in one session, fence-east, fence-north and board, files village-<pose>-<tod>-<quality>.png, each with its own JSON
//   line {subjects: [{kind, x, z, inFrame, visible, samples}], ok}; fence-east, fence-north or board = that one frame only)
//   [--x=<u> --z=<u> --yaw=<deg> --zoom=<0..2>] (village-night scenario: camera placement, offsets from the village centre;
//   defaults x 2 z 4 yaw 45 zoom 1 for plaza, a fixed pose per prop frame; an explicit option wins on a single pose, props ignores them)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'shots'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const quality = opt.quality || 'high';
const scenario = opt.scenario || 'all';
const tod = ['night', 'golden', 'day'].includes(opt.tod) ? opt.tod : 'night';
const width = +(opt.w || 1280), height = +(opt.h || 720);
fs.mkdirSync(outDir, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// In the sandboxed dev container, HTTPS is re-terminated by a proxy whose CA Chromium must trust
// (scoped to that one CA's public key; set MN_PROXY_SPKI to enable).
const extra = process.env.MN_PROXY_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.MN_PROXY_SPKI}`] : [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...extra] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
if (scenario === 'village-night') await page.setViewportSize({ width: 1920, height: 900 });
// Optional: serve the CDN libraries from a local copy (MN_LIBS=<dir with three-0.160.0/ and gsap-3.12.5/>),
// and fetch fonts from Node, so screenshots don't depend on the browser's network stack.
if (process.env.MN_LIBS) {
  const libs = process.env.MN_LIBS;
  const local = { 'three@0.160.0': 'three-0.160.0/package', 'gsap@3.12.5': 'gsap-3.12.5/package' };
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, (route) => {
    const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const f = path.join(libs, local[m[1]], m[2]);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, async (route) => {
    try { const r = await route.fetch(); await route.fulfill({ response: r, headers: { ...r.headers(), 'access-control-allow-origin': '*' } }); }
    catch { await route.abort(); }
  });
}
const logs = [];
const seen = new Map();
page.on('console', (m) => {
  if (!['error', 'warning'].includes(m.type())) return;
  const t = `[${m.type()}] ${m.text()}`;
  const k = t.slice(0, 160);
  seen.set(k, (seen.get(k) || 0) + 1);
  if (seen.get(k) === 1) logs.push(t);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png'), timeout: 120000 }); console.log('shot', name); };
const wait = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();
const dofParam = opt.dof !== undefined ? `&dof=${opt.dof}` : ''; // --dof=0 off, --dof=1 forced on, absent: the tier's
await page.goto(`http://localhost:${port}/?q=${quality}&tod=day&debug&perf&maxdt=${opt.maxdt || 0.5}${dofParam}`, { waitUntil: "load" });
try {
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: +(opt.timeout || 120000) });
} catch (e) {
  console.log('NOT READY:', e.message);
  console.log(logs.join('\n'));
  await shot('00-fail');
  await browser.close(); server.close(); process.exit(1);
}
console.log('ready in', Date.now() - t0, 'ms');
await wait(2500);
if (scenario !== 'village-night') await shot('01-title');
if (scenario !== 'title') {
  await page.click('#btn-play', { force: true });
  // A "Your characters" dialog can block gameplay after PLAY: click through it (bounded, no-op when absent).
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() => window.__mn.st.mode === 'playing')) break;
    const pri = page.locator('.player-characters-primary:visible:not([disabled])');
    if (await pri.count()) await pri.first().click({ force: true });
    else {
      const sec = page.locator('.player-characters-secondary:visible:not([disabled])');
      if (await sec.count()) await sec.first().click({ force: true });
    }
    await wait(2500);
  }
  try { await page.waitForFunction(() => window.__mn.st.mode === 'playing', null, { timeout: 60000 }); }
  catch (e) {
    console.log('NOT PLAYING', await page.evaluate(() => JSON.stringify({ mode: window.__mn.st.mode, body: document.body.innerText.slice(0, 400) })));
    console.log(logs.join(String.fromCharCode(10)));
    await browser.close(); server.close(); process.exit(1);
  }
  await page.waitForFunction(() => !window.__mn.world.rig.blend, null, { timeout: 90000 });
  if (scenario === 'village-night') {
    // Pose defaults (offsets from the village centre). plaza is the campfire view. fence-east, fence-north and board are
    // close-ups picked by a grid search of the camera (position, yaw, zoom) with the occlusion rule below: the player stands on
    // clear ground a few u from the subjects, so they sit near the screen centre, inside the sharp band of the depth of field.
    const POSES = {
      plaza: { x: 2, z: 4, yaw: 45, zoom: 1 },
      'fence-east': { x: -12.4, z: -3.1, yaw: 255, zoom: 1 },
      'fence-north': { x: -2.7, z: 13.3, yaw: 315, zoom: 1 },
      board: { x: 3.2, z: -0.8, yaw: 285, zoom: 0 },
    };
    const pose = opt.pose === 'props' || Object.hasOwn(POSES, opt.pose) ? opt.pose : 'plaza';
    const frames = pose === 'props' ? ['fence-east', 'fence-north', 'board'] : [pose];
    const getStats = () => page.evaluate(() => {
      const w = window.__mn.world, i = w.renderer.info;
      const c = w.lighting.cur;
      return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs.length,
        sunI: c.sunI, windows: c.windows, hemiI: c.hemiI, lightSoft: c.lightSoft, lightBounce: c.lightBounce, dof: !!w.pipeline.dofActive,
        lights: w.lights?.picked?.filter((s) => s.w > 0).map((s) => s.kind) ?? [] };
    });
    if (pose !== 'plaza') {
      // Occlusion check for the prop poses. Rays go only against static world meshes: the terrain, the props group, the
      // vegetation group (palms) and the resource-node group. Characters (players, bots, NPCs, the local avatar), sprites, points,
      // lines, labels and the effect layers (particles, mist) are not in those groups, and meshes whose material does not write
      // depth (glows, mist cards) are skipped. A sample is visible when it projects inside the frame and the ray from the camera
      // hits nothing nearer than (distance to the sample - 0.4 u).
      await page.evaluate(async () => {
        const THREE = await import('three');
        const m = window.__mn, w = m.world;
        const statics = [];
        for (const r of [w.terrain, w.props.group, w.vegetation, w.resources.group]) r.traverse((o) => {
          if (!o.isMesh) return;
          if ((Array.isArray(o.material) ? o.material : [o.material]).some((q) => q.depthWrite === false)) return;
          statics.push(o);
        });
        const rc = new THREE.Raycaster();
        rc.layers.enableAll();
        const tmp = new THREE.Vector3();
        const inside = (n) => Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z <= 1;
        // The two fence runs differ in axis: the east run (along v) has cos(rot) * -sin(rot) < 0, the north run (along u) has >= 0.
        const isEast = (p) => Math.cos(p.rot) * -Math.sin(p.rot) < 0;
        window.__measure = (group) => {
          const cam = w.camera, V = m.map.landmarks.village, props = m.map.props;
          cam.updateMatrixWorld();
          const fences = props.filter((p) => p.kind === 'fence'), board = props.filter((p) => p.kind === 'board');
          const fires = props.filter((p) => p.kind === 'campfire').sort((a, b) => Math.hypot(a.x - V.x, a.z - V.z) - Math.hypot(b.x - V.x, b.z - V.z));
          const list = group === 'board' ? board : fences.filter((p) => isEast(p) === (group === 'fence-east'));
          const proj = (x, y, z) => tmp.set(x, y, z).project(cam).clone();
          const sample = (x, y, z) => {
            if (!inside(proj(x, y, z))) return false;
            const dir = new THREE.Vector3(x, y, z).sub(cam.position), dist = dir.length();
            rc.set(cam.position, dir.normalize()); rc.near = 0; rc.far = Math.max(0, dist - 0.4);
            return rc.intersectObjects(statics, false).length === 0;
          };
          // Fence segment: centre and +/- 0.6 u along its axis at 0.8 u; board: centre and +/- 0.5 u along its width at 1.0 u.
          const subjects = list.map((p) => {
            const ax = Math.cos(p.rot), az = -Math.sin(p.rot);
            const ks = group === 'board' ? [0, -0.5, 0.5] : [0, -0.6, 0.6], h = group === 'board' ? 1.0 : 0.8;
            const samples = ks.filter((k) => sample(p.x + ax * k, p.y + h, p.z + az * k)).length;
            return { kind: p.kind, x: +p.x.toFixed(2), z: +p.z.toFixed(2), inFrame: inside(proj(p.x, p.y + h, p.z)), visible: samples >= 2, samples };
          });
          const out = { subjects };
          let ok = subjects.length === (group === 'board' ? 1 : 3) && fences.length === 6 && board.length === 1 && subjects.every((s) => s.inFrame && s.visible);
          if (group === 'board') {
            const f = fires[0];
            out.fireInFrame = inside(proj(f.x, f.y + 0.7, f.z));
            out.boardRot = +board[0].rot.toFixed(4);
            out.bearingToFire = +Math.atan2(f.x - board[0].x, f.z - board[0].z).toFixed(4); // radians, same convention as rot (local +z toward the fire)
            ok = ok && out.fireInFrame;
          }
          out.ok = ok;
          return out;
        };
      });
    }
    for (let fi = 0; fi < frames.length; fi++) {
      const fp = frames[fi], d = POSES[fp], o = pose === 'props' ? {} : opt; // explicit --x/--z/--yaw/--zoom only for a single frame
      const x = +(o.x ?? d.x), z = +(o.z ?? d.z), zoom = +(o.zoom ?? d.zoom), yawDeg = +(o.yaw ?? d.yaw);
      await page.evaluate(([x, z, zoom, tod, yawDeg]) => {
        const m = window.__mn, r = m.world.rig, V = m.map.landmarks.village;
        m.teleport(V.x + x, V.z + z);
        r.yaw = r.yawTarget = yawDeg * Math.PI / 180;
        r.zoom(zoom - r.zoomIdx);
        // The server clock overrides tod() in gameplay unless setGameplay is neutralised first.
        const L = m.world.lighting;
        L.setGameplay = function () { this.gameplay = false; };
        m.tod(tod);
      }, [x, z, zoom, tod, yawDeg]);
      // night: the sun is out; day: full sun and the windows unlit; golden: the golden preset's lit windows (0.45).
      // Day and golden give up after 20 s and shoot anyway.
      await page.waitForFunction((t) => {
        const c = window.__mn.world.lighting.cur;
        return t === 'night' ? c.sunI <= 0.02 : t === 'day' ? c.sunI >= 0.5 && c.windows < 0.05 : c.sunI >= 0.5 && Math.abs(c.windows - 0.45) < 0.03;
      }, tod, { timeout: tod === 'night' ? 60000 : 20000 }).catch((e) => { if (tod === 'night') throw e; console.log('TOD WAIT TIMEOUT', tod, e.message); });
      await wait(9000);
      await page.evaluate(() => new Promise((done) => {
        let n = 10;
        const frame = () => --n ? requestAnimationFrame(frame) : done();
        requestAnimationFrame(frame);
      }));
      // The rig keeps blending after a teleport: wait until the camera stops moving (10 frames within 0.01 u).
      if (pose !== 'plaza') await page.evaluate(() => new Promise((done) => {
        const cam = window.__mn.world.camera, last = cam.position.clone(), t0 = performance.now();
        let still = 0;
        const frame = () => {
          still = cam.position.distanceTo(last) < 0.01 ? still + 1 : 0;
          last.copy(cam.position);
          if (still >= 10 || performance.now() - t0 > 30000) done(); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }));
      const stats = await getStats();
      if (pose === 'plaza') {
        // Fence and board props whose projected centre (0.7 u above the base) lies inside the frame (NDC within [-1, 1] on both axes).
        const frame = await page.evaluate(() => {
          const cam = window.__mn.world.camera;
          cam.updateMatrixWorld();
          const subs = window.__mn.map.props.filter((p) => p.kind === 'fence' || p.kind === 'board');
          const inFrame = subs.filter((p) => {
            const n = cam.position.clone().set(p.x, p.y + 0.7, p.z).project(cam);
            return Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z <= 1;
          }).length;
          return { inFrame, subjects: subs.length };
        });
        await shot(`village-${tod}-${quality}`);
        console.log(JSON.stringify({ scenario, quality, tod, pose, x, z, yaw: yawDeg, zoom, ...frame, ...stats }));
      } else {
        const meas = await page.evaluate((g) => window.__measure(g), fp);
        await shot(`village-${fp}-${tod}-${quality}`);
        console.log(JSON.stringify({ scenario, quality, tod, pose: fp, x, z, yaw: yawDeg, zoom, ...meas, ...stats }));
      }
    }
  } else {
  // Enemies fight back since M2: god mode keeps the tour from ending at a checkpoint.
  await page.evaluate(() => window.__mn.client.send({ t: 'cmd', type: 'dev', op: 'god', on: true }));
  await wait(3000);
  await shot('02-spawn');
  await page.mouse.move(width * 0.5, height * 0.45);
  await page.mouse.wheel(0, -300);
  await wait(5000);
  await shot('02b-closeup');
  await page.evaluate(() => window.__mn.fxTest());
  await wait(1200);
  await shot('02c-fx');
  await page.mouse.wheel(0, 300);
  await wait(3000);
  // Walk a bit and dash.
  await page.keyboard.down('KeyD');
  await wait(1500);
  await page.keyboard.press('Space');
  await wait(60);
  await shot('03-dash');
  await wait(800);
  await page.keyboard.up('KeyD');
  await wait(800);
  const tp = async (name, x, z, extra) => {
    await page.evaluate(([x, z]) => window.__mn.teleport(x, z), [x, z]);
    await wait(6000);
    if (extra) await extra();
    await shot(name);
  };
  const L = await page.evaluate(() => {
    const m = window.__mn, L = m.map.landmarks;
    const cap = m.map.npcs.find((n) => n.id === 'captain');
    return { village: L.village, arena: L.arena, dockBase: L.dockBase, path: L.path, captain: { x: cap.x, z: cap.z } };
  });
  await tp('04-village', L.village.x + 6, L.village.z + 6);
  await tp('05-captain', L.captain.x + 1.5, L.captain.z + 1.5, async () => { await page.keyboard.press('KeyF'); await wait(2500); });
  await tp('06-path', L.path[3].x, L.path[3].z);
  await tp('07-caldera', L.arena.x + 6, L.arena.z + 6);
  await wait(2500);
  await shot('08-caldera-volcanic');
  await page.mouse.move(width * 0.5, height * 0.5);
  await page.mouse.wheel(0, 300);
  await wait(5000);
  await shot('09-zoom-far');
  await page.mouse.wheel(0, -300);
  // Water: wade in the shallows next to the spawn, then the dock with the floating cargo.
  const W = await page.evaluate(() => {
    const m = window.__mn, L = m.map.landmarks;
    let x = L.spawn.x, z = L.spawn.z;
    for (let i = 0; i < 400 && m.map.heightAt(x, z) > -0.38; i++) { x += 0.15; z += 0.15; }
    return { wade: { x, z }, dock: { x: L.dockBase.x + 4, z: L.dockBase.z + 1 } };
  });
  await tp('10-wade', W.wade.x, W.wade.z, async () => { await page.keyboard.down('KeyA'); await wait(2500); await page.keyboard.up('KeyA'); await wait(400); });
  await tp('11-dock', W.dock.x, W.dock.z);
  // Combat (M2): the practice ring under cannon fire, and the archers on the Sendero del Humo.
  const C = await page.evaluate(() => {
    const m = window.__mn, a = m.map.enemySpawns.find((e) => e.kind === 'archer');
    return { ring: m.map.practice.ring, archer: { x: a.x + 6, z: a.z + 3 } };
  });
  await tp('14-practice', C.ring.x + 1, C.ring.z - 0.5);
  await tp('15-archers', C.archer.x, C.archer.z, async () => { await page.keyboard.press('KeyJ'); await wait(300); });
  // M2.5/M3 La Prueba de Fuego: step on the runes (wave 1), skip to waves 3 and 5, then Hellfire's 3 phases.
  const dev = (o) => page.evaluate((o2) => window.__mn.client.send({ t: 'cmd', type: 'dev', ...o2 }), o);
  const encSt = () => page.evaluate(() => JSON.stringify(window.__mn.client.enc && window.__mn.client.enc[0]));
  await tp('16-trial-wave1', L.arena.x + 1, L.arena.z + 1, async () => { await wait(2500); });
  await dev({ op: 'enc', sub: 'wave' }); await wait(5500);
  await dev({ op: 'enc', sub: 'wave' }); await wait(800); await dev({ op: 'enc', sub: 'wave' }); await wait(5500);
  await shot('17-trial-wave3');
  // M3: waves 4–5 bring the mortar crabs; Hellfire's double laser (phase 2) and the lava ring (phase 3).
  await dev({ op: 'enc', sub: 'wave' }); await wait(5500);
  await dev({ op: 'enc', sub: 'wave' }); await wait(5500);
  await shot('20-trial-wave5');
  await dev({ op: 'enc', sub: 'boss' }); await wait(6500);
  await shot('18-hellfire-1');
  await dev({ op: 'enc', sub: 'phase2' }); await wait(5000);
  await shot('19-hellfire-2');
  await page.waitForFunction(() => window.__mn.client.hazards.beams.some((b) => b.kind === 'laser' && window.__mn.client.ptCur > b.tAct + 20), null, { timeout: 40000 }).catch(() => {});
  await shot('21-hellfire-laser');
  await dev({ op: 'enc', sub: 'phase3' }); await wait(9000);
  await shot('22-hellfire-3');
  console.log('trial', await encSt());
  await dev({ op: 'enc', sub: 'reset' });
  // Night: lanterns, hut windows, the campfire and the moonlit sea.
  await page.evaluate(() => window.__mn.tod('night'));
  await wait(1500);
  await shot('12-dock-night');
  await tp('13-village-night', L.village.x + 2, L.village.z + 1);
  const perf = await page.evaluate(() => document.querySelector('#perf').textContent);
  console.log(perf);
  }
}
console.log('--- console (errors/warnings) ---');
console.log(logs.length ? logs.join('\n') : '(clean)');
await browser.close();
server.close();
