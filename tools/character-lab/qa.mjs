// Browser acceptance for real GLB loads, body switches, palette isolation and skinned deformation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const playwright = process.env.MN_PLAYWRIGHT || path.join(root, '.scratch/pilot-browser/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwright).href);
const out = path.join(root, 'docs/art/characters-base-v0');
await fs.mkdir(out, { recursive: true });
const url = new URL(process.env.MN_CHARACTER_LAB_URL || 'http://127.0.0.1:5194'); url.searchParams.set('v', '0');
const evidence = { schema: 'character-lab-qa/v1', scope: 'Isolated base GLBs and preview UI; production art, game integration and physical-device FPS remain pending.',
  viewports: [], failures: [] };
const assert = (value, message) => { if (!value) throw new Error(message); };
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const spec of [{ id: 'desktop', width: 1440, height: 900 }, { id: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true }]) {
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, isMobile: !!spec.isMobile, hasTouch: !!spec.hasTouch, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [], consoleErrors = [], failures = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('requestfailed', (req) => failures.push({ url: req.url(), error: req.failure()?.errorText }));
    const result = { ...spec, bodies: [], errors, consoleErrors, requestFailures: failures };
    try {
      await page.goto(url.href, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__characterLab?.state.loaded);
      for (const body of ['male', 'female']) {
        await page.locator(`[data-body="${body}"]`).click();
        await page.waitForFunction((kind) => __characterLab.state.body === kind && __characterLab.state.loaded, body);
        await page.locator('[data-pose="a"]').click();
        await page.locator('[data-view="front"]').click();
        await page.waitForTimeout(180);
        await page.screenshot({ path: path.join(out, `${spec.id}-${body}-front-v0.png`), fullPage: !!spec.isMobile });
        const check = await page.evaluate(() => {
          const lab = __characterLab, model = lab.active;
          const channels = model.meshes.map((mesh) => ({ name: mesh.name, channels: Object.keys(mesh.geometry.attributes), joints: mesh.skeleton.bones.length }));
          const geometry = model.meshes.find((mesh) => mesh.name === 'body_base'), vec = lab.camera.position.clone();
          lab.state.pose = 'idle'; lab.sample(0); const before = [];
          for (let i = 0; i < geometry.geometry.attributes.position.count; i += 16) { geometry.getVertexPosition(i, vec); before.push(vec.clone()); }
          lab.state.pose = 'a'; lab.sample(0); let moved = 0, index = 0;
          for (let i = 0; i < geometry.geometry.attributes.position.count; i += 16) { geometry.getVertexPosition(i, vec); if (vec.distanceTo(before[index++]) > .02) moved++; }
          const snapshot = { channels, bones: Object.keys(model.bones), height: model.height, movedVertices: moved,
            glError: lab.renderer.getContext().getError(), programsLinked: lab.renderer.info.programs.every((program) => lab.renderer.getContext().getProgramParameter(program.program, lab.renderer.getContext().LINK_STATUS)),
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth, errors: lab.state.errors.slice() };
          return snapshot;
        });
        assert(check.bones.length === 15, `${body}: missing joints`);
        assert(check.channels.length === 5 && check.channels.every((mesh) => mesh.joints === 15), `${body}: missing skinned parts`);
        assert(check.movedVertices > 10, `${body}: A pose did not deform body vertices`);
        assert(check.glError === 0 && check.programsLinked && !check.errors.length, `${body}: GPU or loader error`);
        assert(!check.horizontalOverflow, `${spec.id}: horizontal overflow`);
        const beforePalette = await page.evaluate(() => {
          const m = __characterLab.active.meshes; return { skin: Array.from(m.find((x) => x.name === 'head_base').geometry.attributes.color.array), cloth: Array.from(m.find((x) => x.name === 'base_top').geometry.attributes.color.array) };
        });
        await page.locator('[aria-label="Piel oscura"]').click();
        const palette = await page.evaluate((before) => {
          const m = __characterLab.active.meshes, skin = m.find((x) => x.name === 'head_base').geometry.attributes.color.array, cloth = m.find((x) => x.name === 'base_top').geometry.attributes.color.array;
          return { skinChanged: skin.some((n, i) => n !== before.skin[i]), clothUnchanged: cloth.every((n, i) => n === before.cloth[i]) };
        }, beforePalette);
        assert(palette.skinChanged && palette.clothUnchanged, `${body}: palette changed garment or failed to update skin`);
        await page.locator('[aria-label="Piel cálida"]').click();
        await page.locator('[data-view="face"]').click(); await page.waitForTimeout(180);
        await page.screenshot({ path: path.join(out, `${spec.id}-${body}-face-v0.png`), fullPage: !!spec.isMobile });
        await page.locator('[data-pose="run"]').click(); await page.locator('[data-view="side"]').click();
        await page.waitForTimeout(180);
        await page.screenshot({ path: path.join(out, `${spec.id}-${body}-run-v0.png`), fullPage: !!spec.isMobile });
        await page.locator('#concept').click();
        await page.waitForFunction(() => document.querySelector('#reference-image').complete && document.querySelector('#reference-image').naturalWidth > 1000);
        assert(await page.locator('#reference').evaluate((d) => d.open), 'Concept dialog did not open');
        await page.locator('#close-reference').click();
        result.bodies.push({ body, ...check, palette, conceptDialogLoaded: true });
      }
      await page.waitForLoadState('networkidle');
      assert(!errors.length && !consoleErrors.length && !failures.length, `${spec.id}: browser errors`);
    } catch (error) { evidence.failures.push({ viewport: spec.id, message: error.message }); }
    finally { evidence.viewports.push(result); await context.close(); }
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(out, 'browser-evidence-v0.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ viewports: evidence.viewports.length, bodies: evidence.viewports.reduce((n, item) => n + item.bodies.length, 0), failures: evidence.failures }));
if (evidence.failures.length) process.exitCode = 1;
