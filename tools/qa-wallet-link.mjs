// Focused browser acceptance for W02b. Uses local fake Supabase Auth and a real in-memory wallet-link service.
// No project credentials, external Auth, live chain, funds, or game join are involved.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { privateKeyToAccount } from 'viem/accounts';
import { createGameServer } from '../server/index.mjs';
import { createAccountResolver } from '../server/auth.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryWalletStore } from '../server/web3/walletStore.mjs';
import { createWalletLinkService } from '../server/web3/walletLink.mjs';

const { chromium } = await import(process.env.MN_PLAYWRIGHT
  ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright');
const BROWSER = process.env.MN_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.resolve(process.env.OUT || 'docs/delivery/w02b-wallet-browser');
const CHAIN_ID = 84532;
const PASSWORD = 'local-review-password';
const PUBLIC_KEY = 'sb_publishable_local_wallet_review';
const users = new Map([
  ['desktop@example.test', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'desktop@example.test' }],
  ['portrait@example.test', { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'portrait@example.test' }],
  ['landscape@example.test', { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'landscape@example.test' }],
]);
// Public deterministic fixture keys, one per account to exercise unique-wallet ownership.
const signers = new Map([...users.keys()].map((email, i) => [email,
  privateKeyToAccount(`0x${BigInt(i + 1).toString(16).padStart(64, '0')}`)]));
const counters = { signins: 0, challenges: 0, verifications: 0, linkReads: 0 };
const authTokens = new Map();
const exp = Math.floor(Date.now() / 1000) + 3600;
const tokenFor = (user) => {
  const token = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ sub: user.id, exp })).toString('base64url'), 'local-wallet-review'].join('.');
  authTokens.set(token, user);
  return token;
};
const authHttp = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const url = new URL(req.url, 'http://local-auth');
  const json = (status, body) => res.writeHead(status).end(JSON.stringify(body));
  if (url.pathname === '/auth/v1/user') {
    const user = authTokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    return user ? json(200, { ...user, aud: 'authenticated', role: 'authenticated', is_anonymous: false })
      : json(401, { msg: 'invalid local review token' });
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  let input = {};
  try { input = body ? JSON.parse(body) : {}; } catch { return json(400, { msg: 'invalid json' }); }
  if (url.pathname === '/auth/v1/token') {
    counters.signins++;
    const user = users.get(String(input.email || '').toLowerCase());
    if (!user || input.password !== PASSWORD) return json(400, { error_code: 'invalid_credentials', msg: 'invalid local credentials' });
    const token = tokenFor(user);
    return json(200, { access_token: token, refresh_token: `local-refresh-${user.id}`, expires_in: 3600,
      expires_at: exp, token_type: 'bearer', user: { ...user, aud: 'authenticated', role: 'authenticated', is_anonymous: false } });
  }
  if (url.pathname === '/auth/v1/logout') return json(200, {});
  return json(404, {});
});

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

await new Promise((resolve) => authHttp.listen(0, '127.0.0.1', resolve));
const authUrl = `http://127.0.0.1:${authHttp.address().port}`;
const authVerifier = createClient(authUrl, PUBLIC_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const gamePort = await availablePort();
const origin = `http://127.0.0.1:${gamePort}`;
const walletStore = createMemoryWalletStore();
const walletService = createWalletLinkService({ store: walletStore, origin, chainId: CHAIN_ID });
const observedWalletService = {
  origin: walletService.origin,
  chainId: walletService.chainId,
  durable: walletService.durable,
  issue: async (...args) => { counters.challenges++; return walletService.issue(...args); },
  verify: async (...args) => { counters.verifications++; return walletService.verify(...args); },
  loadLink: async (...args) => { counters.linkReads++; return walletService.loadLink(...args); },
};
const gameStore = createMemoryStore();
const game = createGameServer({
  port: gamePort, host: '127.0.0.1', seed: 42, bots: 0, log: () => {}, saveSecret: 'local-wallet-review-only',
  store: gameStore, resolvePlayer: createAccountResolver(authVerifier), initializeAccounts: true,
  publicAuth: { enabled: true, url: authUrl, publicKey: PUBLIC_KEY }, walletLink: observedWalletService,
});
const port = await game.listen();
assert.equal(port, gamePort, 'game server uses the origin configured into the SIWE service');
const contexts = [];
const pageErrors = [];
const results = [];
let browser;

const fixture = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Revisión local de wallet</title><link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/account.css"><link rel="stylesheet" href="/styles/wallet.css">
<style>html,body{margin:0;min-height:100%;background:#0b1630;color:#fff2d1;font-family:system-ui}body{padding:18px}.title-actions{max-width:900px;margin:0 auto}.title-net{min-height:42px}.review-title{max-width:900px;margin:10vh auto 0;text-align:center;font-size:clamp(32px,8vw,64px)}@media(max-width:620px){body{padding:8px}.review-title{margin-top:7vh}}</style>
</head><body><h1 class="review-title">Revisión local de cuenta y wallet</h1><div class="title-actions"><div class="title-net"></div></div>
<script type="module">
import { AccountAuth } from '/src/client/accountAuth.js';
import { WalletLink } from '/src/client/walletLink.js';
import { AccountPanel } from '/src/ui/account.js';
const auth = new AccountAuth({ httpBase: location.origin });
const wallet = new WalletLink({ auth, httpBase: location.origin });
const panel = new AccountPanel(document.querySelector('.title-actions'), auth, {
  wallet, looks: Array.from({ length: 5 }, (_, id) => ({ id, name: ['Grumete','Marinera','Corsario','Capitana','Navegante'][id], color: ['#ec6b42','#43bfc6','#dea53c','#7357a8','#43845c'][id] })),
});
window.__walletReview = { auth, wallet, panel };
window.__walletReviewReady = false;
auth.bootstrap({ online: true }).then(() => { window.__walletReviewReady = true; });
</script></body></html>`;

const providerInit = ({ address, chainId }) => {
  window.__fakeWalletState = { address, chainId, connected: false, signCalls: Number(sessionStorage.getItem('wallet-review-sign-count') || 0), calls: [], rejectSign: false, listeners: new Map() };
  const state = window.__fakeWalletState;
  window.ethereum = {
    on(event, callback) { const list = state.listeners.get(event) || new Set(); list.add(callback); state.listeners.set(event, list); return this; },
    removeListener(event, callback) { state.listeners.get(event)?.delete(callback); return this; },
    async request({ method, params = [] }) {
      state.calls.push({ method });
      if (method === 'eth_requestAccounts') { state.connected = true; return [state.address]; }
      if (method === 'eth_accounts') return state.connected ? [state.address] : [];
      if (method === 'eth_chainId') return `0x${state.chainId.toString(16)}`;
      if (method === 'personal_sign') {
        state.signCalls++;
        sessionStorage.setItem('wallet-review-sign-count', String(state.signCalls));
        if (state.rejectSign) { const error = new Error('provider rejection detail'); error.code = 4001; throw error; }
        const bytes = Uint8Array.from(params[0].slice(2).match(/.{2}/g).map((part) => Number.parseInt(part, 16)));
        return window.__signWalletMessage(new TextDecoder().decode(bytes));
      }
      throw new Error(`unexpected review provider request: ${method}`);
    },
  };
};

async function pageFor({ label, email, width, height }) {
  const signer = signers.get(email);
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < height, hasTouch: width < height });
  // Intercepted fixture documents need loopback permission in the disposable test context.
  await context.grantPermissions(['local-network-access'], { origin });
  contexts.push(context);
  await context.exposeBinding('__signWalletMessage', async (_source, message) => signer.signMessage({ message }));
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
  page.on('requestfailed', (request) => console.log(JSON.stringify({ failedPath: new URL(request.url()).pathname, reason: request.failure()?.errorText })));
  page.on('console', (message) => { if (message.type() === 'error') console.log(message.text()); });
  await page.route('**/wallet-review', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
  await page.addInitScript(providerInit, { address: signer.address, chainId: CHAIN_ID });
  await page.goto(`${origin}/wallet-review`);
  await page.waitForFunction(() => window.__walletReviewReady === true);
  const sdk = await page.evaluate(() => window.__walletReview.auth.ensureClient().then(() => ({ ok: true }), (error) => ({ error: error.message })));
  assert.equal(sdk.ok, true, JSON.stringify(sdk));
  await page.locator('.account-open').click();
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=password]').fill(PASSWORD);
  await page.locator('.account-submit').click();
  try { await page.waitForFunction(() => !document.querySelector('.account-signed').hidden); }
  catch (error) {
    console.log(JSON.stringify(await page.evaluate(() => ({ auth: window.__walletReview.auth.state,
      feedback: document.querySelector('.account-feedback')?.textContent }))));
    console.log(JSON.stringify({ counters, pageErrors }));
    await page.screenshot({ path: path.join(OUT, `${label}-failed.png`), fullPage: true }); throw error;
  }
  await page.locator('.wallet-panel').waitFor({ state: 'visible' });
  try { await page.waitForFunction(() => document.querySelector('.wallet-panel-status')?.textContent === 'Sin vínculo'); }
  catch (error) {
    console.log(JSON.stringify(await page.evaluate(() => ({ auth: window.__walletReview.auth.state,
      wallet: window.__walletReview.wallet.snapshot(), status: document.querySelector('.wallet-panel-status')?.textContent }))));
    console.log(JSON.stringify({ pageErrors }));
    await page.screenshot({ path: path.join(OUT, `${label}-failed.png`), fullPage: true }); throw error;
  }
  return page;
}

async function reviewViewport(spec) {
  const page = await pageFor(spec);
  const prefix = spec.label;
  const challengeStart = counters.challenges, verificationStart = counters.verifications;
  const controlMeasurements = [];
  const checkWalletControls = async (phase) => {
    await page.locator('.wallet-panel').scrollIntoViewIfNeeded();
    const controls = [];
    for (const button of await page.locator('.wallet-panel-actions button:visible').all()) {
      await button.scrollIntoViewIfNeeded();
      controls.push(await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { name: element.textContent.trim(), width: Math.round(rect.width), height: Math.round(rect.height),
          inViewport: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight };
      }));
    }
    assert.ok(controls.length > 0 && controls.every((control) => control.height >= 44 && control.inViewport),
      `${phase} wallet controls are reachable and at least 44px high`);
    controlMeasurements.push({ phase, controls });
  };
  assert.equal(await page.evaluate(() => window.__fakeWalletState.calls.length), 0, 'opening AccountPanel and wallet status never prompts the provider');
  assert.equal(await page.locator('.wallet-panel').isVisible(), true);
  await checkWalletControls('unlinked');
  await page.evaluate(() => { window.__fakeWalletState.chainId = 1; });
  await page.locator('.wallet-panel-connect').click();
  await page.locator('.wallet-panel-error').waitFor({ state: 'visible' });
  assert.match(await page.locator('.wallet-panel-error').textContent(), /red indicada/i);
  assert.equal(counters.challenges, challengeStart, 'wrong chain is rejected before creating a server challenge');
  assert.equal(await page.evaluate(() => window.__fakeWalletState.signCalls), 0);

  await page.evaluate((chainId) => { window.__fakeWalletState.chainId = chainId; }, CHAIN_ID);
  await page.locator('.wallet-panel-connect').click();
  await page.locator('.wallet-panel-review').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.__fakeWalletState.signCalls), 0, 'connect only obtains a reviewable challenge');
  assert.match(await page.locator('.wallet-panel-review pre').textContent(), /No autoriza compras ni transferencias/);
  assert.match(await page.locator('.wallet-panel-review pre').textContent(), new RegExp(`Chain ID: ${CHAIN_ID}`));
  assert.match(await page.locator('.wallet-panel-review pre').textContent(), new RegExp(spec.accountId));
  await checkWalletControls('review');
  const preview = page.locator('.wallet-panel-review pre');
  await preview.focus();
  await page.keyboard.press('End');
  assert.equal(await preview.evaluate((element) => document.activeElement === element), true, 'the complete message is keyboard reachable');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.wallet-panel-sign')), true, 'Tab reaches the explicit signature action');
  await page.locator('.wallet-panel-review').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `${prefix}-review.png`), fullPage: true, animations: 'disabled' });

  await page.evaluate(() => { window.__fakeWalletState.rejectSign = true; });
  await page.locator('.wallet-panel-sign').click();
  await page.locator('.wallet-panel-error').waitFor({ state: 'visible' });
  assert.match(await page.locator('.wallet-panel-error').textContent(), /Firma cancelada/);
  assert.equal(await page.evaluate(() => window.__fakeWalletState.signCalls), 1);
  assert.equal(counters.verifications, verificationStart, 'a rejected signature is never submitted');
  assert.equal(await page.locator('.wallet-panel').textContent().then((s) => s.includes('provider rejection detail')), false,
    'provider diagnostics stay hidden');

  await page.evaluate(() => { window.__fakeWalletState.rejectSign = false; });
  await page.locator('.wallet-panel-connect').click();
  await page.locator('.wallet-panel-review').waitFor({ state: 'visible' });
  if (prefix === 'desktop') {
    await page.route('**/web3/wallet/verify', async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200, 'commit the link before losing its reply');
      await route.abort('failed');
    }, { times: 1 });
  }
  await page.locator('.wallet-panel-sign').click();
  if (prefix === 'desktop') {
    await page.locator('.wallet-panel-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('.wallet-panel-error').textContent(), /Consulta su estado/);
    await page.locator('.wallet-panel-refresh').click();
  }
  await page.waitForFunction(() => document.querySelector('.wallet-panel-status')?.textContent === 'Wallet vinculada');
  assert.equal(await page.evaluate(() => window.__fakeWalletState.signCalls), 2);
  assert.equal(counters.challenges - challengeStart, 2, 'wrong-chain attempt never created a challenge');
  assert.equal(counters.verifications - verificationStart, 1);
  assert.match(await page.locator('.wallet-panel-identity').textContent(), new RegExp(signers.get(spec.email).address.slice(2, 10), 'i'));
  assert.match(await page.locator('.wallet-panel-identity').textContent(), new RegExp(String(CHAIN_ID)));
  await checkWalletControls('linked');
  await page.locator('.wallet-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `${prefix}-linked.png`), fullPage: true, animations: 'disabled' });

  const measurements = await page.evaluate(() => {
    const panel = document.querySelector('.wallet-panel');
    const controls = [...panel.querySelectorAll('button:not([hidden])')].map((button) => {
      const r = button.getBoundingClientRect();
      return { name: button.textContent.trim(), width: Math.round(r.width), height: Math.round(r.height), reachable: r.width > 0 && r.height > 0 };
    });
    return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    panel: { width: panel.clientWidth, scrollWidth: panel.scrollWidth }, controls };
  });
  measurements.controlMeasurements = controlMeasurements;
  assert.ok(measurements.document.width <= measurements.viewport.width, 'wallet flow has no horizontal page overflow');
  assert.ok(measurements.panel.scrollWidth <= measurements.panel.width, 'wallet panel has no horizontal overflow');

  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.account-overlay').isVisible(), false, 'Escape closes AccountPanel');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.account-open')), true, 'close returns focus to Cuenta');
  await page.locator('.account-open').click();
  await page.waitForFunction(() => document.querySelector('.wallet-panel-status')?.textContent === 'Wallet vinculada');
  assert.equal(await page.evaluate(() => window.__fakeWalletState.signCalls), 2, 'reopening consults the server without another signature');

  await page.reload();
  await page.waitForFunction((email) => document.querySelector('.account-status')?.textContent === email, spec.email);
  await page.locator('.account-open').click();
  await page.waitForFunction(() => document.querySelector('.wallet-panel-status')?.textContent === 'Wallet vinculada');
  assert.equal(await page.evaluate(() => window.__fakeWalletState.signCalls), 2, 'reload restores the linked wallet from server state without signing');
  const result = { case: `${prefix} account login, wrong chain, explicit review, cancelled signature, successful link and reload`,
    pass: true, lostCommittedReply: prefix === 'desktop', viewport: measurements.viewport, measurements, pageErrors: pageErrors.filter((error) => error.startsWith(`${prefix}:`)) };
  results.push(result);
  assert.deepEqual(result.pageErrors, []);
  await page.close();
  return result;
}

try {
  fs.mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch({ executablePath: BROWSER, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await reviewViewport({ label: 'desktop', email: 'desktop@example.test', accountId: users.get('desktop@example.test').id, width: 1280, height: 900 });
  await reviewViewport({ label: 'mobile-portrait', email: 'portrait@example.test', accountId: users.get('portrait@example.test').id, width: 390, height: 844 });
  await reviewViewport({ label: 'mobile-landscape', email: 'landscape@example.test', accountId: users.get('landscape@example.test').id, width: 844, height: 390 });
  const report = { scope: 'local focused AccountPanel + WalletPanel; fake Auth; real in-memory wallet service; no game join',
    origin, chainId: CHAIN_ID, evidence: OUT, results, counters: { ...counters }, pageErrors };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  if (browser) await browser.close();
  await game.close().catch(() => {});
  await new Promise((resolve) => authHttp.close(resolve));
}
