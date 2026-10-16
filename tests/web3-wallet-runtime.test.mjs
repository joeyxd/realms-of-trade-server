import test from 'node:test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { access, cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { walletLinkFromEnv } from '../server/web3/walletRuntime.mjs';
import { WalletLinkError } from '../server/web3/walletLink.mjs';
import { createGameServer } from '../server/index.mjs';
import { StoreError, createMemoryStore } from '../server/store.mjs';
import { privateKeyToAccount } from 'viem/accounts';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './helpers/web3-wallet-sql.mjs';

const SUPABASE_URL = 'https://project.example';
const ORIGIN = 'https://game.example';
const PUBLIC_KEY = 'sb_publishable_local-test-key';
const SERVICE_KEY = 'local-service-role-test-key';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const baseEnv = () => ({ MN_WEB3_WALLET_ENABLED: '1', MN_WEB3_WALLET_ORIGIN: ORIGIN,
  MN_WEB3_WALLET_CHAIN_ID: '31337', SUPABASE_URL: SUPABASE_URL,
  SUPABASE_PUBLIC_KEY: PUBLIC_KEY, SUPABASE_SERVICE_KEY: SERVICE_KEY });
const auth = { publicConfig: { enabled: true, url: SUPABASE_URL, publicKey: PUBLIC_KEY }, resolvePlayer: async () => ACCOUNT };
const durableGameStore = () => ({ durable: true, async checkReady() { return true; } });

function expectConfiguration(run) {
  assert.throws(run, (error) => error instanceof WalletLinkError && error.code === 'configuration'
    && error.message === 'Wallet link: configuration');
}

test('wallet runtime stays off by default and ignores wallet-only settings while disabled', () => {
  let factories = 0;
  for (const enabled of [undefined, '0']) {
    const env = { MN_WEB3_WALLET_ORIGIN: ORIGIN, MN_WEB3_WALLET_CHAIN_ID: '31337',
      SUPABASE_URL: SUPABASE_URL, SUPABASE_PUBLIC_KEY: PUBLIC_KEY, SUPABASE_SERVICE_KEY: SERVICE_KEY };
    if (enabled !== undefined) env.MN_WEB3_WALLET_ENABLED = enabled;
    assert.equal(walletLinkFromEnv(env, { auth, gameStore: { durable: false }, factory() { factories++; } }), null);
  }
  assert.equal(factories, 0);
});

test('enabled wallet runtime validates all explicit configuration before creating its service client', () => {
  const invalidEnvs = [
    (env) => { env.MN_WEB3_WALLET_ENABLED = 'true'; },
    (env) => { delete env.MN_WEB3_WALLET_ORIGIN; },
    (env) => { env.MN_WEB3_WALLET_ORIGIN = 'https://game.example/'; },
    (env) => { env.MN_WEB3_WALLET_ORIGIN = 'http://game.example'; },
    (env) => { env.MN_WEB3_WALLET_CHAIN_ID = '031337'; },
    (env) => { env.MN_WEB3_WALLET_CHAIN_ID = '0'; },
    (env) => { env.MN_WEB3_WALLET_TTL_MS = '30000.0'; },
    (env) => { env.MN_WEB3_WALLET_TTL_MS = '29999'; },
    (env) => { env.SUPABASE_URL = 'https://other-project.example'; },
    (env) => { env.SUPABASE_SERVICE_KEY = PUBLIC_KEY; },
  ];
  for (const mutate of invalidEnvs) {
    const env = baseEnv(); mutate(env);
    let factories = 0;
    expectConfiguration(() => walletLinkFromEnv(env, { auth, gameStore: durableGameStore(), factory() { factories++; } }));
    assert.equal(factories, 0, 'invalid configuration must be rejected before client creation');
  }
  for (const dependencies of [
    { auth: { ...auth, publicConfig: { ...auth.publicConfig, enabled: false } }, gameStore: durableGameStore() },
    { auth: { ...auth, resolvePlayer: null }, gameStore: durableGameStore() },
    { auth, gameStore: { durable: false } },
  ]) {
    let factories = 0;
    expectConfiguration(() => walletLinkFromEnv(baseEnv(), { ...dependencies, factory() { factories++; } }));
    assert.equal(factories, 0);
  }
});

test('service-role client is stateless and separate from public Auth credentials', () => {
  const captured = [];
  const runtime = walletLinkFromEnv(baseEnv(), { auth, gameStore: durableGameStore(), factory(...args) {
    captured.push(args);
    return { async rpc() { return { data: true, error: null }; } };
  } });
  assert.equal(captured.length, 1);
  const [url, key, options] = captured[0];
  assert.equal(url, SUPABASE_URL);
  assert.equal(key, SERVICE_KEY);
  assert.notEqual(key, auth.publicConfig.publicKey);
  assert.equal(options.auth.persistSession, false);
  assert.equal(options.auth.autoRefreshToken, false);
  assert.equal(options.auth.detectSessionInUrl, false);
  assert.equal(runtime.origin, ORIGIN);
  assert.equal(runtime.chainId, 31337);
  assert.equal(runtime.durable, true);
  assert.equal(typeof runtime.issue, 'function');
  assert.equal(typeof runtime.verify, 'function');
  assert.equal(typeof runtime.loadLink, 'function');
  assert.equal(typeof runtime.prepare, 'function');
});

test('service client construction failures expose only a fixed configuration error', () => {
  const privateDetail = `${SERVICE_KEY} INTERNAL_SERVICE_DIAGNOSTIC`;
  let thrown;
  try {
    walletLinkFromEnv(baseEnv(), { auth, gameStore: durableGameStore(), factory() { throw new Error(privateDetail); } });
  } catch (error) { thrown = error; }
  assert.ok(thrown instanceof WalletLinkError);
  assert.equal(thrown.code, 'configuration');
  assert.equal(thrown.message, 'Wallet link: configuration');
  assert.doesNotMatch(`${thrown.message} ${thrown.stack}`, new RegExp(`${SERVICE_KEY}|INTERNAL_SERVICE_DIAGNOSTIC`));
});

test('credentialed service fetch honors an aborted caller signal and refuses redirects', async (t) => {
  let redirected = 0, followed = 0, abortedPath = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { redirected++; res.writeHead(302, { location: '/trap' }).end(); return; }
    if (req.url === '/trap') { followed++; res.writeHead(200).end('followed'); return; }
    if (req.url === '/aborted') abortedPath++;
    res.writeHead(200).end('ok');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const captured = [];
  walletLinkFromEnv(baseEnv(), { auth, gameStore: durableGameStore(), factory(...args) {
    captured.push(args);
    return { async rpc() { return { data: { version: 1 }, error: null }; } };
  } });
  const serviceFetch = captured[0][2].global.fetch;
  const base = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(serviceFetch(`${base}/aborted`, { signal: controller.signal }));
  assert.equal(abortedPath, 0);
  await assert.rejects(serviceFetch(`${base}/redirect`));
  assert.equal(redirected, 1);
  assert.equal(followed, 0);
});

test('ordinary HTTP server keeps wallet routes disabled', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log() {}, saveSecret: 'runtime-test-only' });
  t.after(() => app.close());
  const port = await app.listen(), base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/web3/wallet/link`)).status, 404);
  assert.deepEqual(await (await fetch(`${base}/web3/wallet/config`)).json(), { enabled: false });
});

test('wallet preparation is shared by concurrent listen calls and gates the listener on readiness', async (t) => {
  let readyCalls = 0;
  const runtime = walletLinkFromEnv(baseEnv(), { auth, gameStore: durableGameStore(),
    factory() { return { async rpc(name, args) { assert.equal(name, 'mn_web3_wallet_ready'); assert.deepEqual(args, {}); readyCalls++;
      await new Promise((resolve) => setTimeout(resolve, 15)); return { data: { version: 1 }, error: null }; } }; } });
  const app = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log() {}, saveSecret: 'runtime-ready-test-only',
    resolvePlayer: auth.resolvePlayer, publicAuth: auth.publicConfig, walletLink: runtime });
  t.after(() => app.close());
  const first = app.listen(), second = app.listen();
  assert.equal(app.server.listening, false);
  const [portA, portB] = await Promise.all([first, second]);
  assert.equal(portA, portB);
  assert.equal(readyCalls, 1);
  assert.equal(app.server.listening, true);
});

test('readiness errors and timeouts prevent listening and return fixed errors', async (t) => {
  for (const readiness of [
    async () => { throw new Error('private database diagnostic'); },
    async () => ({ data: { version: 2 }, error: null }),
    () => new Promise(() => {}),
  ]) {
    const runtime = walletLinkFromEnv(baseEnv(), { auth, gameStore: durableGameStore(),
      factory() { return { async rpc() { return readiness(); } }; } });
    const app = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log() {}, saveSecret: 'runtime-failure-test-only',
      resolvePlayer: auth.resolvePlayer, publicAuth: auth.publicConfig, walletLink: runtime });
    t.after(() => app.close());
    await assert.rejects(app.listen(), (error) => error instanceof WalletLinkError
      && ['storage', 'response'].includes(error.code) && !/private database diagnostic/.test(error.message));
    assert.equal(app.server.listening, false);
  }
});




test('createGameServer rejects a malformed wallet preparation hook as configuration', () => {
  const walletLink = { origin: ORIGIN, chainId: 31337, issue() {}, verify() {}, loadLink() {}, prepare: 42 };
  assert.throws(() => createGameServer({ port: 0, bots: 0, log() {}, saveSecret: 'runtime-invalid-prepare-only',
    resolvePlayer: auth.resolvePlayer, walletLink }), (error) => error instanceof StoreError && error.code === 'configuration');
});

const signer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const readinessSql = (await readFile(new URL('../server/migrations/web3/003_wallet_readiness.sql', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
const RPC_SQL = {
  mn_web3_wallet_ready: ['public.mn_web3_wallet_ready()', []],
  mn_web3_wallet_issue: ['public.mn_web3_wallet_issue($1::jsonb)', ['p_request']],
  mn_web3_wallet_complete: ['public.mn_web3_wallet_complete($1::uuid,$2::uuid,$3::boolean)', ['p_challenge_id', 'p_account_id', 'p_verified']],
  mn_web3_wallet_challenge: ['public.mn_web3_wallet_challenge($1::uuid)', ['p_challenge_id']],
  mn_web3_wallet_link: ['public.mn_web3_wallet_link($1::uuid)', ['p_account_id']],
};

function runtimeFactory(db, captured) {
  return (url, key, options) => {
    captured.push({ url, key, options });
    const fetchSql = async (input, init = {}) => {
      const name = new URL(input).pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
      const requestHeaders = new Headers(init.headers);
      assert.equal(requestHeaders.get('authorization'), `Bearer ${SERVICE_KEY}`);
      assert.equal(requestHeaders.get('apikey'), SERVICE_KEY);
      const route = RPC_SQL[name];
      if (!route) return new Response(JSON.stringify({ message: 'unexpected local test RPC' }), { status: 404 });
      try {
        const values = route[1].map((field) => body[field]);
        const data = (await db.query(`select ${route[0]} as data`, values)).rows[0].data;
        return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ message: 'local SQL rejected', code: error.code ?? 'XX000' }),
          { status: 400, headers: { 'content-type': 'application/json' } });
      }
    };
    return createClient(url, key, { ...options, global: { ...options.global, fetch: fetchSql } });
  };
}

test('real Supabase SDK wallet service passes SQL readiness and preserves a signed link after reopening PGlite', async (t) => {
  const location = join(await mkdtemp(join(tmpdir(), 'mn-wallet-runtime-')), 'postgres');
  const accountAuth = { publicConfig: { enabled: true, url: SUPABASE_URL, publicKey: PUBLIC_KEY },
    resolvePlayer: async (_req, { token }) => token === 'runtime-local-player-token' ? ACCOUNT : null };
  let sql = await database(location), app;
  await sql.db.exec('RESET ROLE');
  await sql.db.exec(readinessSql);
  await sql.db.exec('SET ROLE service_role');
  const captured = [];
  const mount = async () => {
    const runtime = walletLinkFromEnv(baseEnv(), { auth: accountAuth, gameStore: { durable: true },
      factory: runtimeFactory(sql.db, captured) });
    app = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log() {}, saveSecret: 'runtime-sql-http-test-only',
      store: createMemoryStore(), resolvePlayer: accountAuth.resolvePlayer,
      publicAuth: accountAuth.publicConfig, walletLink: runtime });
    const port = await app.listen();
    return `http://127.0.0.1:${port}`;
  };
  t.after(async () => {
    if (app) await app.close();
    if (sql) await sql.close();
    await rm(dirname(location), { recursive: true, force: true });
  });
  const call = (base, path, body) => fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer runtime-local-player-token', origin: ORIGIN, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  let base = await mount();
  const challenged = await call(base, '/web3/wallet/challenge', { address: signer.address, chainId: 31337 });
  assert.equal(challenged.status, 200);
  const challenge = (await challenged.json()).challenge;
  const signature = await signer.signMessage({ message: challenge.message });
  const verified = await call(base, '/web3/wallet/verify', { challengeId: challenge.challengeId,
    message: challenge.message, signature });
  assert.equal(verified.status, 200);
  const linked = await verified.json();
  assert.deepEqual(linked, { ok: true, link: { accountId: ACCOUNT, address: signer.address.toLowerCase(),
    chainId: 31337, challengeId: challenge.challengeId } });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].key, SERVICE_KEY);
  assert.equal(captured[0].options.auth.persistSession, false);
  await app.close(); app = null;
  await sql.close();
  sql = await database(location, { reapply: true });
  await sql.db.exec('RESET ROLE');
  await sql.db.exec(readinessSql);
  await sql.db.exec('SET ROLE service_role');
  base = await mount();
  const reloaded = await call(base, '/web3/wallet/link');
  assert.equal(reloaded.status, 200);
  assert.deepEqual(await reloaded.json(), linked);
  assert.equal(captured.length, 2);
});
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function isolatedEntrypoint(t) {
  const root = await mkdtemp(join(tmpdir(), 'mn-wallet-entrypoint-'));
  const safeRoot = resolve(tmpdir()), targetRoot = resolve(root);
  assert.notEqual(targetRoot, safeRoot);
  assert.ok(targetRoot.startsWith(safeRoot + sep), 'temporary checkout must remain under the OS temp directory');
  assert.ok(basename(targetRoot).startsWith('mn-wallet-entrypoint-'));
  await cp(join(repoRoot, 'server'), join(root, 'server'), { recursive: true });
  await cp(join(repoRoot, 'src'), join(root, 'src'), { recursive: true });
  await cp(join(repoRoot, 'package.json'), join(root, 'package.json'));
  await symlink(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction');
  // Only server, src, package.json, and the dependency junction enter this clean checkout; no repo .env is copied.
  await assert.rejects(access(join(root, '.env')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, entry: join(root, 'server', 'index.mjs') };
}

function childEnvironment(overrides = {}) {
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, PORT: '0', HOST: '127.0.0.1', BOTS: '0', SAVE_SECRET: 'public-local-entrypoint-fixture', ...overrides };
}

function launch(entry, env, { emitSignal = false } = {}) {
  const signalHarness = "process.argv[1] = process.env.MN_TEST_ENTRYPOINT; const { pathToFileURL } = await import('node:url'); await import(pathToFileURL(process.env.MN_TEST_ENTRYPOINT)); for await (const _chunk of process.stdin) { process.emit('SIGTERM'); break; }";
  const child = spawn(process.execPath, emitSignal ? ['--input-type=module', '-e', signalHarness]
    : [entry], { cwd: dirname(dirname(entry)), env: emitSignal ? { ...env, MN_TEST_ENTRYPOINT: entry } : env,
    stdio: [emitSignal ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  child.emitSignal = emitSignal;
  child.output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { child.output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { child.output.stderr += chunk; });
  child.exited = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  return child;
}

async function waitForPort(child, timeoutMs = 15000) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    const match = child.output.stdout.match(/http:\/\/localhost:(\d+)/);
    if (match) return Number(match[1]);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`entrypoint exited before listening: ${child.output.stderr}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`entrypoint did not listen within ${timeoutMs}ms: ${child.output.stderr}`);
}

async function waitForExit(child, timeoutMs = 15000) {
  let timer;
  try {
    return await Promise.race([child.exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`entrypoint did not exit within ${timeoutMs}ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return child?.exited;
  if (child.emitSignal) child.stdin.end('stop');
  else child.kill('SIGTERM');
  let timer;
  try {
    return await Promise.race([child.exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('entrypoint shutdown timeout')), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

function assertSanitizedStartupFailure(child, sentinels = []) {
  assert.equal(child.output.stderr.trim(), '[srv] startup failed: configuration, wallet readiness, world storage or listener unavailable');
  for (const sentinel of sentinels.filter(Boolean)) {
    assert.doesNotMatch(child.output.stdout + child.output.stderr, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(child.output.stdout, /http:\/\/localhost:\d+/);
}

test('isolated server entrypoint boots disabled by default and by explicit zero, then closes on signal', async (t) => {
  const { entry } = await isolatedEntrypoint(t);
  for (const flag of [undefined, '0']) {
    const env = childEnvironment(flag === undefined ? {} : { MN_WEB3_WALLET_ENABLED: flag,
      MN_WEB3_WALLET_ORIGIN: 'invalid://ignored', MN_WEB3_WALLET_CHAIN_ID: 'not-a-chain' });
    const child = launch(entry, env, { emitSignal: true });
    try {
      const port = await waitForPort(child);
      const response = await fetch(`http://127.0.0.1:${port}/web3/wallet/config`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { enabled: false });
      assert.doesNotMatch(child.output.stdout + child.output.stderr, /wallet linking enabled/);
      const exit = await stopChild(child);
      assert.equal(exit.code, 0);
      assert.match(child.output.stdout, /closing/);
    } finally {
      if (child.exitCode === null && child.signalCode === null) await stopChild(child);
    }
  }
});

test('isolated active entrypoint rejects invalid wallet setup with one fixed diagnostic and no secrets', async (t) => {
  const { entry } = await isolatedEntrypoint(t);
  const invalid = [
    { MN_WEB3_WALLET_ENABLED: 'enabled', SAVE_SECRET: 'secret-malformed-flag-sentinel' },
    { MN_WEB3_WALLET_ENABLED: '1', MN_WEB3_WALLET_ORIGIN: ORIGIN, MN_WEB3_WALLET_CHAIN_ID: '31337',
      SUPABASE_SERVICE_KEY: 'secret-missing-url-sentinel', SUPABASE_PUBLIC_KEY: PUBLIC_KEY },
    { MN_WEB3_WALLET_ENABLED: '1', MN_WEB3_WALLET_ORIGIN: ORIGIN, MN_WEB3_WALLET_CHAIN_ID: '31337',
      SUPABASE_URL: SUPABASE_URL, SUPABASE_SERVICE_KEY: 'secret-missing-public-key-sentinel' },
    { MN_WEB3_WALLET_ENABLED: '1', MN_WEB3_WALLET_ORIGIN: ORIGIN, MN_WEB3_WALLET_CHAIN_ID: '31337',
      MN_WEB3_WALLET_TTL_MS: '', SUPABASE_URL: SUPABASE_URL, SUPABASE_PUBLIC_KEY: PUBLIC_KEY,
      SUPABASE_SERVICE_KEY: 'secret-empty-ttl-sentinel' },
    { MN_WEB3_WALLET_ENABLED: '1', MN_WEB3_WALLET_ORIGIN: ORIGIN, MN_WEB3_WALLET_CHAIN_ID: '31337',
      SUPABASE_URL: SUPABASE_URL, SUPABASE_PUBLIC_KEY: PUBLIC_KEY,
      SUPABASE_SERVICE_KEY: 'secret whitespace-service-key-sentinel ' },
  ];
  for (const walletEnv of invalid) {
    const child = launch(entry, childEnvironment(walletEnv));
    try {
      const exit = await waitForExit(child);
      assert.equal(exit.code, 1);
      assertSanitizedStartupFailure(child, Object.values(walletEnv).filter((value) => typeof value === 'string' && value.length > 0));
    } finally {
      if (child.exitCode === null && child.signalCode === null) await stopChild(child);
    }
  }
});

test('isolated active entrypoint checks only readiness RPC with service credentials before binding', async (t) => {
  const { entry } = await isolatedEntrypoint(t);
  const requests = [];
  const stub = await new Promise((resolveListen) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push({ path: req.url, method: req.method, headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: 2 }));
    });
    server.listen(0, '127.0.0.1', () => resolveListen(server));
  });
  t.after(() => new Promise((resolveClose) => stub.close(resolveClose)));
  const serviceSecret = 'service-private-entry-sentinel';
  const publicCredential = 'sb_publishable_entry-public-sentinel';
  const playerCredential = 'player-bearer-entry-sentinel';
  const child = launch(entry, childEnvironment({ MN_WEB3_WALLET_ENABLED: '1', MN_WEB3_WALLET_ORIGIN: ORIGIN,
    MN_WEB3_WALLET_CHAIN_ID: '31337', SUPABASE_URL: `http://127.0.0.1:${stub.address().port}`,
    SUPABASE_PUBLIC_KEY: publicCredential, SUPABASE_SERVICE_KEY: serviceSecret }));
  try {
    const exit = await waitForExit(child);
    assert.equal(exit.code, 1);
    assertSanitizedStartupFailure(child, [serviceSecret, publicCredential, playerCredential]);
    assert.equal(child.output.stdout.includes('http://localhost:'), false);
    assert.equal(requests.length, 1, 'wallet preparation fails before any world store RPC');
    assert.equal(requests[0].path, '/rest/v1/rpc/mn_web3_wallet_ready');
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].headers.apikey, serviceSecret);
    assert.equal(requests[0].headers.authorization, `Bearer ${serviceSecret}`);
    assert.deepEqual(JSON.parse(requests[0].body), {});
    // Startup made no account-auth or player request; per-player bearer behavior is covered by the wallet HTTP suite.
    assert.doesNotMatch(JSON.stringify(requests[0]), /publicCredential|playerCredential|sb_publishable|player-bearer/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) await stopChild(child);
  }
});

