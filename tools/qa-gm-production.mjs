// Public deployment smoke test; no account credentials or fixture auth.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const origin = 'https://marea.62.171.136.148.sslip.io';
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const evidence = { schema: 'gm01-public/v1', at: new Date().toISOString(), production: true, simulatedAuth: false, checks: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  assert.equal((await fetch(origin + '/health')).status, 200);
  const status = await (await fetch(origin + '/status')).json();
  evidence.version = status.version;
  assert.equal(status.version, '0.6.0-alpha.18');
  evidence.storage = { kind: status.storage.kind, durable: status.storage.durable, accounts: status.storage.accounts, errors: status.storage.errors };
  assert.equal(status.errors, 0); assert.equal(status.storage.errors, 0);
  evidence.checks.push('public_health_version_and_storage');
  assert.equal((await fetch(origin + '/api/gm/session')).status, 401);
  evidence.checks.push('public_guest_denied_gm');
  const catalog = await (await fetch(origin + '/assets/editor/catalog.json')).json();
  assert.equal(catalog.assets.length, 4);
  const rock = catalog.assets.find((entry) => entry.id === 'model:gm-rock-1k');
  const bytes = Buffer.from(await (await fetch(origin + '/assets/' + rock.src)).arrayBuffer());
  assert.equal(bytes.length, rock.stats.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), rock.stats.sha256);
  evidence.checks.push('public_optimized_model_hash_and_bytes');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => evidence.errors.push(error.message));
  await page.goto(origin + '/?q=low&tod=day', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mn, null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => __mn.gmEntry.button.hidden), true);
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await page.screenshot({ path: resolve('docs/delivery/gm01/production-gameplay.png') });
  evidence.checks.push('real_public_browser_guest_join');
  if (process.env.MN_GM_SETUP_FILE) {
    const file = process.env.MN_GM_SETUP_FILE;
    const { tokenHash } = JSON.parse(await readFile(file, 'utf8'));
    await unlink(file);
    assert.match(tokenHash, /^[a-f0-9]{32,128}$/i);
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    gmPage.on('pageerror', () => evidence.errors.push('production_gm_page_error'));
    await gmPage.goto(origin + '/?q=low&tod=day&account-setup=1#gm_setup_token=' + tokenHash, { waitUntil: 'domcontentloaded' });
    await gmPage.waitForFunction(() => window.__mn?.gmEntry.allowed && !document.querySelector('.gm-account-setup-overlay')?.hidden, null, { timeout: 90000 });
    assert.equal(await gmPage.evaluate(() => location.hash), '');
    await gmPage.screenshot({ path: resolve('docs/delivery/gm01/production-account-setup.png') });
    await gmPage.locator('.gm-account-setup-card [data-action="cancel"]').click();
    await gmPage.locator('#btn-gm-editor').click();
    await gmPage.waitForFunction(() => __mn.st.mode === 'editor');
    await gmPage.locator('[data-editor-asset="model:gm-rock-1k"]').click();
    await gmPage.waitForFunction(() => !!__mn.gmEditor.ghost);
    await gmPage.mouse.move(700, 420); await gmPage.mouse.click(700, 420);
    await gmPage.waitForFunction(() => __mn.gmEditor.history.current().objects.length === 1);
    await gmPage.keyboard.press('Escape');
    await gmPage.evaluate(() => { __mn.gmEditor.select(__mn.gmEditor.history.current().objects[0].id); const p=__mn.gmEditor.records.get(__mn.gmEditor.selectedId).root.position; __mn.world.camera.position.set(p.x+12,p.y+8,p.z+12); __mn.gmEditor._focusSelection(); });
    await gmPage.locator('[data-action="save"]').click();
    await gmPage.waitForFunction(() => !__mn.gmEditor.dirty);
    assert.equal(await gmPage.evaluate(() => __mn.client.joined), false);
    await gmPage.screenshot({ path: resolve('docs/delivery/gm01/production-gm-editor.png') });
    evidence.checks.push('real_owner_recovery_session_password_prompt_gm_placement_and_local_save');
    await gmPage.evaluate(async () => { const client=await __mn.gmEntry.auth.ensureClient(); await client.auth.signOut({scope:'local'}); });
    await gmPage.waitForFunction(() => __mn.st.mode === 'title' && !__mn.gmEditor.active);
    evidence.checks.push('real_owner_signout_closes_editor');
    await gmContext.close();
  }
  assert.deepEqual(evidence.errors, []);
  await context.close();
} catch (error) { evidence.errors.push(error.stack || String(error)); process.exitCode = 1; }
finally {
  await browser.close();
  await writeFile(resolve('docs/delivery/gm01/public-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
