// Exercise the local PC launcher in a disposable project root without starting a public tunnel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = path.join(REPO, '.scratch');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function startLauncher(root, port, env) {
  const child = spawn(process.execPath, [path.join(root, 'tools', 'host-pc.mjs'), '--local', '--no-open', '--port', String(port)], {
    cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output.stderr += chunk; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  return { child, output, closed };
}

async function until(check, description, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForExit(started, description, timeoutMs = 10000) {
  let timer;
  try {
    const result = await Promise.race([
      started.closed,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeoutMs); }),
    ]);
    assert.equal(result.code, 0, `${description} exited with ${result.code ?? result.signal}: ${started.output.stderr}`);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function postControl(session, token = null) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return fetch(`http://127.0.0.1:${session.controlPort}/stop`, {
    method: 'POST', headers, signal: AbortSignal.timeout(2000),
  });
}

async function portClosed(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(true));
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
}

test('PC launcher keeps its control private, reuses one host, and preserves its save secret across restarts', async () => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(SCRATCH, 'pc-host-test-'));
  const fixtureRoot = path.resolve(fixture);
  const scratchRoot = path.resolve(SCRATCH) + path.sep;
  assert.ok(fixtureRoot.startsWith(scratchRoot), 'fixture must be contained by repo .scratch');

  let first, second;
  const children = new Set();
  const own = (started) => { children.add(started); return started; };
  const stopOwned = async (started, session) => {
    if (!started || !started.child.pid || started.child.exitCode !== null) return;
    if (session?.pid === started.child.pid) {
      try { await postControl(session, session.controlToken); } catch { /* process may already be closing */ }
    }
    let closed = false, timer;
    try {
      await Promise.race([
        started.closed.then(() => { closed = true; }),
        new Promise((resolve) => { timer = setTimeout(resolve, 4000); }),
      ]);
    } finally { clearTimeout(timer); }
    if (!closed) started.child.kill();
  };

  try {
    for (const name of ['server', 'src']) fs.cpSync(path.join(REPO, name), path.join(fixtureRoot, name), { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, 'tools'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'tools', 'host-pc.mjs'), path.join(fixtureRoot, 'tools', 'host-pc.mjs'));
    fs.copyFileSync(path.join(REPO, 'index.html'), path.join(fixtureRoot, 'index.html'));
    assert.equal(fs.existsSync(path.join(fixtureRoot, '.env')), false);

    const port = await freePort();
    const env = { ...process.env, PORT: '', HOST: '', MAX_PLAYERS: '2', BOTS: '0', DEV: '0' };
    for (const key of Object.keys(env)) if (key.startsWith('SUPABASE_')) delete env[key];
    delete env.SAVE_SECRET;
    first = own(startLauncher(fixtureRoot, port, env));

    const sessionPath = path.join(fixtureRoot, '.scratch', 'pc-host', 'session.json');
    const session = await until(async () => {
      if (first.child.exitCode !== null) throw new Error(`launcher exited (${first.child.exitCode}): ${first.output.stderr}`);
      return fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, 'utf8')) : null;
    }, 'session file from the first launcher');
    assert.equal(session.localUrl, `http://localhost:${port}`);
    assert.equal(session.publicUrl, null);
    const saveSecretPath = path.join(fixtureRoot, '.scratch', 'pc-host', 'save-secret');
    const secret = fs.readFileSync(saveSecretPath, 'utf8').trim();
    assert.match(secret, /^[a-f0-9]{64}$/);

    const local = `http://127.0.0.1:${port}`;
    const health = await until(async () => {
      const response = await fetch(`${local}/health`, { signal: AbortSignal.timeout(1000) });
      return response.ok && await response.text() === 'ok' ? response : null;
    }, 'game health endpoint');
    assert.equal(health.status, 200);
    const page = await fetch(`${local}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<meta name="mn-server" content="ws">/);

    for (const route of ['/.scratch/pc-host/session.json', '/session.json', '/save-secret', '/stop']) {
      assert.equal((await fetch(`${local}${route}`)).status, 404, route);
    }
    assert.equal((await fetch(`${local}/stop`, { method: 'POST' })).status, 405);
    assert.equal((await postControl(session)).status, 403, 'the private shutdown endpoint rejects a request without its token');

    second = own(startLauncher(fixtureRoot, port, env));
    await waitForExit(second, 'second launcher to exit after finding the existing authority');
    assert.match(second.output.stdout, /El servidor ya est\u00e1 encendido/);
    assert.equal(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).pid, first.child.pid);

    assert.equal((await postControl(session, session.controlToken)).status, 200);
    await waitForExit(first, 'first launcher shutdown');
    await until(() => portClosed(port), 'game port to close');
    assert.equal(fs.existsSync(sessionPath), false, 'shutdown removes its session file');
    assert.equal(fs.existsSync(path.join(fixtureRoot, 'URL-PARA-AMIGOS.txt')), false, 'shutdown removes its URL file');
    assert.equal(fs.readFileSync(saveSecretPath, 'utf8').trim(), secret, 'shutdown preserves the save secret');

    first = null;
    const restarted = own(startLauncher(fixtureRoot, port, env));
    first = restarted;
    const newSession = await until(async () => {
      if (restarted.child.exitCode !== null) throw new Error(`restart exited (${restarted.child.exitCode}): ${restarted.output.stderr}`);
      return fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, 'utf8')) : null;
    }, 'session file after restart');
    assert.notEqual(newSession.pid, session.pid);
    assert.equal(fs.readFileSync(saveSecretPath, 'utf8').trim(), secret, 'restart reuses the signing secret');
    assert.equal((await fetch(`${local}/health`)).status, 200);
    assert.equal((await postControl(newSession, newSession.controlToken)).status, 200);
    await waitForExit(restarted, 'restarted launcher shutdown');
    await until(() => portClosed(port), 'restarted game port to close');
    assert.equal(fs.existsSync(sessionPath), false);
  } finally {
    for (const started of children) {
      let session;
      try { session = JSON.parse(fs.readFileSync(path.join(fixtureRoot, '.scratch', 'pc-host', 'session.json'), 'utf8')); } catch { session = null; }
      await stopOwned(started, session);
    }
    const resolved = path.resolve(fixtureRoot);
    if (!resolved.startsWith(scratchRoot)) throw new Error(`Refusing to remove fixture outside .scratch: ${resolved}`);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
