// Public deployment smoke test; no account credentials or fixture auth.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
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
  assert.deepEqual(evidence.errors, []);
  await context.close();
} catch (error) { evidence.errors.push(error.stack || String(error)); process.exitCode = 1; }
finally {
  await browser.close();
  await writeFile(resolve('docs/delivery/gm01/public-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
