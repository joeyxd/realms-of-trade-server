import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createNavalLabServer } from '../tools/naval-lab.mjs';

async function start(t) {
  const server = createNavalLabServer();
  assert.equal(server.listening, false, 'importing the server module must not autostart it');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  return server.address().port;
}

function request(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('isolated lab server serves its real entry page and only permitted source and Three.js files on loopback', async (t) => {
  const port = await start(t);
  const [page, main, style, fixtures, simModule, three] = await Promise.all([
    request(port, '/tools/naval-lab/index.html'),
    request(port, '/tools/naval-lab/main.js'),
    request(port, '/tools/naval-lab/style.css'),
    request(port, '/tools/naval-lab/fixtures.js'),
    request(port, '/src/data/raftparts.js'),
    request(port, '/node_modules/three/build/three.module.js'),
  ]);
  assert.equal(page.status, 200);
  assert.match(page.body, /main\.js/);
  assert.match(page.body, /style\.css/);
  assert.equal(main.status, 200);
  assert.match(main.headers['content-type'], /javascript/);
  assert.equal(style.status, 200);
  assert.match(style.headers['content-type'], /css/);
  assert.equal(fixtures.status, 200);
  assert.match(fixtures.headers['content-type'], /javascript/);
  assert.match(fixtures.body, /LAB_FIXTURES/);
  assert.equal(simModule.status, 200);
  assert.match(simModule.body, /STARTER_RAFT/);
  assert.equal(three.status, 200);
  assert.match(three.headers['content-type'], /javascript/);
  assert.match(three.body, /THREE/);
});

test('HEAD returns the same resource metadata without a body', async (t) => {
  const port = await start(t);
  const get = await request(port, '/tools/naval-lab/fixtures.js');
  const head = await request(port, '/tools/naval-lab/fixtures.js', 'HEAD');
  assert.equal(get.status, 200);
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-type'], get.headers['content-type']);
  assert.equal(head.headers['content-length'], get.headers['content-length']);
});

test('pilot harness is served through its bounded prefix with page-only mobile mode', async (t) => {
  const port = await start(t);
  const [page, main, style] = await Promise.all([
    request(port, '/tools/naval-pilot/?mobile=1'),
    request(port, '/tools/naval-pilot/main.js'),
    request(port, '/tools/naval-pilot/style.css'),
  ]);
  assert.equal(page.status, 200);
  assert.match(page.body, /naval-pilot\/main\.js/);
  assert.equal(main.status, 200);
  assert.match(main.body, /NavalPilotServer/);
  assert.equal(style.status, 200);
  assert.match(style.headers['content-type'], /css/);
  assert.equal((await request(port, '/tools/naval-pilot/main.js?mobile=1')).status, 400);
  assert.equal((await request(port, '/tools/naval-pilot/../../server/index.mjs')).status, 400);
  assert.equal((await request(port, '/tools/naval-pilot/private.json')).status, 404);
});

test('only a safe cache version query is accepted', async (t) => {
  const port = await start(t);
  assert.equal((await request(port, '/tools/naval-lab/fixtures.js?v=abc-123')).status, 200);
  assert.equal((await request(port, '/?mobile=1')).status, 200);
  assert.equal((await request(port, '/tools/naval-lab/index.html?mobile=0&v=abc-123')).status, 200);
  assert.equal((await request(port, '/tools/naval-lab/main.js?mobile=1')).status, 400);
  assert.equal((await request(port, '/tools/naval-lab/fixtures.js?download=1')).status, 400);
  assert.equal((await request(port, '/tools/naval-lab/fixtures.js?v=a&v=b')).status, 400);
  assert.equal((await request(port, '/tools/naval-lab/index.html?mobile=1&mobile=0')).status, 400);
  assert.equal((await request(port, '/tools/naval-lab/index.html?mobile=yes')).status, 400);
});

test('server, tests, package metadata, and unrelated modules are not served', async (t) => {
  const port = await start(t);
  for (const pathname of ['/server/index.mjs', '/tests/naval-handling.test.mjs', '/package.json',
    '/node_modules/ws/index.js', '/node_modules/three/package.json', '/.env']) {
    assert.equal((await request(port, pathname)).status, 404, `${pathname} is outside the allowlist`);
  }
});

test('encoded, double-encoded, normalized, and absolute traversal requests are rejected', async (t) => {
  const port = await start(t);
  for (const pathname of ['/tools/naval-lab/../../server/index.mjs',
    '/tools/naval-lab/%2e%2e/server/index.mjs', '/tools/naval-lab/%252e%252e/server/index.mjs',
    '//server/index.mjs', 'C:/DEV/realms-of-trade-server/server/index.mjs']) {
    const response = await request(port, pathname);
    assert.ok(response.status === 400 || response.status === 404, `${pathname} rejected with ${response.status}`);
    assert.doesNotMatch(response.body, /createServer|SUPABASE|DATABASE_URL/);
  }
});

test('methods other than GET and HEAD receive 405 with an explicit Allow header', async (t) => {
  const port = await start(t);
  const response = await request(port, '/tools/naval-lab/fixtures.js', 'POST');
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
});
